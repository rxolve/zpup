/**
 * Runs a model-written Zdog script in a separate, locked-down Node process
 * and returns the SVG it draws. See zdog-runner.cjs for what the process does.
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BENCH_DIR, REPO_DIR } from './config.ts';

export interface ZdogRun {
  ok: boolean;
  error?: string;
  svg?: string;
  /** Number of <path> elements with a `d` in the picture. */
  paths?: number;
  /** Whether the script itself called `updateRenderGraph()`. */
  rendered?: boolean;
  rotations?: { offsetDeg: number; svg?: string; error?: string }[];
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
  options: { width: number; height: number; offsetsDeg: number[] },
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
  try {
    return JSON.parse(child.stdout) as ZdogRun;
  } catch {
    const detail = child.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400);
    return { ok: false, error: `The script crashed the runner. ${detail}`.trim() };
  }
}
