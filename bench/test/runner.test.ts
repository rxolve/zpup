import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { writeReport } from '../lib/cli.ts';
import { loadConfig, loadTasks, priceCall } from '../lib/config.ts';
import { estimateRun, readObservedCosts } from '../lib/estimate.ts';
import { loadPrompts } from '../lib/prompts.ts';
import { MockProvider, type MockResponder } from '../lib/providers.ts';
import { loadRun } from '../lib/report.ts';
import { planJobs, runBenchmark } from '../lib/runner.ts';
import type { BenchConfig, CompletionRequest, ModelConfig, SampleRecord } from '../lib/types.ts';

const templates = loadPrompts();
const allTasks = loadTasks();
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zpup-bench-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function smallConfig(overrides: Partial<BenchConfig> = {}): BenchConfig {
  const config = loadConfig();
  return {
    ...config,
    models: config.models.slice(0, 1),
    repetitions: 1,
    concurrency: 1,
    ...overrides,
  };
}

const GOOD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><circle cx="200" cy="200" r="50"/></svg>';
const BROKEN_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><g><circle r="5"/></svg>';
const GOOD_SCENE = JSON.stringify({
  width: 400,
  height: 400,
  children: [{ type: 'path', path: [{}], stroke: 40, color: '#e62' }],
});
const BROKEN_SCENE = JSON.stringify({
  width: 400,
  height: 400,
  children: [{ type: 'circle', diameter: 40 }],
});

async function run(respond: MockResponder, config = smallConfig(), tasks = allTasks.slice(0, 1)) {
  const provider = new MockProvider(respond);
  const outDir = tempDir();
  const manifest = await runBenchmark({
    provider,
    config,
    tasks,
    templates,
    outDir,
    runId: 'test',
  });
  const files = readdirSync(join(outDir, 'samples'));
  const records = files.map(
    (f) => JSON.parse(readFileSync(join(outDir, 'samples', f), 'utf8')) as SampleRecord,
  );
  return { provider, manifest, outDir, records };
}

