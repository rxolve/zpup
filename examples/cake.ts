/**
 * A two-tier cake: stacked cylinders, candles standing on the top and
 * cherries, drawn as dots, resting on the ledge between the tiers.
 * Run `pnpm example` to write examples/cake.svg.
 */
import { cylinder, dot, group, type Node, type Scene } from '../src/index.ts';

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

/** `count` copies of what `make` returns, spread evenly round the vertical axis. */
const around = (count: number, make: (i: number) => Node[]) =>
  Array.from({ length: count }, (_, i) =>
    group({ rotate: { y: (360 / count) * i }, children: make(i) }),
  );

/** Top of the plate. */
const ground = 84;
const ledge = ground - 54;
const top = ledge - 46;

export const cake: Scene = {
  width: 240,
  height: 300,
  title: 'A two-tier cake with candles',
  rotate: { x: -22, y: 20 },
  children: [
    slice('plate', ground + 6, 6, 200, '#e9edf2'),
    slice('sponge-1', ground, 46, 150, '#8a5a3b'),
    slice('icing-1', ground - 46, 8, 154, '#fbf3e4'),
    slice('sponge-2', ledge, 38, 96, '#8a5a3b'),
    slice('icing-2', ledge - 38, 8, 100, '#f4a7b9'),
    ...around(10, () => [
      dot({ translate: { x: 63, y: ledge - 6.5 }, stroke: 13, color: '#c9273a' }),
    ]),
    ...around(5, (i) => [
      cylinder({
        id: `candle-${i}`,
        translate: { x: 30, y: top - 13 },
        rotate: up,
        diameter: 7,
        length: 26,
        color: i % 2 ? '#7cc4e8' : '#f6d55c',
      }),
      dot({ id: `flame-${i}`, translate: { x: 30, y: top - 26 - 5 }, stroke: 9, color: '#ff9f1c' }),
    ]),
  ],
};
