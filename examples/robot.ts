/**
 * A small robot built from boxes and cylinders. The eyes, the mouth and the
 * chest panel are flat shapes just in front of a face, with
 * `backface: false`, so they are gone when the robot is seen from behind.
 * Run `pnpm example` to write examples/robot.svg.
 */
import { box, cylinder, dot, ellipse, group, rect, type Scene } from '../src/index.ts';

const steel = '#9fb3c8';
const dark = '#5b6b7d';
const ink = '#2f3440';
const amber = '#ffb238';

// Solids point along local z; rotate x by 90 to stand them up (+z points up).
const up = { x: 90 };

/** Where the feet stand. */
const ground = 112;

const leg = (side: number) =>
  group({
    id: side < 0 ? 'left-leg' : 'right-leg',
    translate: { x: side * 20 },
    children: [
      box({ translate: { y: ground - 7, z: 4 }, width: 26, height: 14, depth: 38, color: dark }),
      cylinder({
        translate: { y: ground - 14 - 15 },
        rotate: up,
        diameter: 14,
        length: 30,
        color: steel,
      }),
    ],
  });

const hips = ground - 44;
const shoulders = hips - 78;

const arm = (side: number) =>
  group({
    id: side < 0 ? 'left-arm' : 'right-arm',
    translate: { x: side * (39 + 9) },
    children: [
      box({ translate: { y: shoulders + 30 }, width: 18, height: 52, depth: 20, color: dark }),
      box({ translate: { y: shoulders + 56 + 9 }, width: 18, height: 18, depth: 24, color: amber }),
    ],
  });

/** A flat detail on a face toward +z, `z` from the center. */
const flat = { fill: true, stroke: 0, backface: false } as const;

const head = group({
  id: 'head',
  translate: { y: shoulders - 10 - 27 },
  children: [
    box({ width: 68, height: 54, depth: 50, color: steel }),
    ellipse({ translate: { x: -15, y: -4, z: 25.5 }, diameter: 16, color: ink, ...flat }),
    ellipse({ translate: { x: 15, y: -4, z: 25.5 }, diameter: 16, color: ink, ...flat }),
    ellipse({ translate: { x: -15, y: -4, z: 25.8 }, diameter: 7, color: amber, ...flat }),
    ellipse({ translate: { x: 15, y: -4, z: 25.8 }, diameter: 7, color: amber, ...flat }),
    rect({ translate: { y: 15, z: 25.5 }, width: 26, height: 5, color: ink, ...flat }),
    cylinder({
      id: 'antenna',
      translate: { y: -27 - 9 },
      rotate: up,
      diameter: 4,
      length: 18,
      color: dark,
    }),
    dot({ translate: { y: -27 - 18 - 5 }, stroke: 10, color: '#d8463c' }),
  ],
});

export const robot: Scene = {
  width: 240,
  height: 300,
  title: 'A small robot',
  rotate: { x: -14, y: 30 },
  children: [
    leg(-1),
    leg(1),
    box({
      id: 'body',
      translate: { y: hips - 39 },
      width: 78,
      height: 78,
      depth: 46,
      color: steel,
    }),
    rect({
      id: 'panel',
      translate: { y: hips - 42, z: 23.5 },
      width: 44,
      height: 30,
      color: ink,
      ...flat,
    }),
    rect({
      translate: { x: -10, y: hips - 42, z: 23.8 },
      width: 12,
      height: 12,
      color: amber,
      ...flat,
    }),
    rect({
      translate: { x: 10, y: hips - 42, z: 23.8 },
      width: 12,
      height: 12,
      color: '#6fcf97',
      ...flat,
    }),
    cylinder({
      id: 'neck',
      translate: { y: shoulders - 5 },
      rotate: up,
      diameter: 24,
      length: 10,
      color: dark,
    }),
    arm(-1),
    arm(1),
    head,
  ],
};
