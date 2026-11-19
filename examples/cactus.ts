/**
 * A cactus in a pot, with soft shading. The trunk and the arms are thick
 * lines, which soft shading draws as tubes; the arms cut into the trunk, so
 * they have its color.
 * Run `pnpm example` to write examples/cactus.svg.
 */
import { cylinder, dot, path, type Scene } from '../src/index.ts';

const green = '#4f9d69';
const clay = '#c8744f';

// Solids point along local z; rotate x by 90 to stand them up (+z points up).
const up = { x: 90 };

/** Top of the soil. */
const soil = 58;
const TRUNK = 40;

export const cactus: Scene = {
  width: 240,
  height: 300,
  title: 'A cactus in a pot',
  shading: 'soft',
  rotate: { x: -14, y: 25 },
  children: [
    cylinder({
      id: 'saucer',
      translate: { y: soil + 72 + 4 },
      rotate: up,
      diameter: 120,
      length: 8,
      color: clay,
    }),
    cylinder({
      id: 'pot',
      translate: { y: soil + 14 + 29 },
      rotate: up,
      diameter: 84,
      length: 58,
      color: clay,
    }),
    cylinder({
      id: 'rim',
      translate: { y: soil + 7 },
      rotate: up,
      diameter: 100,
      length: 14,
      color: clay,
      frontFace: '#5a4334',
    }),
    // The round end of the trunk just touches the soil.
    path({
      id: 'trunk',
      path: [{ y: soil - TRUNK / 2 }, { y: soil - 150 }],
      stroke: TRUNK,
      color: green,
    }),
    path({
      id: 'left-arm',
      path: [{ y: soil - 62 }, { x: -44, y: soil - 62 }, { x: -44, y: soil - 100 }],
      stroke: 22,
      color: green,
    }),
    path({
      id: 'right-arm',
      path: [{ y: soil - 90 }, { x: 40, y: soil - 90 }, { x: 40, y: soil - 122 }],
      stroke: 20,
      color: green,
    }),
    dot({
      id: 'flower',
      translate: { y: soil - 150 - TRUNK / 2 - 8 },
      stroke: 16,
      color: '#f4a7b9',
    }),
  ],
};
