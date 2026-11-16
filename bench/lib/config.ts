import { readFileSync } from 'node:fs';
import type { BenchConfig, ModelConfig, Task } from './types.ts';

export const BENCH_DIR = new URL('../', import.meta.url);
export const REPO_DIR = new URL('../../', import.meta.url);

export function readJson(path: string | URL): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function fail(message: string): never {
  throw new Error(`bench config: ${message}`);
}

function num(value: unknown, where: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    fail(`${where} must be a number of at least ${min}`);
  }
  return value;
}

function str(value: unknown, where: string): string {
  if (typeof value !== 'string' || value === '') fail(`${where} must be a non-empty string`);
  return value;
}

function obj(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function parseConfig(input: unknown): BenchConfig {
  const c = obj(input, 'config');
  if (!Array.isArray(c.models) || c.models.length === 0) fail('models must be a non-empty array');
  const models = c.models.map((m, i): ModelConfig => {
    const o = obj(m, `models[${i}]`);
    const model: ModelConfig = {
      id: str(o.id, `models[${i}].id`),
      label: str(o.label, `models[${i}].label`),
      promptPricePerM: num(o.promptPricePerM, `models[${i}].promptPricePerM`),
      completionPricePerM: num(o.completionPricePerM, `models[${i}].completionPricePerM`),
    };
    if (typeof o.why === 'string') model.why = o.why;
    return model;
  });
  const canvas = obj(c.canvas, 'canvas');
  const estimate = obj(c.estimate, 'estimate');
  if (!Array.isArray(c.rotationOffsetsDeg) || c.rotationOffsetsDeg.length === 0) {
    fail('rotationOffsetsDeg must be a non-empty array of numbers');
  }
  return {
    models,
    repetitions: Math.floor(num(c.repetitions, 'repetitions', 1)),
    maxCostUsd: num(c.maxCostUsd, 'maxCostUsd'),
    maxTokens: Math.floor(num(c.maxTokens, 'maxTokens', 1)),
    concurrency: Math.floor(num(c.concurrency, 'concurrency', 1)),
    canvas: {
      width: num(canvas.width, 'canvas.width', 1),
      height: num(canvas.height, 'canvas.height', 1),
    },
    rotationOffsetsDeg: c.rotationOffsetsDeg.map((d, i) =>
      num(d, `rotationOffsetsDeg[${i}]`, Number.NEGATIVE_INFINITY),
    ),
    estimate: {
      outputTokensPerCall: num(estimate.outputTokensPerCall, 'estimate.outputTokensPerCall'),
      repairRate: num(estimate.repairRate, 'estimate.repairRate'),
    },
  };
}

export function parseTasks(input: unknown): Task[] {
  const o = obj(input, 'tasks file');
  if (!Array.isArray(o.tasks) || o.tasks.length === 0) fail('tasks must be a non-empty array');
  const ids = new Set<string>();
  return o.tasks.map((t, i) => {
    const task = obj(t, `tasks[${i}]`);
    const id = str(task.id, `tasks[${i}].id`);
    if (!/^[a-z0-9-]+$/.test(id)) fail(`tasks[${i}].id must use only a-z, 0-9 and "-"`);
    if (ids.has(id)) fail(`duplicate task id "${id}"`);
    ids.add(id);
    return { id, prompt: str(task.prompt, `tasks[${i}].prompt`) };
  });
}

export function loadConfig(path: string | URL = new URL('config.json', BENCH_DIR)): BenchConfig {
  return parseConfig(readJson(path));
}

export function loadTasks(path: string | URL = new URL('tasks.json', BENCH_DIR)): Task[] {
  return parseTasks(readJson(path));
}

/** Cost in USD of a call with the given token counts, from config prices. */
export function priceCall(
  model: ModelConfig,
  promptTokens: number,
  completionTokens: number,
): number {
  return (
    (promptTokens * model.promptPricePerM + completionTokens * model.completionPricePerM) /
    1_000_000
  );
}
