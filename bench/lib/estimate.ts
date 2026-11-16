import { priceCall } from './config.ts';
import { firstMessages, type PromptTemplates, roughTokens } from './prompts.ts';
import { type BenchConfig, CONDITIONS, type Condition, type Task } from './types.ts';

export interface EstimateRow {
  model: string;
  condition: Condition;
  samples: number;
  /** Mean prompt tokens of a first try (rough: four characters per token). */
  promptTokens: number;
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
      rows.push({
        model: model.id,
        condition,
        samples,
        promptTokens: Math.round(promptTotal / tasks.length),
        expectedCalls: samples * (1 + repairRate),
        expectedCostUsd: expected * config.repetitions,
        maxCalls: samples * 2,
        maxCostUsd: max * config.repetitions,
      });
    }
  }
  return rows;
}

export function formatEstimate(config: BenchConfig, rows: EstimateRow[]): string {
  const pad = (s: string, n: number) => s.padEnd(n);
  const lpad = (s: string, n: number) => s.padStart(n);
  const lines = [
    `${pad('model', 30)} ${pad('format', 6)} ${lpad('samples', 7)} ${lpad('prompt tok', 10)} ${lpad('exp. calls', 10)} ${lpad('exp. $', 9)} ${lpad('max calls', 9)} ${lpad('max $', 9)}`,
  ];
  for (const r of rows) {
    lines.push(
      `${pad(r.model, 30)} ${pad(r.condition, 6)} ${lpad(String(r.samples), 7)} ${lpad(String(r.promptTokens), 10)} ${lpad(r.expectedCalls.toFixed(0), 10)} ${lpad(r.expectedCostUsd.toFixed(2), 9)} ${lpad(String(r.maxCalls), 9)} ${lpad(r.maxCostUsd.toFixed(2), 9)}`,
    );
  }
  const sum = (f: (r: EstimateRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  lines.push(
    `${pad('total', 37)} ${lpad(String(sum((r) => r.samples)), 7)} ${lpad('', 10)} ${lpad(sum((r) => r.expectedCalls).toFixed(0), 10)} ${lpad(sum((r) => r.expectedCostUsd).toFixed(2), 9)} ${lpad(String(sum((r) => r.maxCalls)), 9)} ${lpad(sum((r) => r.maxCostUsd).toFixed(2), 9)}`,
    '',
    `Expected: ${config.estimate.outputTokensPerCall} output tokens per call (reasoning included) and a repair for ${Math.round(config.estimate.repairRate * 100)}% of samples.`,
    `Max: every sample needs a repair and every call uses all ${config.maxTokens} output tokens.`,
    `Prompt tokens are a rough count (four characters per token). Cost cap: $${config.maxCostUsd}; the run stops before a call that would go over it.`,
  );
  return lines.join('\n');
}
