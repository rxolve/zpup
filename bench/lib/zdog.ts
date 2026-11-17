/**
 * Runs a model-written Zdog script in a separate, locked-down Node process
 * and returns the SVG it draws. See zdog-runner.cjs for what the process does.
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BENCH_DIR, REPO_DIR } from './config.ts';
import { type Point, type Primitive, solidFrame } from './turns.ts';

export interface ZdogRun {
  ok: boolean;
  error?: string;
  svg?: string;
  /** Number of <path> elements with a `d` in the picture. */
  paths?: number;
  /** Whether the script itself called `updateRenderGraph()`. */
  rendered?: boolean;
  rotations?: { offsetDeg: number; svg?: string; error?: string }[];
  /** For each of `turnsDeg`: what Zdog painted, in paint order (see zdog-runner.cjs). */
  turns?: ZdogTurn[];
}

export interface ZdogTurn {
  offsetDeg: number;
  /** Missing when the view could not be read; see `error`. */
  primitives?: Primitive[];
  /** Painted elements that could not be modeled and were left out. */
  excluded: number;
  /** Painted elements in the SVG. */
  elements: number;
  error?: string;
}

const RUNNER = fileURLToPath(new URL('lib/zdog-runner.cjs', BENCH_DIR));
const TIME_LIMIT_MS = 5000;
let zdogDir: string | undefined;

/** The zdog package's real directory (pnpm links it from its store). */
function findZdog(): string {
  zdogDir ??= dirname(
    realpathSync(fileURLToPath(new URL('node_modules/zdog/package.json', REPO_DIR))),
  );
  return zdogDir;
}

export function runZdog(
  code: string,
  options: { width: number; height: number; offsetsDeg: number[]; turnsDeg?: readonly number[] },
): ZdogRun {
  const zdog = findZdog();
  const child = spawnSync(
    process.execPath,
    ['--permission', `--allow-fs-read=${RUNNER}`, `--allow-fs-read=${zdog}`, RUNNER],
    {
      input: JSON.stringify({ code, ...options, zdogDir: zdog }),
      encoding: 'utf8',
      timeout: TIME_LIMIT_MS,
      env: {},
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (child.error) {
    const timedOut = (child.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
    return {
      ok: false,
      error: timedOut
        ? `The script did not finish within ${TIME_LIMIT_MS / 1000} seconds.`
        : `The script could not be run: ${child.error.message}`,
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(child.stdout);
  } catch {
    const detail = child.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400);
    return { ok: false, error: `The script crashed the runner. ${detail}`.trim() };
  }
  const run = raw as ZdogRun & { turns?: unknown };
  const turns = run.turns;
  delete run.turns;
  if (Array.isArray(turns)) run.turns = turns.map(readTurn);
  return run;
}

// The runner's output passed through a script written by a model, so the
// turn data is checked before use: plain finite numbers and short strings
// only, and a bound on the amount.

const MAX_POINTS_PER_VIEW = 400_000;
const MAX_COORDINATE = 1e6;

class BadData extends Error {}

function readTurn(value: unknown): ZdogTurn {
  const t = (value ?? {}) as Record<string, unknown>;
  const offsetDeg = finite(t.offsetDeg);
  const excluded = Math.max(0, Math.floor(Number(t.excluded) || 0));
  const elements = Math.max(0, Math.floor(Number(t.elements) || 0));
  if (typeof t.error === 'string' || !Array.isArray(t.primitives)) {
    return { offsetDeg, excluded, elements, error: String(t.error ?? 'no data').slice(0, 300) };
  }
  try {
    const budget = { points: MAX_POINTS_PER_VIEW };
    return {
      offsetDeg,
      primitives: t.primitives.map((p) => readPrimitive(p, budget)),
      excluded,
      elements,
    };
  } catch (error) {
    if (!(error instanceof BadData)) throw error;
    return { offsetDeg, excluded, elements, error: error.message };
  }
}

function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) {
    throw new BadData('The painted geometry has a value that is not a usable number.');
  }
  return value;
}

function readPoint(value: unknown, budget: { points: number }): Point {
  if (!Array.isArray(value) || value.length !== 3) throw new BadData('A point is malformed.');
  if (--budget.points < 0) throw new BadData('The picture has too many points to check.');
  return { x: finite(value[0]), y: finite(value[1]), z: finite(value[2]) };
}

function readLines(value: unknown, budget: { points: number }): Point[][] {
  if (!Array.isArray(value)) throw new BadData('A list of points is malformed.');
  return value.map((line) => {
    if (!Array.isArray(line)) throw new BadData('A list of points is malformed.');
    return line.map((q) => readPoint(q, budget));
  });
}

const SOLID_KINDS = new Set(['cylinder', 'cone', 'hemisphere']);

function readPrimitive(value: unknown, budget: { points: number }): Primitive {
  const p = (value ?? {}) as Record<string, unknown>;
  if (typeof p.color !== 'string') throw new BadData('A painted part has no color.');
  const color = p.color.slice(0, 200);
  let fill: Primitive['fill'];
  if (p.fill !== undefined) {
    const f = p.fill as Record<string, unknown>;
    const rings = readLines(f.rings, budget);
    if (f.solid === undefined) fill = { rings };
    else {
      const s = f.solid as Record<string, unknown>;
      if (typeof s.kind !== 'string' || !SOLID_KINDS.has(s.kind)) {
        throw new BadData('A round solid is of an unknown kind.');
      }
      const solid = solidFrame(
        s.kind as 'cylinder' | 'cone' | 'hemisphere',
        readPoint(s.base, budget),
        readPoint(s.tip, budget),
        finite(s.radius),
      );
      // A solid without size has no surface; its area is left out.
      if (solid) fill = { rings, solid };
    }
  }
  let stroke: Primitive['stroke'];
  if (p.stroke !== undefined) {
    const s = p.stroke as Record<string, unknown>;
    stroke = { radius: Math.max(0, finite(s.radius)), lines: readLines(s.lines, budget) };
  }
  return { color, ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}) };
}
