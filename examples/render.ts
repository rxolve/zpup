/** Renders every example scene to an SVG file next to this script. */
import { writeFileSync } from 'node:fs';
import { renderSvg } from '../src/index.ts';
import { pup } from './pup.ts';

const out = new URL('./pup.svg', import.meta.url);
writeFileSync(out, renderSvg(pup));
console.log(`wrote ${out.pathname}`);
