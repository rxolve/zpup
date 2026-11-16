import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { priceCall } from './config.ts';
import {
  firstMessages,
  type PromptTemplates,
  repairMessages,
  roughTokens,
  sha256,
} from './prompts.ts';
import { scoreReply } from './score.ts';
import {
  type AttemptRecord,
  type BenchConfig,
  type ChatMessage,
  CONDITIONS,
  type CompletionRequest,
  type CompletionResult,
  type Condition,
  type ModelConfig,
  type Provider,
  type RunManifest,
  type SampleRecord,
  type Task,
} from './types.ts';

export interface Job {
  model: ModelConfig;
  task: Task;
  condition: Condition;
  sample: number;
}

/**
 * Every (model, task, condition, sample) combination, ordered so that a run cut
 * short by the cost cap still covers all tasks, models and conditions evenly.
 *
 * Within one sample round, the k-th (task, model) pair uses model k mod M and
 * task (k + j) mod T, where j = floor(k / lcm(T, M)). Both cycle in step, so any
 * prefix is within one pair of even for tasks and for models, and the shift by
 * j makes the T x M pairs all different. The two conditions of a pair run back
 * to back, each model alternating which goes first. Each round starts one task further along.
 */
export function planJobs(config: BenchConfig, tasks: Task[]): Job[] {
  const jobs: Job[] = [];
  const t = tasks.length;
  const m = config.models.length;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const lcm = (t * m) / gcd(t, m);
  for (let sample = 0; sample < config.repetitions; sample++) {
    for (let k = 0; k < t * m; k++) {
      const task = tasks[(k + Math.floor(k / lcm) + sample) % t] as Task;
      const model = config.models[k % m] as ModelConfig;
      // Alternate which format goes first, per model.
      const order = (Math.floor(k / m) + sample) % 2 === 0 ? CONDITIONS : [...CONDITIONS].reverse();
      for (const condition of order) jobs.push({ model, task, condition, sample });
    }
  }
  return jobs;
}

export const modelSlug = (id: string) => id.replace(/[^a-zA-Z0-9.-]+/g, '_');

export function sampleFileName(job: {
  model: { id: string } | string;
  condition: Condition;
  task: { id: string } | string;
  sample: number;
}): string {
  const model = typeof job.model === 'string' ? job.model : job.model.id;
  const task = typeof job.task === 'string' ? job.task : job.task.id;
  return `${modelSlug(model)}__${job.condition}__${task}__s${job.sample}.json`;
}

/**
 * What a call reserves before it starts: its worst case, where the reply uses
 * all of `maxTokens`, at the listed prices, times a margin. The prompt is
 * counted at twice the rough estimate, because the rough count (four
 * characters per token) came out 20 to 70% low in the first real run. The
 * margin is the larger of `reserveMargin` and the highest ratio of billed cost
 * to listed price seen so far for that model.
 */
export function worstCaseCost(
  model: ModelConfig,
  messages: ChatMessage[],
  config: Pick<BenchConfig, 'maxTokens' | 'reserveMargin'>,
  observedPriceRatio = 1,
): number {
  const prompt = 2 * roughTokens(messages.map((m) => m.content).join('\n'));
  return (
    priceCall(model, prompt, config.maxTokens) * Math.max(config.reserveMargin, observedPriceRatio)
  );
}

/**
 * Tracks spend against the cap. A call starts only after it has reserved its
 * worst case; reservations are granted in the order they are asked for, and a
 * reservation that does not fit waits for calls in flight to settle. The run
 * stops when a reservation does not fit and nothing is in flight. So the cap
 * holds as long as no call is billed more than it reserved.
 */
export class Budget {
  spent = 0;
  stopped = false;
  readonly maxUsd: number;
  private reserved = 0;
  private inFlight = 0;
  private readonly queue: { amount: number; resolve: (ok: boolean) => void }[] = [];

  constructor(maxUsd: number) {
    this.maxUsd = maxUsd;
  }

