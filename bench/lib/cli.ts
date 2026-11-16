import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { galleryHtml } from './gallery.ts';
import { loadRun, summaryMarkdown } from './report.ts';

export function gitCommit(cwd: URL): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

/** Writes summary.md and gallery.html into a run directory and returns their paths. */
export function writeReport(dir: string): { summary: string; gallery: string } {
  const run = loadRun(dir);
  const summary = join(dir, 'summary.md');
  const gallery = join(dir, 'gallery.html');
  writeFileSync(summary, summaryMarkdown(run));
  writeFileSync(gallery, galleryHtml(run));
  return { summary, gallery };
}

export function timestampId(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}
