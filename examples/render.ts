/** Renders every example scene to an SVG file next to this script. */
import { writeFileSync } from 'node:fs';
import { renderSpinSvg, renderSvg } from '../src/index.ts';
import { pup } from './pup.ts';

const outputs: [string, string][] = [
  ['./pup.svg', renderSvg(pup)],
  ['./pup-spin.svg', renderSpinSvg(pup)],
];
for (const [name, svg] of outputs) {
  const out = new URL(name, import.meta.url);
  writeFileSync(out, svg);
  console.log(`wrote ${out.pathname}`);
}