describe('runBenchmark with the mock provider', () => {
  it('asks once when the first try is valid', async () => {
    const { provider, outDir } = await run(({ meta }) =>
      meta.condition === 'svg' ? GOOD_SVG : GOOD_SCENE,
    );
    expect(provider.calls).toHaveLength(2); // one svg sample, one Zpup sample
    const { samples } = loadRun(outDir);
    expect(samples.map((s) => [s.firstValid, s.finalValid, s.repaired])).toEqual([
      [true, true, false],
      [true, true, false],
    ]);
  });

  it('sends the checker report back once and scores the repair', async () => {
    const { provider, outDir } = await run(({ meta }) => {
      if (meta.condition === 'svg') return meta.attempt === 0 ? BROKEN_SVG : GOOD_SVG;
      return meta.attempt === 0 ? BROKEN_SCENE : GOOD_SCENE;
    });
    expect(provider.calls.map((c) => [c.meta.condition, c.meta.attempt])).toEqual(
      expect.arrayContaining([
        ['svg', 0],
        ['svg', 1],
        ['zpup', 0],
        ['zpup', 1],
      ]),
    );
    expect(provider.calls).toHaveLength(4);

    const zpupRepair = provider.calls.find(
      (c) => c.meta.condition === 'zpup' && c.meta.attempt === 1,
    );
    expect(zpupRepair?.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(zpupRepair?.messages[2]?.content).toBe(BROKEN_SCENE);
    expect(zpupRepair?.messages[3]?.content).toContain(
      'received "circle". Did you mean "ellipse"?',
    );

    const svgRepair = provider.calls.find(
      (c) => c.meta.condition === 'svg' && c.meta.attempt === 1,
    );
    expect(svgRepair?.messages[3]?.content).toMatch(/- XML parse error: 1:\d+:/);

    const { samples } = loadRun(outDir);
    for (const s of samples) {
      expect([s.firstValid, s.finalValid, s.repaired]).toEqual([false, true, true]);
    }
  });

  it('stops after one repair even if it is still broken', async () => {
    const { provider, outDir } = await run(({ meta }) =>
      meta.condition === 'svg' ? BROKEN_SVG : BROKEN_SCENE,
    );
    expect(provider.calls).toHaveLength(4);
    const { samples } = loadRun(outDir);
    expect(samples.every((s) => !s.finalValid && s.record.attempts.length === 2)).toBe(true);
  });

  it('records API errors without retrying through the repair path', async () => {
    const { outDir, provider } = await run(() => {
      throw new Error('boom');
    });
    expect(provider.calls).toHaveLength(2);
    const { samples } = loadRun(outDir);
    expect(samples.map((s) => s.status)).toEqual(['api-error', 'api-error']);
  });

  it('never goes over the cap, even when every reply uses all maxTokens and is billed above the listed price', async () => {
    const tasks = allTasks.slice(0, 6);
    for (const maxCostUsd of [0.15, 0.4, 1, 3]) {
      for (const concurrency of [1, 4]) {
        const config = smallConfig({
          models: loadConfig().models.slice(0, 2),
          maxTokens: 2000,
          maxCostUsd,
          repetitions: 2,
          concurrency,
        });
        // Far more expensive than the estimate assumes: the whole token limit, every
        // time, billed 1.4 times the listed price, with half the replies needing a repair.
        const respond: MockResponder = (request) => {
          const model = config.models.find((m) => m.id === request.model) as ModelConfig;
          const prompt = Math.ceil(request.messages.map((m) => m.content).join('\n').length / 3);
          const listed = priceCall(model, prompt, request.maxTokens);
          return {
            text: request.meta.sample === 0 && request.meta.attempt === 0 ? BROKEN_SVG : GOOD_SVG,
            completionTokens: request.maxTokens,
            costUsd: 1.4 * listed,
          };
        };
        const { manifest, records, provider } = await run(respond, config, tasks);
        const spent = records.flatMap((r) => r.attempts).reduce((sum, a) => sum + a.costUsd, 0);
        expect(spent).toBeLessThanOrEqual(maxCostUsd);
        expect(manifest.spentUsd ?? 0).toBeLessThanOrEqual(maxCostUsd);
        expect(provider.calls.length).toBeGreaterThan(0);
        if (records.length < planJobs(config, tasks).length) {
          expect(manifest.stoppedReason).toMatch(/cost cap/);
        }
      }
    }
  });

  it('reserves more for a model once it has been billed above the margin', async () => {
    const config = smallConfig({ maxTokens: 2000, maxCostUsd: 1, repetitions: 3 });
    const model = config.models[0] as ModelConfig;
    const listed = priceCall(model, 3000, 2000);
    // Three times the listed price, more than reserveMargin allows for: only the
    // first call can overshoot its reservation; later ones reserve at that ratio.
    const respond: MockResponder = () => ({
      text: GOOD_SVG,
      completionTokens: 2000,
      costUsd: 3 * listed,
    });
    const lines: string[] = [];
    const provider = new MockProvider(respond);
    const manifest = await runBenchmark({
      provider,
      config,
      tasks: allTasks,
      templates,
      outDir: tempDir(),
      runId: 'ratio',
      log: (line) => lines.push(line),
    });
    expect(lines.filter((l) => l.startsWith('Warning:'))).toHaveLength(1);
    const firstOvershoot = 3 * listed - config.reserveMargin * priceCall(model, 0, 2000);
    expect(manifest.spentUsd ?? 0).toBeLessThanOrEqual(config.maxCostUsd + firstOvershoot);
  });

  it('makes no call at all when even one worst-case call would go over the cap', async () => {
    const config = smallConfig({ maxCostUsd: 0.01 });
    const { provider, manifest } = await run(() => GOOD_SVG, config);
    expect(provider.calls).toHaveLength(0);
    expect(manifest.stoppedReason).toMatch(/cost cap/);
  });

  it('fills tasks, models and formats evenly when the cap stops a concurrent run', async () => {
    const tasks = allTasks.slice(0, 4);
    const config = smallConfig({
      models: loadConfig().models.slice(0, 2),
      maxTokens: 1000,
      repetitions: 1,
      concurrency: 4,
    });
    // Each call costs exactly its worst case at the listed prices, so the cap stops the run partway.
    const worst = (request: CompletionRequest) => {
      const model = config.models.find((m) => m.id === request.model) as ModelConfig;
      return priceCall(model, 0, request.maxTokens);
    };
    config.maxCostUsd = 0.45;
    const { records } = await run(
      async (request) => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
        // Every reply is valid, so no sample asks for a repair. Repairs would
        // join the queue for the budget in an order that depends on timing,
        // and the number of samples that fit under the cap with it.
        return {
          text: request.meta.condition === 'svg' ? GOOD_SVG : GOOD_SCENE,
          completionTokens: request.maxTokens,
          costUsd: worst(request),
        };
      },
      config,
      tasks,
    );
    // Reservations are granted in job order, so the run is the same prefix of
    // the plan whatever the timing: the first 11 of 16 samples fit.
    expect(records).toHaveLength(11);
    const spread = (key: (r: SampleRecord) => string) => {
      const counts = new Map<string, number>();
      for (const r of records) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
      return counts;
    };
    const tasksSeen = spread((r) => r.taskId);
    expect([...tasksSeen.keys()].sort()).toEqual(tasks.map((t) => t.id).sort());
    const range = (m: Map<string, number>) => Math.max(...m.values()) - Math.min(...m.values());
    expect(range(tasksSeen)).toBeLessThanOrEqual(2);
    expect(spread((r) => r.model).size).toBe(2);
    expect(range(spread((r) => r.model))).toBeLessThanOrEqual(2);
    expect(range(spread((r) => r.condition))).toBeLessThanOrEqual(1);
  });

  it('counts a reply cut off at the token limit as truncated and does not repair it', async () => {
    const { provider, outDir } = await run(({ meta, maxTokens }) =>
      meta.condition === 'svg'
        ? GOOD_SVG
        : {
            text: '{"width":400,"height":400,"chil',
            finishReason: 'length',
            completionTokens: maxTokens,
          },
    );
    expect(provider.calls).toHaveLength(2);
    const { samples } = loadRun(outDir);
    const zpup = samples.find((s) => s.record.condition === 'zpup');
    expect(zpup?.status).toBe('truncated');
    expect(zpup?.record.repairSkipped).toMatch(/truncated/);
    expect(zpup?.firstValid).toBe(false);
    const { summary } = writeReport(outDir);
    const md = readFileSync(summary, 'utf8');
    // Truncated is its own column; the validity columns have nothing left to count.
    expect(md).toMatch(/\| Zpup JSON \| 1 \| - \| - \| 1 \| 0 \|/);
    expect(md).not.toContain('JSON parse error');
  });

  it('collects scene warnings for valid Zpup scenes without affecting validity', async () => {
    const radians = JSON.stringify({
      width: 400,
      height: 400,
      rotate: { x: -0.35, y: 0.52 },
      children: [{ type: 'path', path: [{}], stroke: 40, color: '#e62' }],
    });
    const { outDir } = await run(({ meta }) => (meta.condition === 'svg' ? GOOD_SVG : radians));
    const { samples } = loadRun(outDir);
    const zpup = samples.find((s) => s.record.condition === 'zpup');
    expect(zpup?.finalValid).toBe(true);
    expect(zpup?.final?.sceneWarnings?.map((w) => w.kind)).toEqual(['angles look like radians']);
    const { summary, gallery } = writeReport(outDir);
    expect(readFileSync(summary, 'utf8')).toMatch(/\| angles look like radians \| 1\/1 \| 1\/1 \|/);
    expect(readFileSync(gallery, 'utf8')).toContain('1 scene warning: angles look like radians');
  });

  it('sends the configured reasoning parameter with every call, for both formats', async () => {
    const config = smallConfig({ reasoning: { effort: 'low' } });
    const { provider } = await run(
      ({ meta }) => (meta.condition === 'svg' ? GOOD_SVG : GOOD_SCENE),
      config,
    );
    expect(provider.calls.map((c) => c.reasoning)).toEqual([{ effort: 'low' }, { effort: 'low' }]);
    const plain = await run(({ meta }) => (meta.condition === 'svg' ? GOOD_SVG : GOOD_SCENE));
    expect(plain.provider.calls.every((c) => c.reasoning === undefined)).toBe(true);
  });

  it('resumes a run and skips samples already on disk', async () => {
    const config = smallConfig();
    const tasks = allTasks.slice(0, 2);
    const outDir = tempDir();
    const reply: MockResponder = ({ meta }) => (meta.condition === 'svg' ? GOOD_SVG : GOOD_SCENE);
    await runBenchmark({
      provider: new MockProvider(reply),
      config,
      tasks,
      templates,
      outDir,
      runId: 'r',
    });
    const second = new MockProvider(reply);
    await runBenchmark({ provider: second, config, tasks, templates, outDir, runId: 'r' });
    expect(second.calls).toHaveLength(0);
  });

  it('runs the default canned replies end to end and writes the report', async () => {
    const config = smallConfig({ models: loadConfig().models, repetitions: 2, concurrency: 3 });
    const provider = new MockProvider();
    const outDir = tempDir();
    await runBenchmark({ provider, config, tasks: allTasks, templates, outDir, runId: 'mock-e2e' });
    const { summary, gallery } = writeReport(outDir);
    const run = loadRun(outDir);
    expect(run.samples).toHaveLength(allTasks.length * config.models.length * 2 * 2);
    // The canned replies break some first tries on purpose.
    expect(run.samples.some((s) => s.repaired)).toBe(true);
    expect(run.samples.some((s) => !s.finalValid)).toBe(true);
    expect(run.samples.some((s) => s.status === 'truncated')).toBe(true);
    expect(run.samples.some((s) => s.final?.sceneWarnings?.length)).toBe(true);

    const md = readFileSync(summary, 'utf8');
    expect(md).toContain('## By model and format');
    expect(md).toContain('Mock run.');
    expect(md).toContain('| pelican-bicycle |');

    const html = readFileSync(gallery, 'utf8');
    expect(html).toContain('a pelican riding a bicycle');
    expect(html).toContain('data:image/svg+xml;base64,');
    expect(html).toContain('id="mode"');
    // Model output is only ever embedded as an image, never inline.
    expect(html).not.toMatch(/<svg[\s>]/);
  });
});