  /** Resolves to true once `amount` is reserved, or false if the run has stopped. */
  reserve(amount: number): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.queue.push({ amount, resolve });
      this.drain();
    });
  }

  /** Releases a reservation and records what the call actually cost. */
  settle(amount: number, actual: number): void {
    this.inFlight--;
    this.reserved = this.inFlight === 0 ? 0 : this.reserved - amount;
    this.spent += actual;
    if (this.spent >= this.maxUsd) this.stopped = true;
    this.drain();
  }

  private drain(): void {
    while (this.queue.length > 0) {
      const head = this.queue[0] as { amount: number; resolve: (ok: boolean) => void };
      if (!this.stopped && this.spent + this.reserved + head.amount > this.maxUsd) {
        if (this.inFlight > 0) return; // wait: a call in flight may settle for less
        this.stopped = true;
      }
      this.queue.shift();
      if (this.stopped) {
        head.resolve(false);
      } else {
        this.reserved += head.amount;
        this.inFlight++;
        head.resolve(true);
      }
    }
  }
}

/** Ratio of billed cost to the cost at the listed prices, for a call that reported its cost. */
function priceRatio(model: ModelConfig, response: CompletionResult): number | undefined {
  const { costUsd, promptTokens, completionTokens } = response.usage;
  if (costUsd === undefined) return undefined;
  const listed = priceCall(model, promptTokens, completionTokens);
  return listed > 0 ? costUsd / listed : undefined;
}

export interface RunOptions {
  provider: Provider;
  config: BenchConfig;
  tasks: Task[];
  templates: PromptTemplates;
  /** Directory for this run: bench/results/<run id>. Existing sample files are kept and skipped. */
  outDir: string;
  runId: string;
  gitCommit?: string;
  log?: (line: string) => void;
}

export async function runBenchmark(options: RunOptions): Promise<RunManifest> {
  const { provider, config, tasks, templates, outDir } = options;
  const log = options.log ?? (() => {});
  const samplesDir = join(outDir, 'samples');
  mkdirSync(samplesDir, { recursive: true });

  const manifest: RunManifest = {
    runId: options.runId,
    provider: provider.name,
    startedAt: new Date().toISOString(),
    referenceSha256: sha256(templates.reference),
    config,
    tasks,
  };
  if (options.gitCommit) manifest.gitCommit = options.gitCommit;
  const writeManifest = () =>
    writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeManifest();

  const budget = new Budget(config.maxCostUsd);
  const state: RunState = { budget, ratios: new Map() };
  // Count what an earlier, interrupted run with the same id already spent.
  for (const name of existsSync(samplesDir) ? readdirSync(samplesDir) : []) {
    const record = JSON.parse(readFileSync(join(samplesDir, name), 'utf8')) as SampleRecord;
    const model = config.models.find((m) => m.id === record.model);
    for (const a of record.attempts) {
      budget.spent += a.costUsd;
      if (model && a.response) noteRatio(state, model, a.response);
    }
  }
  if (budget.spent >= budget.maxUsd) budget.stopped = true;

  const jobs = planJobs(config, tasks).filter(
    (job) => !existsSync(join(samplesDir, sampleFileName(job))),
  );
  log(
    `${jobs.length} samples to run with ${provider.name}; spent so far $${budget.spent.toFixed(4)}.`,
  );

  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length && !budget.stopped) {
      const job = jobs[next++] as Job;
      const result = await runSample(job, options, state);
      if (result) {
        const { record, status } = result;
        writeFileSync(
          join(samplesDir, sampleFileName(job)),
          `${JSON.stringify(record, null, 2)}\n`,
        );
        done++;
        log(describeSample(record, status, done, jobs.length, budget.spent));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, config.concurrency) }, worker));

  manifest.finishedAt = new Date().toISOString();
  manifest.spentUsd = budget.spent;
  if (budget.stopped && done < jobs.length) {
    manifest.stoppedReason = `cost cap of $${config.maxCostUsd} reached after ${done} of ${jobs.length} samples`;
    log(`Stopped: ${manifest.stoppedReason}.`);
  }
  writeManifest();
  return manifest;
}

