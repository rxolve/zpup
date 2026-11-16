/**
 * Re-scores a finished run from its stored replies and rewrites summary.md and
 * gallery.html.
 *
 *   node bench/report.ts bench/results/<run id>
 */
import { resolve } from 'node:path';
import { writeReport } from './lib/cli.ts';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node bench/report.ts <run directory>');
  process.exit(1);
}
const { summary, gallery } = writeReport(resolve(dir));
console.log(`Wrote ${summary}\nWrote ${gallery}`);