describe('planJobs', () => {
  it('keeps every prefix of the order balanced across tasks, models and formats', () => {
    for (const [taskCount, modelCount, repetitions] of [
      [4, 2, 1],
      [12, 4, 3],
      [5, 3, 2],
      [3, 4, 1],
    ] as const) {
      const base = loadConfig();
      const models = Array.from({ length: modelCount }, (_, i) => ({
        ...(base.models[0] as ModelConfig),
        id: `m${i}`,
      }));
      const config = { ...base, models, repetitions };
      const tasks = Array.from({ length: taskCount }, (_, i) => ({ id: `t${i}`, prompt: `t${i}` }));
      const jobs = planJobs(config, tasks);
      expect(jobs).toHaveLength(taskCount * modelCount * 2 * repetitions);
      expect(
        new Set(jobs.map((j) => `${j.model.id}|${j.task.id}|${j.condition}|${j.sample}`)).size,
      ).toBe(jobs.length);
      const range = (keys: string[], prefix: typeof jobs, key: (j: (typeof jobs)[0]) => string) => {
        const counts = new Map(keys.map((k) => [k, 0]));
        for (const j of prefix) counts.set(key(j), (counts.get(key(j)) ?? 0) + 1);
        return Math.max(...counts.values()) - Math.min(...counts.values());
      };
      for (let n = 1; n <= jobs.length; n++) {
        const prefix = jobs.slice(0, n);
        expect(
          range(
            tasks.map((t) => t.id),
            prefix,
            (j) => j.task.id,
          ),
        ).toBeLessThanOrEqual(2);
        expect(
          range(
            models.map((m) => m.id),
            prefix,
            (j) => j.model.id,
          ),
        ).toBeLessThanOrEqual(2);
        expect(range(['svg', 'zpup'], prefix, (j) => j.condition)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('reaches every task within the first three quarters of the pilot-1 plan', () => {
    const config = { ...loadConfig(), repetitions: 1 };
    config.models = config.models.slice(2, 4);
    const tasks = allTasks.slice(0, 4);
    const first12 = planJobs(config, tasks).slice(0, 12);
    expect(new Set(first12.map((j) => j.task.id)).size).toBe(4);
  });
});

describe('estimateRun', () => {
  it('plans every model, format, task and sample', () => {
    const config = loadConfig();
    const rows = estimateRun(config, allTasks, templates);
    expect(rows).toHaveLength(config.models.length * 2);
    const samples = rows.reduce((sum, r) => sum + r.samples, 0);
    expect(samples).toBe(planJobs(config, allTasks).length);
    expect(rows.every((r) => r.maxCostUsd >= r.expectedCostUsd)).toBe(true);
    expect(rows.every((r) => r.source === 'assumed')).toBe(true);
  });

  it('uses the measured cost per sample of an earlier run where it has one', () => {
    const config = loadConfig();
    const observed = readObservedCosts(
      fileURLToPath(new URL('../results/pilot-1', import.meta.url)),
    );
    const kimiZpup = observed.get('moonshotai/kimi-k3.1-pro|zpup');
    // The repair after the truncated pelican is left out: the runner no longer asks for one.
    expect(kimiZpup?.samples).toBe(3);
    expect(kimiZpup?.costPerSample).toBeCloseTo((0.1415 + 0.0538 + 0.1656) / 3, 3);
    const rows = estimateRun(config, allTasks, templates, observed);
    const row = rows.find((r) => r.model === 'moonshotai/kimi-k3.1-pro' && r.condition === 'zpup');
    expect(row?.source).toBe('observed');
    expect(row?.expectedCostUsd).toBeCloseTo((kimiZpup?.costPerSample ?? 0) * allTasks.length * 3);
    const claude = rows.find((r) => r.model === 'anthropic/claude-opus-5.5');
    expect(claude?.source).toBe('assumed');
  });
});
