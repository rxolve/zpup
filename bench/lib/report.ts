/**
 * Turns the raw samples of a run into a Markdown summary and an HTML gallery.
 * Everything is recomputed from the stored replies, so changing the checker and
 * re-running the report re-scores old runs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractDocument, scoreReply } from './score.ts';
import { DEPTH_TOLERANCE, GRID_STEP, TURN_OFFSETS_DEG, type TurnErrors } from './turns.ts';
import {
  type Condition,
  conditionsOf,
  type RunManifest,
  type SampleRecord,
  type Score,
} from './types.ts';

export interface ScoredSample {
  record: SampleRecord;
  /**
   * `api-error`: the first call failed. `truncated`: the first reply was cut off
   * at the output token limit (`finish_reason: "length"`), so it is neither valid
   * nor invalid and gets no repair. `skipped`: the repair was cut by the cost cap.
   */
  status: 'scored' | 'api-error' | 'truncated' | 'skipped';
  first?: Score;
  final?: Score;
  firstValid: boolean;
  finalValid: boolean;
  repaired: boolean;
  /** The first try was invalid and the repair reply was cut off at the token limit. */
  repairTruncated: boolean;
  /** Characters in the document of the valid reply (after code-fence extraction). */
  validChars?: number;
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
  const base = {
    record,
    costUsd,
    firstValid: false,
    finalValid: false,
    repaired: false,
    repairTruncated: false,
  };
  if (!firstAttempt?.response) return { ...base, status: 'api-error' };

  const response = firstAttempt.response;
  const timing = {
    firstOutputTokens: response.usage.completionTokens,
    firstLatencyMs: response.latencyMs,
    ...(response.usage.reasoningTokens === undefined
      ? {}
      : { firstReasoningTokens: response.usage.reasoningTokens }),
  };
  // Checked before validity: a cut-off reply says nothing about the format.
  // Runs made before this rule existed may hold a repair for it; it is ignored
  // here but its cost still counts.
  if (response.finishReason === 'length') return { ...base, ...timing, status: 'truncated' };

  const first = scoreReply(record.condition, response.text, options);
  const result: ScoredSample = {
    ...base,
    ...timing,
    status: 'scored',
    first,
    final: first,
    firstValid: first.valid,
    finalValid: first.valid,
  };
  if (first.valid) return { ...result, validChars: extractDocument(response.text).text.length };
  if (record.repairSkipped) return { ...result, status: 'skipped' };
  if (secondAttempt?.response) {
    const final = scoreReply(record.condition, secondAttempt.response.text, options);
    result.final = final;
    result.finalValid = final.valid;
    result.repaired = final.valid;
    result.repairTruncated = secondAttempt.response.finishReason === 'length';
    if (final.valid) result.validChars = extractDocument(secondAttempt.response.text).text.length;
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

const CONDITION_LABEL: Record<Condition, string> = {
  svg: 'raw SVG',
  zdog: 'Zdog script',
  zpup: 'Zpup JSON',
};
const SHORT_LABEL: Record<Condition, string> = { svg: 'SVG', zdog: 'Zdog', zpup: 'Zpup' };

interface Row {
  label: string;
  samples: ScoredSample[];
}

const values = (samples: ScoredSample[], f: (x: ScoredSample) => number | undefined) =>
  samples.flatMap((x) => {
    const v = f(x);
    return v === undefined ? [] : [v];
  });

function statsRow(row: Row): string {
  const s = row.samples;
  const answered = s.filter((x) => x.status !== 'api-error');
  const scored = answered.filter((x) => x.status !== 'truncated');
  const repairable = scored.filter((x) => x.status === 'scored');
  const truncated = answered.length - scored.length;
  const repairTruncated = s.filter((x) => x.repairTruncated).length;
  const cost = s.reduce((sum, x) => sum + x.costUsd, 0);
  const tokens = values(answered, (x) => x.firstOutputTokens);
  const reasoning = values(answered, (x) => x.firstReasoningTokens);
  const latency = values(answered, (x) =>
    x.firstLatencyMs === undefined ? undefined : x.firstLatencyMs / 1000,
  );
  return [
    row.label,
    String(s.length),
    pct(scored.filter((x) => x.firstValid).length, scored.length),
    pct(repairable.filter((x) => x.finalValid).length, repairable.length),
    `${truncated}${repairTruncated ? ` (+${repairTruncated} on repair)` : ''}`,
    String(s.length - answered.length),
    fmt(median(tokens)),
    fmt(median(reasoning)),
    fmt(median(latency), 1),
    `$${cost.toFixed(4)}`,
    s.length ? `$${(cost / s.length).toFixed(4)}` : '-',
  ].join(' | ');
}

const STATS_HEADER = [
  '| Model / format | Samples | Valid on first try | Valid after one repair | Truncated | API errors | Median output tokens | Median reasoning tokens | Median latency (s) | Cost | Cost per sample |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
];

/** Strips numbers and quoted values so the same kind of problem is counted together. */
function problemKind(problem: string): string {
  return problem
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\[\d+\]/g, '[n]')
    .replace(/\d+(\.\d+)?/g, 'N')
    .slice(0, 160);
}

