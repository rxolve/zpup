/**
 * Turns the raw samples of a run into a Markdown summary and an HTML gallery.
 * Everything is recomputed from the stored replies, so changing the checker and
 * re-running the report re-scores old runs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreReply } from './score.ts';
import {
  CONDITIONS,
  type Condition,
  type RunManifest,
  type SampleRecord,
  type Score,
} from './types.ts';

export interface ScoredSample {
  record: SampleRecord;
  /** `api-error`: the first call failed. `skipped`: the repair was cut by the cost cap. */
  status: 'scored' | 'api-error' | 'skipped';
  first?: Score;
  final?: Score;
  firstValid: boolean;
  finalValid: boolean;
  repaired: boolean;
  firstOutputTokens?: number;
  firstReasoningTokens?: number;
  firstLatencyMs?: number;
  costUsd: number;
}

export interface LoadedRun {
  manifest: RunManifest;
  samples: ScoredSample[];
}

export function loadRun(dir: string): LoadedRun {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as RunManifest;
  const samplesDir = join(dir, 'samples');
  const names = existsSync(samplesDir)
    ? readdirSync(samplesDir).filter((n) => n.endsWith('.json'))
    : [];
  const samples = names
    .sort()
    .map((name) =>
      scoreSample(
        JSON.parse(readFileSync(join(samplesDir, name), 'utf8')) as SampleRecord,
        manifest,
      ),
    );
  return { manifest, samples };
}

