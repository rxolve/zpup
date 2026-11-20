/**
 * A lamp, a plant pot and a cup: three things a `cone` makes once
 * `tipDiameter` cuts its tip off. The far end of each is painted in another
 * color, which is enough to read as an opening.
 * Run `pnpm example` to write examples/pots.svg.
 */
import { box, cone, cylinder, dot, group, path, type Scene } from '../src/index.ts';

const up = { x: 90 };
const TABLE = 44;

export const pots: Scene = {
  width: 420,
  height: 220,
  title: 'A lamp, a plant pot and a cup, each a cone with its tip cut off',
  rotate: { x: -22, y: 24 },
  children: [
    box({
      id: 'table',
      width: 360,
      height: 8,
      depth: 120,
      translate: { y: TABLE + 4 },
      color: '#c9b79c',
    }),
    group({
      id: 'lamp',
      translate: { x: -120, y: TABLE },
      children: [
        cylinder({ diameter: 34, length: 6, rotate: up, translate: { y: -3 }, color: '#55504a' }),
        cylinder({ diameter: 5, length: 62, rotate: up, translate: { y: -37 }, color: '#77706a' }),
        // The shade: wide at the bottom, narrow at the top.
        cone({
          diameter: 72,
          tipDiameter: 34,
          length: 44,
          rotate: up,
          translate: { y: -52 },
          color: '#e9c46a',
          frontFace: '#8a6d2a',
          backface: '#fff3c4',
        }),
      ],
    }),
    group({
      id: 'plant',
      translate: { y: TABLE },
      children: [
        // The pot: narrow at the bottom, wide at the top, with soil in it.
        cone({
          diameter: 44,
          tipDiameter: 66,
          length: 50,
          rotate: up,
          color: '#c96f4a',
          frontFace: '#5a4033',
        }),
        path({
          path: [{ y: -50 }, { y: -84 }],
          stroke: 5,
          color: '#3d8b5f',
        }),
        dot({ stroke: 26, translate: { y: -96 }, color: '#3d8b5f' }),
        dot({ stroke: 16, translate: { x: 14, y: -78, z: 4 }, color: '#4c9c6d' }),
      ],
    }),
    group({
      id: 'cup',
      translate: { x: 120, y: TABLE },
      children: [
        cone({
          diameter: 30,
          tipDiameter: 42,
          length: 44,
          rotate: up,
          color: '#4a7bd0',
          frontFace: '#3b2a20',
        }),
        // The handle, on the side away from the pot.
        path({
          path: [
            { x: 19, y: -34 },
            { x: 34, y: -30 },
            { x: 32, y: -16 },
            { x: 17, y: -12 },
          ],
          stroke: 5,
          color: '#4a7bd0',
        }),
      ],
    }),
  ],
};