const percent = (share: number) => `${(100 * share).toFixed(2)}%`;

/** The turn-error table and the worst samples; see bench/README.md. */
function turnErrorLines(manifest: RunManifest, samples: ScoredSample[]): string[] {
  const formats = conditionsOf(manifest.config).filter((c) => c !== 'svg');
  if (formats.length === 0) return [];
  const lines = [
    '',
    '## Turn errors',
    '',
    `Each valid Zpup and Zdog scene is turned about the vertical axis to ${TURN_OFFSETS_DEG.length} views (its own view and every ${TURN_OFFSETS_DEG[1]}°), and each view is checked against a depth buffer on a grid of ${GRID_STEP === 1 ? 'one point per pixel' : `one point per ${GRID_STEP} by ${GRID_STEP} pixels`}. A point is wrong when the shape painted last there is more than ${DEPTH_TOLERANCE} px behind the shape that is really in front and the two have different colors. A sample's value is the share of covered points that are wrong, averaged over its views; "worst view" is its highest single view. SVG has one angle only and is not measured. See bench/README.md for what this does and does not catch.`,
    '',
    '| Model / format | Measured | Median | Mean | Above 1% | Median worst view |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  const row = (label: string, pool: ScoredSample[]) => {
    const valid = pool.filter((x) => x.finalValid);
    const measured = valid.flatMap((x) => (x.final?.turnErrors ? [x.final.turnErrors] : []));
    const means = measured.map((t) => t.mean);
    const worst = measured.map((t) => t.worst);
    const mean = means.length ? means.reduce((a, b) => a + b, 0) / means.length : undefined;
    const cell = (v: number | undefined) => (v === undefined ? '-' : percent(v));
    const unmeasured = valid.length - measured.length;
    return `| ${label} | ${measured.length}${unmeasured ? ` (+${unmeasured} not measured)` : ''} | ${cell(median(means))} | ${cell(mean)} | ${pct(
      means.filter((v) => v > 0.01).length,
      means.length,
    )} | ${cell(median(worst))} |`;
  };
  const models = manifest.config.models;
  for (const model of models) {
    for (const condition of formats) {
      lines.push(
        row(
          `${model.label} / ${CONDITION_LABEL[condition]}`,
          samples.filter((x) => x.record.model === model.id && x.record.condition === condition),
        ),
      );
    }
  }
  if (models.length > 1) {
    for (const condition of formats) {
      lines.push(
        row(
          `All models / ${CONDITION_LABEL[condition]}`,
          samples.filter((x) => x.record.condition === condition),
        ),
      );
    }
  }
  lines.push('', 'The three samples with the highest mean in each format:', '');
  for (const condition of formats) {
    const worst = samples
      .filter((x) => x.record.condition === condition && x.finalValid && x.final?.turnErrors)
      .sort((a, b) => (b.final?.turnErrors?.mean ?? 0) - (a.final?.turnErrors?.mean ?? 0))
      .slice(0, 3);
    const list = worst.map((x) => {
      const t = x.final?.turnErrors as TurnErrors;
      const model = models.find((m) => m.id === x.record.model)?.label ?? x.record.model;
      return `${x.record.taskId} (${model}, sample ${x.record.sample + 1}): ${percent(t.mean)}, worst ${percent(t.worst)} at +${t.worstOffsetDeg}°`;
    });
    lines.push(`- ${CONDITION_LABEL[condition]}: ${list.length ? list.join('; ') : 'none'}`);
  }
  const excluded = samples.reduce((n, x) => n + (x.final?.turnErrors?.excluded ?? 0), 0);
  if (excluded > 0) {
    lines.push(
      '',
      `${excluded} painted elements (summed over all views) could not be modeled and were left out; see bench/README.md.`,
    );
  }
  return lines;
}

