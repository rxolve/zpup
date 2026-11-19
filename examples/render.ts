/** Renders every example scene to an SVG file next to this script. */
import { writeFileSync } from 'node:fs';
import { renderSpinSvg, renderSvg, type Scene } from '../src/index.ts';
import { cactus } from './cactus.ts';
import { cake } from './cake.ts';
import { lighthouse } from './lighthouse.ts';
import { pup } from './pup.ts';
import { robot } from './robot.ts';
import { rocket } from './rocket.ts';
import { roofs } from './roofs.ts';

/** One scene drawn side by side from several view angles, as a single SVG. */
function views(s: Scene, title: string, angles: NonNullable<Scene['rotate']>[]): string {
  const { title: _title, ...untitled } = s;
  const panels = angles.map((rotate, i) =>
    renderSvg({ ...untitled, rotate }).replace('<svg ', `<svg x="${i * s.width}" `),
  );
  const width = s.width * angles.length;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${s.height}" ` +
    `viewBox="0 0 ${width} ${s.height}" role="img" aria-label="${title}">\n` +
    `<title>${title}</title>\n${panels.join('\n')}\n</svg>\n`
  );
}

const lighthouseViews = views(lighthouse, 'One lighthouse scene drawn from four angles', [
  { x: -16, y: 24 },
  { x: -16, y: 114 },
  { x: -16, y: 204 },
  { x: -62, y: 24 },
]);

const outputs: [string, string][] = [
  ['./pup.svg', renderSvg(pup)],
  ['./pup-spin.svg', renderSpinSvg(pup)],
  ['./lighthouse.svg', renderSvg(lighthouse)],
  ['./lighthouse-views.svg', lighthouseViews],
  ['./lighthouse-spin.svg', renderSpinSvg(lighthouse)],
  ['./rocket.svg', renderSvg(rocket)],
  ['./cake.svg', renderSvg(cake)],
  ['./robot.svg', renderSvg(robot)],
  ['./cactus.svg', renderSvg(cactus)],
  ['./roofs.svg', renderSvg(roofs)],
];
for (const [name, svg] of outputs) {
  const out = new URL(name, import.meta.url);
  writeFileSync(out, svg);
  console.log(`wrote ${out.pathname}`);
}
