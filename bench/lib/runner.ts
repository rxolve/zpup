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
 * short by the cost cap still covers all models, tasks and conditions evenly.
 */
export function planJobs(config: BenchConfig, tasks: Task[]): Job[] {
  const jobs: Job[] = [];
  for (let sample = 0; sample < config.repetitions; sample++) {
    for (const task of tasks) {
      for (const model of config.models) {
        for (const condition of CONDITIONS) jobs.push({ model, task, condition, sample });
      }
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

/** Expected cost of one call: the real prompt length plus an assumed reply length. */
export function estimateCallCost(
  model: ModelConfig,
  messages: ChatMessage[],
  outputTokens: number,
): number {
  const prompt = roughTokens(messages.map((m) => m.content).join('\n'));
  return priceCall(model, prompt, outputTokens);
}

/** Tracks spend against the cap. Calls in flight reserve their estimated cost. */
export class Budget {
  spent = 0;
  private reserved = 0;
  stopped = false;
  readonly maxUsd: number;
  constructor(maxUsd: number) {
    this.maxUsd = maxUsd;
  }

  /** Reserves `estimate` if it fits under the cap; otherwise stops the run. */
  tryReserve(estimate: number): boolean {
    if (this.stopped) return false;
    if (this.spent + this.reserved + estimate > this.maxUsd) {
      this.stopped = true;
      return false;
    }
    this.reserved += estimate;
    return true;
  }

  settle(estimate: number, actual: number): void {
    this.reserved -= estimate;
    this.spent += actual;
    if (this.spent >= this.maxUsd) this.stopped = true;
  }
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
  // Count what an earlier, interrupted run with the same id already spent.
  for (const name of existsSync(samplesDir) ? readdirSync(samplesDir) : []) {
    const record = JSON.parse(readFileSync(join(samplesDir, name), 'utf8')) as SampleRecord;
    for (const a of record.attempts) budget.spent += a.costUsd;
  }

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
      const result = await runSample(job, options, budget);
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

async function runSample(
  job: Job,
  options: RunOptions,
  budget: Budget,
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
  const firstAttempt = await call(job, 0, first, options, budget);
  if (!firstAttempt) return undefined; // the cost cap stopped the run before this sample began
  record.attempts.push(firstAttempt);
  if (!firstAttempt.response) return { record, status: `API error: ${firstAttempt.error}` };

  const score = scoreReply(job.condition, firstAttempt.response.text, config);
  if (score.valid) return { record, status: 'valid on first try' };

  const repair = repairMessages(
    templates,
    job.condition,
    first,
    firstAttempt.response.text,
    score.problems,
  );
  const second = await call(job, 1, repair, options, budget);
  if (!second) {
    record.repairSkipped = 'cost cap reached';
    return { record, status: 'invalid, repair skipped (cost cap)' };
  }
  record.attempts.push(second);
  if (!second.response) return { record, status: `invalid, repair API error: ${second.error}` };
  const repaired = scoreReply(job.condition, second.response.text, config);
  return { record, status: repaired.valid ? 'valid after repair' : 'invalid after repair' };
}

async function call(
  job: Job,
  attempt: number,
  messages: ChatMessage[],
  options: RunOptions,
  budget: Budget,
): Promise<AttemptRecord | undefined> {
  const estimate = estimateCallCost(
    job.model,
    messages,
    options.config.estimate.outputTokensPerCall,
  );
  if (!budget.tryReserve(estimate)) return undefined;
  try {
    const response = await options.provider.complete({
      model: job.model.id,
      messages,
      maxTokens: options.config.maxTokens,
      meta: { taskId: job.task.id, condition: job.condition, sample: job.sample, attempt },
    });
    const costUsd =
      response.usage.costUsd ??
      priceCall(job.model, response.usage.promptTokens, response.usage.completionTokens);
    budget.settle(estimate, costUsd);
    return { attempt, messages, response, costUsd };
  } catch (error) {
    budget.settle(estimate, 0);
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
