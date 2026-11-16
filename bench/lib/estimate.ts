import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { priceCall } from './config.ts';
import { firstMessages, type PromptTemplates, roughTokens } from './prompts.ts';
import { worstCaseCost } from './runner.ts';
import {
  type BenchConfig,
  CONDITIONS,
  type Condition,
  type SampleRecord,
  type Task,
} from './types.ts';

/** Measured cost per sample for one model and condition, from an earlier run. */
export interface ObservedCost {
  samples: number;
  costPerSample: number;
  callsPerSample: number;
}

/** Observed costs keyed by `${model id}|${condition}`. */
export type ObservedCosts = Map<string, ObservedCost>;

const key = (model: string, condition: Condition) => `${model}|${condition}`;

/**
 * Reads the mean billed cost per sample, by model and condition, from an
 * earlier run's samples. Samples whose first call failed are left out. A repair
 * that followed a truncated first try is left out too, because the runner no
 * longer asks for one.
 */
export function readObservedCosts(runDir: string): ObservedCosts {
  const dir = join(runDir, 'samples');
  if (!existsSync(dir)) throw new Error(`no samples directory in ${runDir}`);
  const sums = new Map<string, { samples: number; cost: number; calls: number }>();
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const record = JSON.parse(readFileSync(join(dir, name), 'utf8')) as SampleRecord;
    const [first, ...rest] = record.attempts;
    if (!first?.response) continue;
    const truncated = first.response.finishReason === 'length';
    const cost = first.costUsd + (truncated ? 0 : rest.reduce((sum, a) => sum + a.costUsd, 0));
    const entry = sums.get(key(record.model, record.condition)) ?? {
      samples: 0,
      cost: 0,
      calls: 0,
    };
    entry.samples++;
    entry.cost += cost;
    entry.calls += truncated ? 1 : record.attempts.length;
    sums.set(key(record.model, record.condition), entry);
  }
  return new Map(
    [...sums].map(([k, v]) => [
      k,
      {
        samples: v.samples,
        costPerSample: v.cost / v.samples,
        callsPerSample: v.calls / v.samples,
      },
    ]),
  );
}

export interface EstimateRow {
  model: string;
  condition: Condition;
  samples: number;
  /** Mean prompt tokens of a first try (rough: four characters per token). */
  promptTokens: number;
  /** Where the expected cost comes from: measured in an earlier run, or the config's assumptions. */
  source: 'observed' | 'assumed';
  /** For an observed row, how many earlier samples the figure rests on. */
  observedSamples?: number;
  expectedCalls: number;
  expectedCostUsd: number;
  maxCalls: number;
  maxCostUsd: number;
}

/** Extra prompt tokens a repair adds besides the echoed reply: the checker's report and the instruction. */
const REPAIR_OVERHEAD_TOKENS = 200;

export function estimateRun(
  config: BenchConfig,
  tasks: Task[],
  templates: PromptTemplates,
  observed?: ObservedCosts,
): EstimateRow[] {
  const { outputTokensPerCall, repairRate } = config.estimate;
  const rows: EstimateRow[] = [];
  for (const model of config.models) {
    for (const condition of CONDITIONS) {
      let expected = 0;
      let max = 0;
      let promptTotal = 0;
      for (const task of tasks) {
        const prompt = roughTokens(
          firstMessages(templates, condition, task.prompt)
            .map((m) => m.content)
            .join('\n'),
        );
        promptTotal += prompt;
        const first = priceCall(model, prompt, outputTokensPerCall);
        const repair = priceCall(
          model,
          prompt + outputTokensPerCall + REPAIR_OVERHEAD_TOKENS,
          outputTokensPerCall,
        );
        expected += first + repairRate * repair;
        max +=
          priceCall(model, prompt, config.maxTokens) +
          priceCall(model, prompt + config.maxTokens + REPAIR_OVERHEAD_TOKENS, config.maxTokens);
      }
      const samples = tasks.length * config.repetitions;
      const seen = observed?.get(key(model.id, condition));
      const row: EstimateRow = {
        model: model.id,
        condition,
        samples,
        promptTokens: Math.round(promptTotal / tasks.length),
        source: seen ? 'observed' : 'assumed',
        expectedCalls: samples * (seen ? seen.callsPerSample : 1 + repairRate),
        expectedCostUsd: seen ? seen.costPerSample * samples : expected * config.repetitions,
        maxCalls: samples * 2,
        maxCostUsd: max * config.repetitions,
      };
      if (seen) row.observedSamples = seen.samples;
      rows.push(row);
    }
  }
  return rows;
}