export function summaryMarkdown(run: LoadedRun): string {
  const { manifest, samples } = run;
  const formats = conditionsOf(manifest.config);
  const lines: string[] = [];
  lines.push(`# Zpup bench: run ${manifest.runId}`, '');
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
    '"Truncated" counts first tries cut off at the output token limit (`finish_reason: "length"`, limit ' +
      `${manifest.config.maxTokens} tokens including reasoning). They are neither valid nor invalid, are left out of both validity columns, and get no repair. "On repair" counts repairs that were cut off.`,
    'Token, reasoning and latency columns describe every first try that returned, truncated ones included. Cost includes the repair call.',
    '"Valid after one repair" excludes samples whose repair was cut by the cost cap.',
    '',
  );

  lines.push('## By model and format', '', ...STATS_HEADER);
  for (const model of manifest.config.models) {
    for (const condition of formats) {
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
  for (const condition of formats) {
    lines.push(
      `| ${statsRow({ label: CONDITION_LABEL[condition], samples: samples.filter((x) => x.record.condition === condition) })} |`,
    );
  }

  lines.push('', '## Output size and reasoning', '');
  lines.push(
    'Median characters of the valid documents (the reply that passed, after code-fence extraction), and median reasoning tokens of every first try that returned, truncated ones included. A model that reasons much longer for Zpup than for SVG is spending effort on the unfamiliar format.',
    '',
    `| Model | ${formats.map((c) => `${SHORT_LABEL[c]} chars`).join(' | ')} | ${formats.map((c) => `${SHORT_LABEL[c]} reasoning tokens`).join(' | ')} |`,
    `| --- | ${formats.map(() => '---: | ---:').join(' | ')} |`,
  );
  const sizeRow = (label: string, pool: ScoredSample[]) => {
    const of = (c: Condition) => pool.filter((x) => x.record.condition === c);
    const chars = (c: Condition) => values(of(c), (x) => (x.finalValid ? x.validChars : undefined));
    const reasoning = (c: Condition) =>
      values(
        of(c).filter((x) => x.status !== 'api-error'),
        (x) => x.firstReasoningTokens,
      );
    const cell = (v: number[]) => (v.length ? `${fmt(median(v))} (n=${v.length})` : '-');
    return `| ${label} | ${formats.map((c) => cell(chars(c))).join(' | ')} | ${formats.map((c) => cell(reasoning(c))).join(' | ')} |`;
  };
  for (const model of manifest.config.models) {
    lines.push(
      sizeRow(
        model.label,
        samples.filter((x) => x.record.model === model.id),
      ),
    );
  }
  lines.push(sizeRow('All models', samples));

  lines.push(...turnErrorLines(manifest, samples));

  lines.push(
    '',
    '## By task',
    '',
    'Each cell: valid on first try, then after one repair, out of the samples that were not truncated. "+1 cut" means one more sample was truncated.',
    '',
  );
  const columns = manifest.config.models.flatMap((m) =>
    formats.map((c) => ({ model: m, condition: c })),
  );
  lines.push(
    `| Task | ${columns.map((c) => `${c.model.label} ${c.condition}`).join(' | ')} |`,
    `| --- | ${columns.map(() => '---:').join(' | ')} |`,
  );
  for (const task of manifest.tasks) {
    const cells = columns.map(({ model, condition }) => {
      const all = samples.filter(
        (x) =>
          x.record.taskId === task.id &&
          x.record.model === model.id &&
          x.record.condition === condition &&
          x.status !== 'api-error',
      );
      if (all.length === 0) return '-';
      const s = all.filter((x) => x.status !== 'truncated');
      const cut = all.length - s.length;
      return `${s.filter((x) => x.firstValid).length}→${s.filter((x) => x.finalValid).length}/${s.length}${cut ? ` +${cut} cut` : ''}`;
    });
    lines.push(`| ${task.id} | ${cells.join(' | ')} |`);
  }

  lines.push('', '## Most common problems on the first try', '');
  for (const condition of formats) {
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

  lines.push('## Scene warnings (Zpup only, do not affect validity)', '');
  const zpupValid = samples.filter((x) => x.record.condition === 'zpup' && x.finalValid);
  const kinds = [
    ...new Set(zpupValid.flatMap((x) => (x.final?.sceneWarnings ?? []).map((w) => w.kind))),
  ].sort();
  lines.push(
    `What \`checkSceneWarnings\` reports for each valid Zpup scene: angles that look like radians, shapes entirely outside the image, solids whose color cannot be shaded, and shapes of different colors that pass through each other. Each cell counts scenes with at least one warning of that kind, out of the valid scenes.`,
    '',
  );
  if (kinds.length === 0) {
    lines.push(`None (${zpupValid.length} valid scenes).`, '');
  } else {
    const models = manifest.config.models;
    lines.push(
      `| Kind | ${models.map((m) => m.label).join(' | ')} | All models |`,
      `| --- | ${models.map(() => '---:').join(' | ')} | ---: |`,
    );
    for (const kind of kinds) {
      const count = (pool: ScoredSample[]) =>
        `${pool.filter((x) => x.final?.sceneWarnings?.some((w) => w.kind === kind)).length}/${pool.length}`;
      lines.push(
        `| ${kind} | ${models.map((m) => count(zpupValid.filter((x) => x.record.model === m.id))).join(' | ')} | ${count(zpupValid)} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Other warnings (do not affect validity)', '');
  for (const condition of formats) {
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
