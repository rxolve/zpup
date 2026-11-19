/**
 * Three huts under the three roofs a `pyramid` makes: a point (`ridge: 0`),
 * a hip roof (a ridge shorter than the width) and a gable roof (a ridge as
 * long as the width).
 * Run `pnpm example` to write examples/roofs.svg.
 */
import { box, group, pyramid, rect, type Scene } from '../src/index.ts';

const WALL = { width: 60, height: 40, depth: 44 };
const GROUND = 32;

/** A hut standing on the ground at `x`, under a roof with the given ridge. */
const hut = (id: string, x: number, ridge: number, roof: string) =>
  group({
    id,
    translate: { x, y: GROUND },
    children: [
      box({ ...WALL, translate: { y: -WALL.height / 2 }, color: '#ece2c8' }),
      // A door on the front wall, just proud of it.
      rect({
        width: 12,
        height: 22,
        translate: { y: -11, z: WALL.depth / 2 + 0.6 },
        color: '#6b4a34',
        fill: true,
        stroke: 0,
        backface: false,
      }),
      // The roof sits on top of the walls and overhangs them by 4 all round.
      pyramid({
        width: WALL.width + 8,
        depth: WALL.depth + 8,
        height: 30,
        ridge,
        translate: { y: -WALL.height },
        color: roof,
      }),
    ],
  });

export const roofs: Scene = {
  width: 420,
  height: 200,
  title: 'Three huts with a pointed roof, a hip roof and a gable roof',
  rotate: { x: -20, y: 28 },
  children: [
    box({
      id: 'ground',
      width: 380,
      height: 6,
      depth: 110,
      translate: { y: GROUND + 3 },
      color: '#a3ad92',
    }),
    hut('pointed', -125, 0, '#b5482f'),
    hut('hip', 0, 30, '#3f6b8c'),
    hut('gable', 125, WALL.width + 8, '#5a7d3a'),
  ],
};
