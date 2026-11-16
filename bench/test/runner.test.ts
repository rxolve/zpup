import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeReport } from '../lib/cli.ts';
import { loadConfig, loadTasks } from '../lib/config.ts';
import { estimateRun } from '../lib/estimate.ts';
import { loadPrompts } from '../lib/prompts.ts';
import { MockProvider, type MockResponder } from '../lib/providers.ts';
import { loadRun } from '../lib/report.ts';
import { planJobs, runBenchmark } from '../lib/runner.ts';
import type { BenchConfig, SampleRecord } from '../lib/types.ts';

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
    expect(provider.calls).toHaveLength(2); // one svg sample, one zpup sample
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

  it('stops before going over the cost cap', async () => {
    const config = smallConfig({
      maxCostUsd: 0.03,
      repetitions: 3,
      estimate: { outputTokensPerCall: 100, repairRate: 0 },
    });
    const { manifest, records } = await run(() => GOOD_SVG, config, allTasks);
    expect(manifest.stoppedReason).toMatch(/cost cap/);
    expect(records.length).toBeGreaterThan(0);
    expect(records.length).toBeLessThan(planJobs(config, allTasks).length);
    expect(manifest.spentUsd ?? 0).toBeLessThanOrEqual(0.03);
  });

  it('makes no call at all when even one call would go over the cap', async () => {
    const config = smallConfig({ maxCostUsd: 0.0001 });
    const { provider, manifest } = await run(() => GOOD_SVG, config);
    expect(provider.calls).toHaveLength(0);
    expect(manifest.stoppedReason).toMatch(/cost cap/);
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

describe('estimateRun', () => {
  it('plans every model, format, task and sample', () => {
    const config = loadConfig();
    const rows = estimateRun(config, allTasks, templates);
    expect(rows).toHaveLength(config.models.length * 2);
    const samples = rows.reduce((sum, r) => sum + r.samples, 0);
    expect(samples).toBe(planJobs(config, allTasks).length);
    expect(rows.every((r) => r.maxCostUsd >= r.expectedCostUsd)).toBe(true);
  });
});
