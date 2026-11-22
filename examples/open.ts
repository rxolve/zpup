/**
 * A cup of pencils, a crate and a bowl: solids with a face left out. Each
 * shows its inside through the opening, and what stands in it is drawn
 * between the far wall and the near one.
 * Run `pnpm example` to write examples/open.svg.
 */
import { box, cone, cylinder, dot, group, hemisphere, path, type Scene } from '../src/index.ts';

const up = { x: 90 };
const TABLE = 26;

const pencil = (color: string, x: number, z: number, lean: number) =>
  group({
    translate: { x, y: -4, z },
    rotate: { z: lean },
    children: [
      path({ path: [{ y: 0 }, { y: -66 }], stroke: 6, color }),
      cone({
        diameter: 6,
        length: 9,
        rotate: up,
        translate: { y: -69 },
        color: '#e8c9a0',
        stroke: 0.5,
      }),
    ],
  });

export const open: Scene = {
  width: 420,
  height: 200,
  title: 'A cup of pencils, an open crate with two balls in it and a bowl of fruit',
  rotate: { x: -28, y: 24 },
  children: [
    box({
      id: 'table',
      width: 360,
      height: 8,
      depth: 130,
      translate: { y: TABLE + 4 },
      color: '#c9b79c',
    }),
    group({
      id: 'cup',
      translate: { x: -120, y: TABLE },
      children: [
        // A cylinder with its top left out.
        cylinder({
          diameter: 44,
          length: 52,
          rotate: up,
          translate: { y: -26 },
          color: '#3f7fbf',
          frontFace: false,
        }),
        pencil('#e9b949', -8, 4, -9),
        pencil('#d8574a', 7, -5, 8),
        pencil('#5aa469', 2, 9, 2),
      ],
    }),
    group({
      id: 'crate',
      translate: { y: TABLE },
      children: [
        box({
          width: 84,
          height: 40,
          depth: 60,
          translate: { y: -20 },
          color: '#c8975a',
          topFace: false,
        }),
        dot({ stroke: 30, color: '#e4572e', translate: { x: -18, y: -17, z: 6 } }),
        dot({ stroke: 26, color: '#f3f0e8', translate: { x: 16, y: -15, z: -8 } }),
      ],
    }),
    group({
      id: 'bowl',
      translate: { x: 122, y: TABLE },
      children: [
        // Half a sphere with its flat side left out, dome down.
        hemisphere({
          diameter: 76,
          rotate: { x: -90 },
          translate: { y: -38 },
          color: '#6fb1c4',
          backface: false,
        }),
        dot({ stroke: 24, color: '#f2a03d', translate: { x: -12, y: -22, z: 4 } }),
        dot({ stroke: 24, color: '#8cbf4f', translate: { x: 12, y: -22, z: -2 } }),
        dot({ stroke: 22, color: '#d8463c', translate: { x: 1, y: -36, z: 10 } }),
      ],
    }),
  ],
};