interface RunState {
  budget: Budget;
  /** Per model, the highest ratio of billed cost to listed price seen so far. */
  ratios: Map<string, number>;
}

function noteRatio(state: RunState, model: ModelConfig, response: CompletionResult): void {
  const ratio = priceRatio(model, response);
  if (ratio !== undefined && ratio > (state.ratios.get(model.id) ?? 0)) {
    state.ratios.set(model.id, ratio);
  }
}

async function runSample(
  job: Job,
  options: RunOptions,
  state: RunState,
): Promise<{ record: SampleRecord; status: string } | undefined> {
  const { config, templates } = options;
  const record: SampleRecord = {
    model: job.model.id,
    condition: job.condition,
    taskId: job.task.id,
    taskPrompt: job.task.prompt,
    sample: job.sample,
    attempts: [],
    startedAt: new Date().toISOString(),
  };
  const first = firstMessages(templates, job.condition, job.task.prompt);
  const firstAttempt = await call(job, 0, first, options, state);
  if (!firstAttempt) return undefined; // the cost cap stopped the run before this sample began
  record.attempts.push(firstAttempt);
  if (!firstAttempt.response) return { record, status: `API error: ${firstAttempt.error}` };
  // A reply cut off at the token limit is not a format error, and sending it
  // back with a parse error does not make the model write less.
  if (firstAttempt.response.finishReason === 'length') {
    record.repairSkipped = 'truncated at the output token limit';
    return {
      record,
      status: `truncated at ${firstAttempt.response.usage.completionTokens} output tokens`,
    };
  }

  const score = scoreReply(job.condition, firstAttempt.response.text, config);
  if (score.valid) return { record, status: 'valid on first try' };

  const repair = repairMessages(
    templates,
    job.condition,
    first,
    firstAttempt.response.text,
    score.problems,
  );
  const second = await call(job, 1, repair, options, state);
  if (!second) {
    record.repairSkipped = 'cost cap reached';
    return { record, status: 'invalid, repair skipped (cost cap)' };
  }
  record.attempts.push(second);
  if (!second.response) return { record, status: `invalid, repair API error: ${second.error}` };
  const repaired = scoreReply(job.condition, second.response.text, config);
  if (second.response.finishReason === 'length') {
    return { record, status: 'invalid, repair truncated' };
  }
  return { record, status: repaired.valid ? 'valid after repair' : 'invalid after repair' };
}

async function call(
  job: Job,
  attempt: number,
  messages: ChatMessage[],
  options: RunOptions,
  state: RunState,
): Promise<AttemptRecord | undefined> {
  const { config } = options;
  const reservation = worstCaseCost(job.model, messages, config, state.ratios.get(job.model.id));
  if (!(await state.budget.reserve(reservation))) return undefined;
  try {
    const request: CompletionRequest = {
      model: job.model.id,
      messages,
      maxTokens: config.maxTokens,
      meta: { taskId: job.task.id, condition: job.condition, sample: job.sample, attempt },
    };
    if (config.reasoning) request.reasoning = config.reasoning;
    const response = await options.provider.complete(request);
    const costUsd =
      response.usage.costUsd ??
      priceCall(job.model, response.usage.promptTokens, response.usage.completionTokens);
    noteRatio(state, job.model, response);
    if (costUsd > reservation) {
      options.log?.(
        `Warning: ${job.model.id} billed $${costUsd.toFixed(4)} for a call that reserved $${reservation.toFixed(4)}; later calls to it reserve more.`,
      );
    }
    state.budget.settle(reservation, costUsd);
    return { attempt, messages, response, costUsd };
  } catch (error) {
    state.budget.settle(reservation, 0);
    return { attempt, messages, costUsd: 0, error: (error as Error).message };
  }
}

function describeSample(
  record: SampleRecord,
  status: string,
  done: number,
  total: number,
  spent: number,
): string {
  const cost = record.attempts.reduce((sum, a) => sum + a.costUsd, 0);
  return `[${done}/${total}] ${record.model} ${record.condition} ${record.taskId} s${record.sample}: ${status}, $${cost.toFixed(4)} (total $${spent.toFixed(4)})`;
}
