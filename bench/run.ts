/**
 * Runs the benchmark. See bench/README.md.
 *
 *   node bench/run.ts --dry-run                 # plan and cost estimate, no calls
 *   node bench/run.ts --provider mock           # full pipeline with canned replies
 *   node bench/run.ts --provider openrouter     # real calls (asks before starting)
 */
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gitCommit, timestampId, writeReport } from './lib/cli.ts';
import { BENCH_DIR, loadConfig, loadTasks, REPO_DIR } from './lib/config.ts';
import { estimateRun, formatEstimate } from './lib/estimate.ts';
import { loadPrompts } from './lib/prompts.ts';
import { MockProvider, OpenRouterProvider, readOpenRouterKey } from './lib/providers.ts';
import { runBenchmark } from './lib/runner.ts';
import type { Provider } from './lib/types.ts';

const { values } = parseArgs({
  options: {
    provider: { type: 'string' },
    config: { type: 'string' },
    tasks: { type: 'string' },
    models: { type: 'string' },
    reps: { type: 'string' },
    'max-cost': { type: 'string' },
    concurrency: { type: 'string' },
    'run-id': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(`Usage: node bench/run.ts [options]

  --provider mock|openrouter   required unless --dry-run
  --dry-run                    print the plan and the cost estimate, make no calls
  --config <file>              default bench/config.json
  --tasks a,b                  task ids to run (default: all in bench/tasks.json)
  --models a,b                 model ids to run (default: all in the config)
  --reps <n>                   samples per model, format and task (config: repetitions)
  --max-cost <usd>             stop before spending more than this (config: maxCostUsd)
  --concurrency <n>            calls in flight (config: concurrency)
  --run-id <id>                results go to bench/results/<id>; an existing run resumes
  --yes                        do not ask before real calls`);
  process.exit(0);
}

const config = loadConfig(values.config ?? new URL('config.json', BENCH_DIR));
let tasks = loadTasks();
if (values.tasks) {
  const wanted = values.tasks.split(',');
  const unknown = wanted.filter((id) => !tasks.some((t) => t.id === id));
  if (unknown.length) throw new Error(`unknown task ids: ${unknown.join(', ')}`);
  tasks = tasks.filter((t) => wanted.includes(t.id));
}
if (values.models) {
  const wanted = values.models.split(',');
  const unknown = wanted.filter((id) => !config.models.some((m) => m.id === id));
  if (unknown.length) throw new Error(`model ids not in the config: ${unknown.join(', ')}`);
  config.models = config.models.filter((m) => wanted.includes(m.id));
}
const positive = (text: string, name: string) => {
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number`);
  return n;
};
if (values.reps) config.repetitions = Math.floor(positive(values.reps, 'reps'));
if (values['max-cost']) config.maxCostUsd = positive(values['max-cost'], 'max-cost');
if (values.concurrency)
  config.concurrency = Math.floor(positive(values.concurrency, 'concurrency'));

const templates = loadPrompts();
const rows = estimateRun(config, tasks, templates);
console.log(
  `Plan: ${tasks.length} tasks x ${config.models.length} models x 2 formats x ${config.repetitions} samples = ${tasks.length * config.models.length * 2 * config.repetitions} samples.\n`,
);
console.log(formatEstimate(config, rows));

if (values['dry-run']) process.exit(0);

let provider: Provider;
if (values.provider === 'mock') {
  provider = new MockProvider();
} else if (values.provider === 'openrouter') {
  const apiKey = readOpenRouterKey(new URL('.env', REPO_DIR));
  provider = new OpenRouterProvider({ apiKey });
  if (!values.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('\nThis makes real, paid API calls. Continue? [y/N] ');
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') process.exit(1);
  }
} else {
  throw new Error('--provider must be "mock" or "openrouter" (or use --dry-run)');
}

const runId = values['run-id'] ?? `${provider.name === 'mock' ? 'mock-' : ''}${timestampId()}`;
if (!/^[\w.-]+$/.test(runId))
  throw new Error('--run-id may use only letters, digits, ".", "_" and "-"');
const outDir = join(fileURLToPath(BENCH_DIR), 'results', runId);
const commit = gitCommit(REPO_DIR);
const manifest = await runBenchmark({
  provider,
  config,
  tasks,
  templates,
  outDir,
  runId,
  ...(commit ? { gitCommit: commit } : {}),
  log: (line) => console.log(line),
});
const { summary, gallery } = writeReport(outDir);
console.log(`\nSpent $${(manifest.spentUsd ?? 0).toFixed(4)}.\nWrote ${summary}\nWrote ${gallery}`);
