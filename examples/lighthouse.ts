/**
 * A lighthouse on a rock, built from the solids: cylinders for the island
 * and the tower, hemispheres for the dome and a squashed boulder, cones for
 * the roofs and a box for the keeper's hut. Every solid stands on a flat
 * face of another: shapes that cut into each other cannot be depth-sorted.
 * Each solid has one color; its faces are shaded from it.
 * Run `pnpm example` to write examples/lighthouse.svg and
 * examples/lighthouse-spin.svg.
 */
import { box, cone, cylinder, group, hemisphere, rect, type Scene } from '../src/index.ts';

const white = '#f4f1ea';
const red = '#d8463c';
const ink = '#2f3440';

// Solids point along local z; rotate x by 90 to stand them up (+z points up).
const up = { x: 90 };

/** One band of the tower, standing on y = `bottom`. */
const band = (id: string, bottom: number, height: number, diameter: number, color: string) =>
  cylinder({
    id,
    translate: { y: bottom - height / 2 },
    rotate: up,
    diameter,
    length: height,
    color,
  });

/** Top of the island, where everything stands. */
const ground = 62;

const tower = group({
  id: 'tower',
  translate: { y: ground },
  children: [
    band('band-1', 0, 36, 60, white),
    band('band-2', -36, 36, 54, red),
    band('band-3', -72, 36, 48, white),
    band('gallery', -108, 6, 68, ink),
    band('lantern', -114, 22, 32, '#ffd166'),
    hemisphere({
      id: 'dome',
      translate: { y: -136 },
      rotate: up,
      diameter: 36,
      color: red,
    }),
    cone({ id: 'spike', translate: { y: -154 }, rotate: up, diameter: 6, length: 12, color: ink }),
    rect({
      id: 'door',
      translate: { y: -11, z: 30.5 },
      width: 14,
      height: 22,
      stroke: 2,
      fill: true,
      color: ink,
    }),
    rect({
      id: 'window',
      translate: { y: -88, z: 24.5 },
      width: 8,
      height: 10,
      stroke: 2,
      fill: true,
      color: ink,
    }),
  ],
});

const hut = group({
  id: 'hut',
  translate: { x: 54, y: ground - 12, z: 10 },
  rotate: { y: -20 },
  children: [
    box({ id: 'hut-walls', width: 30, height: 24, depth: 26, color: white }),
    cone({
      id: 'hut-roof',
      translate: { y: -12 },
      rotate: up,
      diameter: 44,
      length: 18,
      color: red,
    }),
  ],
});

export const lighthouse: Scene = {
  width: 240,
  height: 300,
  title: 'A lighthouse on a rock',
  rotate: { x: -16, y: 24 },
  children: [
    cylinder({
      id: 'island',
      translate: { y: ground + 9 },
      rotate: up,
      diameter: 200,
      length: 18,
      color: '#8b8378',
    }),
    hemisphere({
      id: 'boulder',
      translate: { x: -62, y: ground, z: 20 },
      rotate: up,
      scale: { z: 0.6 },
      diameter: 44,
      color: '#6f6a62',
    }),
    tower,
    hut,
  ],
};
