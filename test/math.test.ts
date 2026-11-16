import { describe, expect, it } from 'vitest';
import {
  compose,
  cross,
  IDENTITY,
  localMatrix,
  rotate,
  rotationMatrix,
  strokeScale,
  transformPoint,
  vec3,
} from '../src/math.ts';

describe('vectors', () => {
  it('defaults missing components to 0', () => {
    expect(vec3(1)).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('x cross y is z', () => {
    expect(cross(vec3(1), vec3(0, 1))).toEqual(vec3(0, 0, 1));
  });
});

describe('rotation', () => {
  it('positive z turns clockwise on screen (x toward +y, which is down)', () => {
    expect(rotate(vec3(1), vec3(0, 0, 90))).toEqual(vec3(0, 1, 0));
  });

  it('positive y moves the +x side away from the viewer', () => {
    expect(rotate(vec3(1), vec3(0, 90, 0))).toEqual(vec3(0, 0, -1));
  });

  it('positive x moves the bottom (+y) side toward the viewer', () => {
    expect(rotate(vec3(0, 1), vec3(90, 0, 0))).toEqual(vec3(0, 0, 1));
  });

  it('applies z first, then y, then x', () => {
    // z: (1,0,0) -> (0,1,0); then x: (0,1,0) -> (0,0,1).
    expect(rotate(vec3(1), vec3(90, 0, 90))).toEqual(vec3(0, 0, 1));
    // The other order would leave (1,0,0) on the x axis and then turn it to +y.
    expect(rotate(vec3(1), vec3(90, 0, 90))).not.toEqual(vec3(0, 1, 0));
  });

  it('handles arbitrary angles', () => {
    const p = rotate(vec3(1), vec3(0, 0, 45));
    expect(p.x).toBeCloseTo(Math.SQRT1_2);
    expect(p.y).toBeCloseTo(Math.SQRT1_2);
  });

  it('a full turn is exactly the identity', () => {
    expect(rotationMatrix(vec3(360, -360, 720))).toEqual(IDENTITY);
  });
});

describe('transforms', () => {
  it('scales, then rotates, then translates', () => {
    const m = localMatrix(vec3(10, 0, 0), vec3(0, 0, 90), vec3(2, 2, 2));
    // (5,0,0) -> scaled (10,0,0) -> rotated (0,10,0) -> translated (10,10,0)
    expect(transformPoint(m, vec3(5))).toEqual(vec3(10, 10, 0));
  });

  it('compose applies the inner transform first', () => {
    const outer = localMatrix(vec3(0, 0, 7), vec3(0, 90, 0), vec3(1, 1, 1));
    const inner = localMatrix(vec3(3, 0, 0), vec3(0, 0, 90), vec3(1, 2, 1));
    const p = vec3(1, 2, 3);
    expect(transformPoint(compose(outer, inner), p)).toEqual(
      transformPoint(outer, transformPoint(inner, p)),
    );
  });

  it('stroke scale follows uniform scale and ignores rotation', () => {
    expect(strokeScale(localMatrix(vec3(), vec3(10, 20, 30), vec3(3, 3, 3)))).toBeCloseTo(3);
    expect(strokeScale(localMatrix(vec3(), vec3(), vec3(-2, 2, 2)))).toBeCloseTo(2);
  });
});
