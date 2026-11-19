/**
 * A rocket on its pad: a cylinder for the body, a cone for the nose, boxes
 * for the fins. Every solid rests on a flat face of another or touches it
 * from the side, and none cuts into another.
 * Run `pnpm example` to write examples/rocket.svg.
 */
import { box, cone, cylinder, ellipse, group, type Scene } from '../src/index.ts';

const white = '#f2efe8';
const red = '#d8463c';
const ink = '#2f3440';

// Solids point along local z; rotate x by 90 to stand them up (+z points up).
const up = { x: 90 };

/** A round slice standing on y = `bottom`. */
const slice = (id: string, bottom: number, height: number, diameter: number, color: string) =>
  cylinder({
    id,
    translate: { y: bottom - height / 2 },
    rotate: up,
    diameter,
    length: height,
    color,
  });

/** Top of the pad. */
const ground = 96;
const RADIUS = 24;

/** A fin against the body, `angle` degrees round it. */
const fin = (angle: number) =>
  group({
    id: `fin-${angle}`,
    rotate: { y: angle },
    children: [
      box({
        translate: { x: RADIUS + 11, y: ground - 20 },
        width: 22,
        height: 40,
        depth: 6,
        color: red,
      }),
    ],
  });

/** A porthole on the body, facing `angle` degrees round it. */
const porthole = (angle: number) =>
  group({
    rotate: { y: angle },
    children: [
      ellipse({
        translate: { y: ground - 96, z: RADIUS + 0.5 },
        diameter: 17,
        fill: true,
        stroke: 0,
        color: '#3d6fb4',
        backface: false,
      }),
    ],
  });

export const rocket: Scene = {
  width: 240,
  height: 300,
  title: 'A rocket on its pad',
  rotate: { x: -18, y: 28 },
  children: [
    slice('pad', ground + 10, 10, 190, '#8d929b'),
    slice('nozzle', ground, 12, 30, ink),
    slice('body', ground - 12, 100, RADIUS * 2, white),
    slice('band', ground - 112, 12, RADIUS * 2, red),
    slice('neck', ground - 124, 20, RADIUS * 2, white),
    cone({
      id: 'nose',
      translate: { y: ground - 144 },
      rotate: up,
      diameter: RADIUS * 2,
      length: 46,
      color: red,
    }),
    fin(30),
    fin(150),
    fin(270),
    porthole(0),
    porthole(180),
  ],
};
