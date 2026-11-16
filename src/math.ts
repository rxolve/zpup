/**
 * Small, allocation-friendly 3D math used by the scene compiler.
 *
 * Coordinate system: x points right, y points down, z points toward the viewer
 * (the same x/y directions as SVG and CSS). Angles are in degrees.
 */

/** A point or direction in 3D space. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Creates a vector. Missing components default to 0. */
export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function multiplyScalar(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

/** Linear interpolation between `a` (t = 0) and `b` (t = 1). */
export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/**
 * Sine and cosine of an angle in degrees. Exact multiples of 90 degrees
 * return exact 0, 1 or -1 so that right-angle rotations stay exact.
 */
export function sinCosDegrees(degrees: number): [sin: number, cos: number] {
  const quarterTurns = degrees / 90;
  if (Number.isInteger(quarterTurns)) {
    const q = ((quarterTurns % 4) + 4) % 4;
    return (
      [
        [0, 1],
        [1, 0],
        [0, -1],
        [-1, 0],
      ] as const
    )[q] as [number, number];
  }
  const radians = (degrees * Math.PI) / 180;
  return [Math.sin(radians), Math.cos(radians)];
}

/**
 * An affine transform: a 3x3 linear part (row-major) followed by a translation.
 *
 * `[a, b, c, d, e, f, g, h, i, tx, ty, tz]` maps a point p to
 * `(a*x + b*y + c*z + tx, d*x + e*y + f*z + ty, g*x + h*y + i*z + tz)`.
 */
export type Matrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** Applies a transform to a point. */
export function transformPoint(m: Matrix, p: Vec3): Vec3 {
  return {
    x: m[0] * p.x + m[1] * p.y + m[2] * p.z + m[9],
    y: m[3] * p.x + m[4] * p.y + m[5] * p.z + m[10],
    z: m[6] * p.x + m[7] * p.y + m[8] * p.z + m[11],
  };
}

/**
 * Composes two transforms. The result applies `inner` first, then `outer`:
 * `transformPoint(compose(outer, inner), p) === transformPoint(outer, transformPoint(inner, p))`.
 */
export function compose(outer: Matrix, inner: Matrix): Matrix {
  const [a, b, c, d, e, f, g, h, i, tx, ty, tz] = outer;
  const [A, B, C, D, E, F, G, H, I, TX, TY, TZ] = inner;
  return [
    a * A + b * D + c * G,
    a * B + b * E + c * H,
    a * C + b * F + c * I,
    d * A + e * D + f * G,
    d * B + e * E + f * H,
    d * C + e * F + f * I,
    g * A + h * D + i * G,
    g * B + h * E + i * H,
    g * C + h * F + i * I,
    a * TX + b * TY + c * TZ + tx,
    d * TX + e * TY + f * TZ + ty,
    g * TX + h * TY + i * TZ + tz,
  ];
}

/**
 * Rotation matrix for Euler angles in degrees. The point is rotated about the
 * z axis first, then the y axis, then the x axis (matrix `Rx * Ry * Rz`).
 *
 * With y pointing down, a positive `z` angle turns clockwise on screen, a
 * positive `y` angle moves the +x side away from the viewer, and a positive
 * `x` angle moves the bottom (+y) side toward the viewer.
 */
export function rotationMatrix(rotation: Vec3): Matrix {
  const [sx, cx] = sinCosDegrees(rotation.x);
  const [sy, cy] = sinCosDegrees(rotation.y);
  const [sz, cz] = sinCosDegrees(rotation.z);
  const rz: Matrix = [cz, -sz, 0, sz, cz, 0, 0, 0, 1, 0, 0, 0];
  const ry: Matrix = [cy, 0, sy, 0, 1, 0, -sy, 0, cy, 0, 0, 0];
  const rx: Matrix = [1, 0, 0, 0, cx, -sx, 0, sx, cx, 0, 0, 0];
  return compose(rx, compose(ry, rz));
}

/** Rotates a vector by Euler angles in degrees (see {@link rotationMatrix}). */
export function rotate(v: Vec3, rotation: Vec3): Vec3 {
  return transformPoint(rotationMatrix(rotation), v);
}

/**
 * Builds a node's local transform: scale first, then rotate, then translate
 * (`T * R * S`).
 */
export function localMatrix(translate: Vec3, rotation: Vec3, scale: Vec3): Matrix {
  const r = rotationMatrix(rotation);
  return [
    r[0] * scale.x,
    r[1] * scale.y,
    r[2] * scale.z,
    r[3] * scale.x,
    r[4] * scale.y,
    r[5] * scale.z,
    r[6] * scale.x,
    r[7] * scale.y,
    r[8] * scale.z,
    translate.x,
    translate.y,
    translate.z,
  ];
}

/** Determinant of the linear part of a transform. */
export function determinant(m: Matrix): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/**
 * How much a transform scales stroke widths: the cube root of the absolute
 * determinant, which equals `|s|` for any rotation combined with a uniform
 * scale `s`.
 */
export function strokeScale(m: Matrix): number {
  return Math.cbrt(Math.abs(determinant(m)));
}

/** The inverse of a transform, or undefined when it flattens space (determinant 0). */
export function invert(m: Matrix): Matrix | undefined {
  const det = determinant(m);
  if (det === 0 || !Number.isFinite(det)) return undefined;
  const [a, b, c, d, e, f, g, h, i, tx, ty, tz] = m;
  const A = (e * i - f * h) / det;
  const B = (c * h - b * i) / det;
  const C = (b * f - c * e) / det;
  const D = (f * g - d * i) / det;
  const E = (a * i - c * g) / det;
  const F = (c * d - a * f) / det;
  const G = (d * h - e * g) / det;
  const H = (b * g - a * h) / det;
  const I = (a * e - b * d) / det;
  return [
    A,
    B,
    C,
    D,
    E,
    F,
    G,
    H,
    I,
    -(A * tx + B * ty + C * tz),
    -(D * tx + E * ty + F * tz),
    -(G * tx + H * ty + I * tz),
  ];
}

/**
 * The direction a surface normal `n` points in after the transform `m`, not
 * normalized: the inverse transpose of the linear part, with the sign kept so
 * that an outward normal stays outward under a mirroring transform.
 */
export function transformNormal(m: Matrix, n: Vec3): Vec3 {
  const r0: Vec3 = { x: m[0], y: m[1], z: m[2] };
  const r1: Vec3 = { x: m[3], y: m[4], z: m[5] };
  const r2: Vec3 = { x: m[6], y: m[7], z: m[8] };
  const sign = determinant(m) < 0 ? -1 : 1;
  return {
    x: sign * dot(cross(r1, r2), n),
    y: sign * dot(cross(r2, r0), n),
    z: sign * dot(cross(r0, r1), n),
  };
}
