/**
 * Draws the lighthouse turning in Zdog and in Zpup, side by side, as one SVG
 * with no JavaScript: examples/zdog-vs-zpup.svg.
 *
 * Both halves are the same solids at the same places and sizes
 * (lighthouse.zdog.js and lighthouse.ts). Zdog draws to a canvas or to live
 * SVG and cannot write a turning file, so its half is a flip-book: Zdog's own
 * SVG output at every few degrees, shown one frame at a time. The Zpup half
 * is `renderSpinSvg`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { runZdog } from '../bench/lib/zdog.ts';
import { renderSpinSvg } from '../src/index.ts';
import { lighthouse } from './lighthouse.ts';

/** Zdog frames per turn: one every 3 degrees. */
const FRAMES = 120;
const DURATION = 8;
const LABEL = 30;

const { width, height } = lighthouse;
const step = 360 / FRAMES;
// Zdog's rotate.y turns the other way from Zpup's, and each frame stands for
// the middle of the time it is shown.
const offsetsDeg = Array.from({ length: FRAMES }, (_, i) => -(i + 0.5) * step);

const code = readFileSync(new URL('./lighthouse.zdog.js', import.meta.url), 'utf8');
const run = runZdog(code, { width, height, offsetsDeg });
if (!run.ok || !run.rotations) throw new Error(run.error ?? 'Zdog drew nothing.');

const ROUND = ' stroke-linecap="round" stroke-linejoin="round"';

/** The drawing inside one of Zdog's SVGs, with shorter numbers. */
function inner(svg: string): string {
  return (
    svg
      .replace(/^<svg[^>]*>/, '')
      .replace(/<\/svg>\s*$/, '')
      .replace(/<\/path>/g, '')
      // Round caps and joins are set once on the group; the few paths Zdog
      // leaves square (the side of a cylinder) say so themselves.
      .replace(/<path([^>]*)>/g, (_, attributes: string) =>
        attributes.includes(ROUND)
          ? `<path${attributes.replace(ROUND, '')}/>`
          : `<path${attributes} stroke-linecap="butt" stroke-linejoin="miter"/>`,
      )
      .replace(/-?\d+\.\d{2,}/g, (n) => String(Math.round(Number(n) * 10) / 10))
  );
}

const time = (i: number) => String(Math.round((i / FRAMES) * 1e5) / 1e5);
const frames = run.rotations.map((r, i) => {
  if (r.svg === undefined) throw new Error(`Zdog failed at ${r.offsetDeg} degrees: ${r.error}`);
  const [values, keyTimes] =
    i === 0
      ? ['visible;hidden', `0;${time(1)}`]
      : i === FRAMES - 1
        ? ['hidden;visible', `0;${time(i)}`]
        : ['hidden;visible;hidden', `0;${time(i)};${time(i + 1)}`];
  return (
    `<g${i === 0 ? '' : ' visibility="hidden"'}>` +
    `<animate attributeName="visibility" calcMode="discrete" dur="${DURATION}s" ` +
    `repeatCount="indefinite" values="${values}" keyTimes="${keyTimes}"/>${inner(r.svg)}</g>`
  );
});

const { title: _title, ...scene } = lighthouse;
const zpup = renderSpinSvg(scene, { duration: DURATION }).replace(
  '<svg ',
  `<svg x="${width}" y="${LABEL}" `,
);

const label = (x: number, text: string) =>
  `<text x="${x}" y="20" text-anchor="middle" font-family="system-ui, sans-serif" ` +
  `font-size="15" font-weight="600" fill="#888">${text}</text>`;
const title = 'The same lighthouse turning in Zdog and in Zpup';
const out =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width * 2}" height="${height + LABEL}" ` +
  `viewBox="0 0 ${width * 2} ${height + LABEL}" role="img" aria-label="${title}">\n` +
  `<title>${title}</title>\n${label(width / 2, 'Zdog')}${label(width * 1.5, 'Zpup')}\n` +
  `<svg y="${LABEL}" width="${width}" height="${height}" ` +
  `viewBox="${-width / 2} ${-height / 2} ${width} ${height}" ` +
  `stroke-linecap="round" stroke-linejoin="round">\n${frames.join('\n')}\n</svg>\n${zpup}\n</svg>\n`;

const file = new URL('./zdog-vs-zpup.svg', import.meta.url);
writeFileSync(file, out);
console.log(`wrote ${file.pathname} (${out.length} bytes)`);
