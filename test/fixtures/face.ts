import { dot, ellipse, group, path, type Scene } from '../../src/index.ts';

/** Radius of the head. */
export const HEAD_RADIUS = 40;

/**
 * The smallest scene with a face that turns away: a ball with two eyes and a
 * mouth. Each feature is a flat piece on the plane that touches the ball, a
 * little outside it, rotated to its place by a group. Each is filled with no
 * stroke and has `backface: false`, so it disappears exactly when it turns
 * edge-on, when it covers no area.
 */
export const face: Scene = {
  width: 120,
  height: 120,
  rotate: { x: -15 },
  children: [
    dot({ id: 'head', stroke: 2 * HEAD_RADIUS, color: '#f4c95d' }),
    ...[-1, 1].map((side) =>
      group({
        rotate: { x: 15, y: 25 * side },
        children: [
          ellipse({
            id: side < 0 ? 'left eye' : 'right eye',
            translate: { z: HEAD_RADIUS + 0.5 },
            width: 8,
            height: 11,
            fill: true,
            stroke: 0,
            color: '#222',
            backface: false,
          }),
        ],
      }),
    ),
    group({
      rotate: { x: -25 },
      children: [
        path({
          id: 'mouth',
          translate: { z: HEAD_RADIUS + 0.5 },
          path: [
            { x: -9, y: -2 },
            {
              bezier: [
                { x: -4, y: 6 },
                { x: 4, y: 6 },
                { x: 9, y: -2 },
              ],
            },
            {
              bezier: [
                { x: 4, y: 2 },
                { x: -4, y: 2 },
                { x: -9, y: -2 },
              ],
            },
          ],
          closed: true,
          fill: true,
          stroke: 0,
          color: '#222',
          backface: false,
        }),
      ],
    }),
  ],
};
