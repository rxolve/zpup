/**
 * A small sitting pup, described as a plain scene tree.
 * Run `pnpm example` to write examples/pup.svg and examples/pup-spin.svg.
 *
 * It is built to turn without popping (see the README):
 *   - parts of different colors only touch;
 *   - parts that cut into each other share a color.
 */
import { dot, ellipse, group, path, type Scene } from '../src/index.ts';

const tan = '#e8a865';
const shade = '#d2904c';
const brown = '#8a5a3b';
const ink = '#2b2024';

type Point = { x?: number; y?: number; z?: number };

/** Center of a ball of radius `r` resting on a sphere, out along `dir`. */
function resting(center: Point, radius: number, dir: Point, r: number) {
  const length = Math.hypot(dir.x ?? 0, dir.y ?? 0, dir.z ?? 0);
  const distance = radius + r + 0.3;
  const along = (c = 0, d = 0) => +(c + (d / length) * distance).toFixed(2);
  return { x: along(center.x, dir.x), y: along(center.y, dir.y), z: along(center.z, dir.z) };
}

const HEAD = 38;
const SNOUT = 13;
const EYE = 4.2;
const NOSE = 5;
const snout = { y: 10, z: 29 };

function eye(side: number) {
  const at = resting({}, HEAD, { x: side * 0.42, y: -0.06, z: 1 }, EYE);
  return [
    dot({ id: side < 0 ? 'left-eye' : 'right-eye', translate: at, stroke: EYE * 2, color: ink }),
    // A glint resting on the eye, toward the upper front.
    dot({
      translate: resting(at, EYE, { x: -0.35, y: -0.55, z: 1 }, 1.3),
      stroke: 2.6,
      color: '#fff',
    }),
  ];
}

const ear = (side: number) =>
  path({
    id: side < 0 ? 'left-ear' : 'right-ear',
    path: [
      { x: side * 38, y: -26 },
      { x: side * 46, y: -9 },
      { x: side * 46.5, y: 8 },
    ],
    stroke: 15,
    color: brown,
  });

const head = group({
  id: 'head',
  children: [
    dot({ id: 'skull', stroke: HEAD * 2, color: tan }),
    // The snout cuts into the skull, so it has the skull's color.
    dot({ id: 'snout', translate: snout, stroke: SNOUT * 2, color: tan }),
    dot({
      id: 'nose',
      translate: resting(snout, SNOUT, { y: -0.35, z: 1 }, NOSE),
      stroke: NOSE * 2,
      color: ink,
    }),
    ...eye(-1),
    ...eye(1),
    ear(-1),
    ear(1),
  ],
});

const body = group({
  id: 'body',
  translate: { y: 50, z: -6 },
  children: [
    dot({ id: 'torso', stroke: 48, color: tan }),
    ...[-1, 1].flatMap((side) => [
      // A straight foreleg standing in front of the chest. It touches the
      // torso only at its top.
      path({
        id: side < 0 ? 'left-front-leg' : 'right-front-leg',
        path: [
          { x: side * 9, y: 7, z: 27.6 },
          { x: side * 9, y: 23.5, z: 29.5 },
        ],
        stroke: 11,
        color: shade,
      }),
      // The haunch cuts into the torso and shares its color; the paw only
      // touches the haunch.
      dot({
        id: side < 0 ? 'left-haunch' : 'right-haunch',
        translate: { x: side * 17, y: 14, z: -2 },
        stroke: 20,
        color: tan,
      }),
      dot({
        id: side < 0 ? 'left-hind-paw' : 'right-hind-paw',
        translate: { x: side * 22.5, y: 22.5, z: 11 },
        stroke: 13,
        color: shade,
      }),
    ]),
    path({
      id: 'tail',
      path: [
        { y: 8, z: -24 },
        { x: 5, y: -8, z: -35 },
      ],
      stroke: 8,
      color: tan,
    }),
  ],
});

export const pup: Scene = {
  width: 240,
  height: 240,
  title: 'A small sitting pup',
  background: '#fdf6ec',
  zoom: 1.3,
  rotate: { x: -12, y: -28 },
  children: [
    group({
      translate: { y: -21 },
      children: [
        ellipse({
          id: 'shadow',
          translate: { y: 80 },
          rotate: { x: 90 },
          diameter: 84,
          stroke: 0,
          fill: true,
          color: '#efe2cf',
        }),
        body,
        head,
      ],
    }),
  ],
};
