import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

let cached: string | undefined;

/**
 * The scene reference that ships with `@zpup/core` (its `llms.txt`), so the
 * text always matches the version of the library that draws.
 */
export function readReference(): string {
  cached ??= readFileSync(
    join(dirname(require.resolve('@zpup/core/package.json')), 'llms.txt'),
    'utf8',
  );
  return cached;
}

/** This package's version, from its own package.json. */
export function packageVersion(): string {
  return (require('../package.json') as { version: string }).version;
}
