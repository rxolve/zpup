/**
 * A small sitting pup, described as a plain scene tree.
 * Run `pnpm example` to write examples/pup.svg.
 */
import { dot, ellipse, group, path, type Scene } from '../src/index.ts';

const tan = '#e8a865';
const cream = '#fff3df';
const brown = '#8a5a3b';
const ink = '#2b2024';
const pink = '#f07a8a';

const head = group({
  id: 'head',
  translate: { y: -16, z: 6 },
  children: [
    dot({ id: 'skull', stroke: 76, color: tan }),
    dot({ id: 'snout', translate: { y: 12, z: 28 }, stroke: 34, color: cream }),
    path({
      id: 'nose',
      path: [
        { x: -4, y: 2, z: 44 },
        { x: 4, y: 2, z: 44 },
      ],
      stroke: 11,
      color: ink,
    }),
    path({
      id: 'tongue',
      path: [
        { y: 24, z: 38 },
        { y: 28, z: 36 },
      ],
      stroke: 9,
      color: pink,
    }),
    ...[-1, 1].flatMap((side) => [
      dot({
        id: side < 0 ? 'left-eye' : 'right-eye',
        translate: { x: side * 14, y: -10, z: 32 },
        stroke: 9,
        color: ink,
      }),
      dot({ translate: { x: side * 14 - 1.5, y: -11.5, z: 36 }, stroke: 3, color: '#fff' }),
      ellipse({
        id: side < 0 ? 'left-ear' : 'right-ear',
        translate: { x: side * 36, y: 2, z: -6 },
        rotate: { z: -side * 18, y: side * 20 },
        width: 22,
        height: 46,
        stroke: 8,
        fill: true,
        color: brown,
      }),
    ]),
  ],
});

const body = group({
  id: 'body',
  translate: { y: 40, z: -8 },
  children: [
    dot({ id: 'torso', stroke: 70, color: tan }),
    dot({ id: 'belly', translate: { y: 8, z: 20 }, stroke: 36, color: cream }),
    ...[-1, 1].flatMap((side) => [
      path({
        path: [
          { x: side * 13, y: 12, z: 26 },
          { x: side * 14, y: 34, z: 30 },
        ],
        stroke: 18,
        color: tan,
      }),
      dot({ translate: { x: side * 14, y: 37, z: 33 }, stroke: 20, color: cream }),
    ]),
    path({
      id: 'tail',
      path: [
        { x: 6, y: 10, z: -32 },
        {
          bezier: [
            { x: 20, y: 6, z: -42 },
            { x: 28, y: -12, z: -40 },
            { x: 22, y: -24, z: -36 },
          ],
        },
      ],
      stroke: 10,
      color: tan,
    }),
  ],
});

export const pup: Scene = {
  width: 240,
  height: 240,
  title: 'A small sitting pup',
  background: '#fdf6ec',
  zoom: 1.25,
  rotate: { x: -12, y: -28 },
  children: [
    group({
      translate: { y: -10 },
      children: [
        ellipse({
          id: 'shadow',
          translate: { y: 88 },
          rotate: { x: 90 },
          diameter: 96,
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