export function scoreSample(record: SampleRecord, manifest: RunManifest): ScoredSample {
  const options = manifest.config;
  const costUsd = record.attempts.reduce((sum, a) => sum + a.costUsd, 0);
  const [firstAttempt, secondAttempt] = record.attempts;
  const base = { record, costUsd, firstValid: false, finalValid: false, repaired: false };
  if (!firstAttempt?.response) return { ...base, status: 'api-error' };

  const first = scoreReply(record.condition, firstAttempt.response.text, options);
  const result: ScoredSample = {
    ...base,
    status: 'scored',
    first,
    final: first,
    firstValid: first.valid,
    finalValid: first.valid,
    firstOutputTokens: firstAttempt.response.usage.completionTokens,
    firstLatencyMs: firstAttempt.response.latencyMs,
  };
  if (firstAttempt.response.usage.reasoningTokens !== undefined) {
    result.firstReasoningTokens = firstAttempt.response.usage.reasoningTokens;
  }
  if (first.valid) return result;
  if (record.repairSkipped) return { ...result, status: 'skipped' };
  if (secondAttempt?.response) {
    const final = scoreReply(record.condition, secondAttempt.response.text, options);
    result.final = final;
    result.finalValid = final.valid;
    result.repaired = final.valid;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Markdown summary

const pct = (k: number, n: number) => (n === 0 ? '-' : `${k}/${n} (${Math.round((100 * k) / n)}%)`);

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

const fmt = (value: number | undefined, digits = 0) =>
  value === undefined ? '-' : value.toFixed(digits);

const CONDITION_LABEL: Record<Condition, string> = { svg: 'raw SVG', zpup: 'zpup JSON' };

interface Row {
  label: string;
  samples: ScoredSample[];
}

function statsRow(row: Row): string {
  const s = row.samples;
  const scored = s.filter((x) => x.status !== 'api-error');
  const repairable = scored.filter((x) => x.status === 'scored');
  const cost = s.reduce((sum, x) => sum + x.costUsd, 0);
  const tokens = scored.flatMap((x) =>
    x.firstOutputTokens === undefined ? [] : [x.firstOutputTokens],
  );
  const reasoning = scored.flatMap((x) =>
    x.firstReasoningTokens === undefined ? [] : [x.firstReasoningTokens],
  );
  const latency = scored.flatMap((x) =>
    x.firstLatencyMs === undefined ? [] : [x.firstLatencyMs / 1000],
  );
  return [
    row.label,
    String(s.length),
    pct(scored.filter((x) => x.firstValid).length, scored.length),
    pct(repairable.filter((x) => x.finalValid).length, repairable.length),
    String(s.length - scored.length),
    fmt(median(tokens)),
    fmt(median(reasoning)),
    fmt(median(latency), 1),
    `$${cost.toFixed(4)}`,
    s.length ? `$${(cost / s.length).toFixed(4)}` : '-',
  ].join(' | ');
}

const STATS_HEADER = [
  '| Model / format | Samples | Valid on first try | Valid after one repair | API errors | Median output tokens | Median reasoning tokens | Median latency (s) | Cost | Cost per sample |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
];

/** Strips numbers and quoted values so the same kind of problem is counted together. */
function problemKind(problem: string): string {
  return problem
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\[\d+\]/g, '[n]')
    .replace(/\d+(\.\d+)?/g, 'N')
    .slice(0, 160);
}

export function summaryMarkdown(run: LoadedRun): string {
  const { manifest, samples } = run;
  const lines: string[] = [];
  lines.push(`# zpup bench: run ${manifest.runId}`, '');
  lines.push(
    `Provider: ${manifest.provider}. Started ${manifest.startedAt}${manifest.finishedAt ? `, finished ${manifest.finishedAt}` : ''}.`,
  );
  if (manifest.gitCommit)
    lines.push(
      `Commit: ${manifest.gitCommit}. llms.txt sha256: ${manifest.referenceSha256.slice(0, 12)}.`,
    );
  const spent = samples.reduce((sum, x) => sum + x.costUsd, 0);
  lines.push(
    `Samples: ${samples.length}. Spent: $${spent.toFixed(4)} (cap $${manifest.config.maxCostUsd}).`,
  );
  if (manifest.stoppedReason) lines.push('', `**Stopped early:** ${manifest.stoppedReason}.`);
  if (manifest.provider === 'mock') {
    lines.push(
      '',
      '**Mock run.** These replies are canned test data, not model output. The numbers mean nothing.',
    );
  }
  lines.push(
    '',
    '"Valid" only means the reply parses and renders under the rules in bench/README.md. It says nothing about whether the picture is good; look at gallery.html for that.',
    'Token, reasoning and latency columns describe the first try only. Cost includes the repair call.',
    '"Valid after one repair" excludes samples whose repair was cut by the cost cap.',
    '',
  );

  lines.push('## By model and format', '', ...STATS_HEADER);
  for (const model of manifest.config.models) {
    for (const condition of CONDITIONS) {
      lines.push(
        `| ${statsRow({
          label: `${model.label} / ${CONDITION_LABEL[condition]}`,
          samples: samples.filter(
            (x) => x.record.model === model.id && x.record.condition === condition,
          ),
        })} |`,
      );
    }
  }
  lines.push('', '## All models pooled', '', ...STATS_HEADER);
  for (const condition of CONDITIONS) {
    lines.push(
      `| ${statsRow({ label: CONDITION_LABEL[condition], samples: samples.filter((x) => x.record.condition === condition) })} |`,
    );
  }

  lines.push('', '## By task', '', 'Each cell: valid on first try, then after one repair.', '');
  const columns = manifest.config.models.flatMap((m) =>
    CONDITIONS.map((c) => ({ model: m, condition: c })),
  );
  lines.push(
    `| Task | ${columns.map((c) => `${c.model.label} ${c.condition}`).join(' | ')} |`,
    `| --- | ${columns.map(() => '---:').join(' | ')} |`,
  );
  for (const task of manifest.tasks) {
    const cells = columns.map(({ model, condition }) => {
      const s = samples.filter(
        (x) =>
          x.record.taskId === task.id &&
          x.record.model === model.id &&
          x.record.condition === condition &&
          x.status !== 'api-error',
      );
      if (s.length === 0) return '-';
      return `${s.filter((x) => x.firstValid).length}→${s.filter((x) => x.finalValid).length}/${s.length}`;
    });
    lines.push(`| ${task.id} | ${cells.join(' | ')} |`);
  }

  lines.push('', '## Most common problems on the first try', '');
  for (const condition of CONDITIONS) {
    const counts = new Map<string, { count: number; example: string }>();
    for (const x of samples) {
      if (x.record.condition !== condition || !x.first) continue;
      for (const problem of x.first.problems) {
        const kind = problemKind(problem);
        const entry = counts.get(kind) ?? { count: 0, example: problem };
        entry.count++;
        counts.set(kind, entry);
      }
    }
    lines.push(`### ${CONDITION_LABEL[condition]}`, '');
    const top = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 10);
    if (top.length === 0) lines.push('None.');
    for (const { count, example } of top)
      lines.push(`- ${count}× ${example.replace(/\n/g, ' ').slice(0, 240)}`);
    lines.push('');
  }

  lines.push('## Warnings (do not affect validity)', '');
  for (const condition of CONDITIONS) {
    const counts = new Map<string, number>();
    for (const x of samples) {
      if (x.record.condition !== condition || !x.final) continue;
      for (const w of x.final.warnings)
        counts.set(problemKind(w), (counts.get(problemKind(w)) ?? 0) + 1);
    }
    const list = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    lines.push(
      `- ${CONDITION_LABEL[condition]}: ${list.length === 0 ? 'none' : list.map(([w, n]) => `${n}× ${w}`).join('; ')}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
