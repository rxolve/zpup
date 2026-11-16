/**
 * The smallest scene in the examples: a planet, its ring and a moon, three
 * shapes in all. The playground opens with it.
 */
import { dot, ellipse, type Scene } from '../src/index.ts';

export const hello: Scene = {
  width: 200,
  height: 200,
  title: 'A planet with a ring and a moon',
  rotate: { x: -20, y: 30 },
  children: [
    dot({ id: 'planet', stroke: 80, color: '#e8663d' }),
    ellipse({ id: 'ring', diameter: 140, stroke: 8, color: '#5b4a8b', rotate: { x: 70 } }),
    dot({ id: 'moon', translate: { x: 70, y: -54, z: 20 }, stroke: 18, color: '#f2c14e' }),
  ],
};