/** The largest amount one call reserves under the cost cap: a first try at the listed prices. */
export function largestReservation(
  config: BenchConfig,
  tasks: Task[],
  templates: PromptTemplates,
): number {
  let largest = 0;
  for (const model of config.models) {
    for (const condition of CONDITIONS) {
      for (const task of tasks) {
        const messages = firstMessages(templates, condition, task.prompt);
        largest = Math.max(largest, worstCaseCost(model, messages, config));
      }
    }
  }
  return largest;
}

export function formatEstimate(
  config: BenchConfig,
  rows: EstimateRow[],
  options: { observedFrom?: string; largestReservationUsd?: number } = {},
): string {
  const pad = (s: string, n: number) => s.padEnd(n);
  const lpad = (s: string, n: number) => s.padStart(n);
  const lines = [
    `${pad('model', 30)} ${pad('format', 6)} ${lpad('samples', 7)} ${lpad('prompt tok', 10)} ${lpad('exp. calls', 10)} ${lpad('exp. $', 9)} ${pad(' basis', 14)} ${lpad('max calls', 9)} ${lpad('max $', 9)}`,
  ];
  for (const r of rows) {
    const basis = r.source === 'observed' ? ` measured n=${r.observedSamples}` : ' assumed';
    lines.push(
      `${pad(r.model, 30)} ${pad(r.condition, 6)} ${lpad(String(r.samples), 7)} ${lpad(String(r.promptTokens), 10)} ${lpad(r.expectedCalls.toFixed(0), 10)} ${lpad(r.expectedCostUsd.toFixed(2), 9)} ${pad(basis, 14)} ${lpad(String(r.maxCalls), 9)} ${lpad(r.maxCostUsd.toFixed(2), 9)}`,
    );
  }
  const sum = (f: (r: EstimateRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  lines.push(
    `${pad('total', 37)} ${lpad(String(sum((r) => r.samples)), 7)} ${lpad('', 10)} ${lpad(sum((r) => r.expectedCalls).toFixed(0), 10)} ${lpad(sum((r) => r.expectedCostUsd).toFixed(2), 9)} ${pad('', 14)} ${lpad(String(sum((r) => r.maxCalls)), 9)} ${lpad(sum((r) => r.maxCostUsd).toFixed(2), 9)}`,
    '',
  );
  if (rows.some((r) => r.source === 'observed')) {
    lines.push(
      `Measured: the mean billed cost per sample for that model and format in ${options.observedFrom ?? 'an earlier run'} (repairs after a truncated reply left out). It reflects that run's prompts and token limit, which may differ from this one's.`,
    );
  }
  if (rows.some((r) => r.source === 'assumed')) {
    lines.push(
      `Assumed: ${config.estimate.outputTokensPerCall} output tokens per call (reasoning included) at the listed prices, and a repair for ${Math.round(config.estimate.repairRate * 100)}% of samples.`,
    );
  }
  lines.push(
    `Max: every sample needs a repair and every call uses all ${config.maxTokens} output tokens, at the listed prices.`,
    `Prompt tokens are a rough count (four characters per token). Cost cap: $${config.maxCostUsd}. Each call first reserves its worst case (all ${config.maxTokens} output tokens, prompt counted double) times ${config.reserveMargin}, and does not start unless that fits under the cap.`,
  );
  if (options.largestReservationUsd !== undefined) {
    lines.push(
      `The largest single reservation is $${options.largestReservationUsd.toFixed(2)}, so the run stops with up to that much of the cap unspent.${options.largestReservationUsd > config.maxCostUsd ? ' That is more than the cap: no call of that kind can start.' : ''}`,
    );
  }
  return lines.join('\n');
}
