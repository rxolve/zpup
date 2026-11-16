/**
 * Geometry of the solids (box, cylinder, cone, hemisphere).
 *
 * A solid becomes several filled faces. Flat faces (box sides, round ends)
 * are fixed 3D outlines, like any other shape. Round surfaces are not: their
 * outline on screen depends on the view. Each one is built as a closed path
 * from 3D points on the surface (the rims and the contour where the surface
 * turns away from the viewer), so it can be projected and depth-sorted like
 * the rest, and its path commands are the same at every view angle; only the
 * points move.
 */
import { shadeColor } from './color.ts';
import { ellipseGeometry, type PathGeometry, type Segment, transformGeometry } from './geometry.ts';
import { cross, dot, invert, length, type Matrix, transformNormal, type Vec3 } from './math.ts';

export type SolidKind = 'box' | 'cylinder' | 'cone' | 'hemisphere';

/** A solid after validation. Sizes are in local units. */
export interface NormalizedSolid {
  readonly kind: SolidKind;
  /** Box only. */
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** Cylinder, cone and hemisphere. */
  readonly diameter: number;
  /** Cylinder and cone. */
  readonly length: number;
  readonly color: string;
  readonly stroke: number;
  readonly shade: boolean;
  /** Colors given per face, by option name (`frontFace`, `backface`, ...). */
  readonly faces: Readonly<Record<string, string>>;
}

/** The face options each solid accepts. */
export const FACE_KEYS: Readonly<Record<SolidKind, readonly string[]>> = {
  box: ['frontFace', 'rearFace', 'leftFace', 'rightFace', 'topFace', 'bottomFace'],
  cylinder: ['frontFace', 'backface'],
  cone: ['backface'],
  hemisphere: ['backface'],
};

/**
 * The part of a solid's front surface needed to find its depth at a screen
 * point: the solid's local shape and the transform from screen space back to
 * local space.
 */
export interface Surface {
  readonly kind: 'cylinder' | 'cone' | 'hemisphere';
  readonly radius: number;
  readonly length: number;
  /** Screen space to local space. */
  readonly inverse: Matrix;
}

export interface SolidFace {
  /** In screen space. */
  readonly geometry: PathGeometry;
  readonly color: string;
  /**
   * Paint order within the solid: round surfaces (0) before flat faces (1).
   * A visible flat end always lies on top of the round surface next to it.
   */
  readonly layer: number;
  /** Faces turned away from the viewer; always hidden by the solid's other faces. */
  readonly backfacing: boolean;
  /** Present for round surfaces, which are not flat. */
  readonly surface: Surface | undefined;
  /** Whether the outline depends on the view rather than being fixed 3D points. */
  readonly viewDependent: boolean;
}

const X: Vec3 = { x: 1, y: 0, z: 0 };
const Y: Vec3 = { x: 0, y: 1, z: 0 };
const HALF_PI = Math.PI / 2;

/**
 * Builds the faces of a solid.
 * @param world local space to screen space (view included).
 * @param model local space to scene space (view not included), for shading.
 */
export function solidFaces(s: NormalizedSolid, world: Matrix, model: Matrix): SolidFace[] {
  const view = localView(world);
  const inverse = invert(world);
  const flat = (name: string, geometry: PathGeometry, normal: Vec3): SolidFace => ({
    geometry: transformGeometry(world, geometry),
    color: faceColor(s, name, sceneNormal(model, normal)),
    layer: 1,
    backfacing: dot(normal, view) <= 0,
    surface: undefined,
    viewDependent: false,
  });
  const round = (geometry: PathGeometry, axis: Vec3): SolidFace => ({
    geometry: transformGeometry(world, geometry),
    color: faceColor(s, '', roundNormal(model, axis)),
    layer: 0,
    backfacing: false,
    surface:
      inverse && s.kind !== 'box'
        ? { kind: s.kind, radius: s.diameter / 2, length: s.length, inverse }
        : undefined,
    viewDependent: true,
  });
  const r = s.diameter / 2;
  const Z: Vec3 = { x: 0, y: 0, z: 1 };
  const minusZ: Vec3 = { x: 0, y: 0, z: -1 };
  switch (s.kind) {
    case 'box': {
      const x = s.width / 2;
      const y = s.height / 2;
      const z = s.depth / 2;
      const quad = (points: [number, number, number][]): PathGeometry => {
        const [first, ...rest] = points.map(([px, py, pz]) => ({ x: px, y: py, z: pz }));
        return {
          start: first as Vec3,
          segments: rest.map((to) => ({ kind: 'line', to })),
          closed: true,
        };
      };
      return [
        flat(
          'rearFace',
          quad([
            [-x, -y, -z],
            [x, -y, -z],
            [x, y, -z],
            [-x, y, -z],
          ]),
          minusZ,
        ),
        flat(
          'topFace',
          quad([
            [-x, -y, -z],
            [x, -y, -z],
            [x, -y, z],
            [-x, -y, z],
          ]),
          { x: 0, y: -1, z: 0 },
        ),
        flat(
          'leftFace',
          quad([
            [-x, -y, -z],
            [-x, y, -z],
            [-x, y, z],
            [-x, -y, z],
          ]),
          { x: -1, y: 0, z: 0 },
        ),
        flat(
          'rightFace',
          quad([
            [x, -y, -z],
            [x, y, -z],
            [x, y, z],
            [x, -y, z],
          ]),
          X,
        ),
        flat(
          'bottomFace',
          quad([
            [-x, y, -z],
            [x, y, -z],
            [x, y, z],
            [-x, y, z],
          ]),
          Y,
        ),
        flat(
          'frontFace',
          quad([
            [-x, -y, z],
            [x, -y, z],
            [x, y, z],
            [-x, y, z],
          ]),
          Z,
        ),
      ];
    }
    case 'cylinder': {
      const h = s.length / 2;
      return [
        round(cylinderSide(r, h, view), Z),
        flat('backface', disc(r, -h), minusZ),
        flat('frontFace', disc(r, h), Z),
      ];
    }
    case 'cone':
      return [round(coneSide(r, s.length, view), Z), flat('backface', disc(r, 0), minusZ)];
    case 'hemisphere':
      return [round(dome(r, view), Z), flat('backface', disc(r, 0), minusZ)];
  }
}

function faceColor(s: NormalizedSolid, name: string, normal: Vec3): string {
  const own = s.faces[name];
  if (own !== undefined) return own;
  return s.shade ? shadeColor(s.color, normal) : s.color;
}

function normalize(v: Vec3): Vec3 {
  const l = length(v);
  return l === 0 ? v : { x: v.x / l, y: v.y / l, z: v.z / l };
}

/** A local face normal in scene space, as a unit vector. */
function sceneNormal(model: Matrix, n: Vec3): Vec3 {
  return normalize(transformNormal(model, n));
}

/**
 * One normal that stands for a whole round surface around the local z axis:
 * the direction perpendicular to the axis that points most toward the front
 * of the scene and slightly up. An upright cylinder's side faces the front;
 * one pointing at the viewer faces up.
 */
function roundNormal(model: Matrix, axis: Vec3): Vec3 {
  const a = normalize({
    x: model[0] * axis.x + model[1] * axis.y + model[2] * axis.z,
    y: model[3] * axis.x + model[4] * axis.y + model[5] * axis.z,
    z: model[6] * axis.x + model[7] * axis.y + model[8] * axis.z,
  });
  const g: Vec3 = { x: 0, y: -0.3, z: 1 };
  const along = dot(g, a);
  const n = { x: g.x - along * a.x, y: g.y - along * a.y, z: g.z - along * a.z };
  return length(n) < 1e-9 ? { x: 0, y: -1, z: 0 } : normalize(n);
}

/**
 * The direction toward the viewer, in the solid's local space, as a unit
 * vector. A local surface normal `n` faces the viewer when `dot(n, view) > 0`.
 */
export function localView(world: Matrix): Vec3 {
  const r0: Vec3 = { x: world[0], y: world[1], z: world[2] };
  const r1: Vec3 = { x: world[3], y: world[4], z: world[5] };
  const r2: Vec3 = { x: world[6], y: world[7], z: world[8] };
  const v = cross(r0, r1);
  const sign = dot(r2, v) < 0 ? -1 : 1;
  const l = length(v);
  if (l < 1e-12) return { x: 0, y: 0, z: 1 };
  return { x: (sign * v.x) / l, y: (sign * v.y) / l, z: (sign * v.z) / l };
}

/** Angle, in the local x/y plane, of the view direction; 0 when looking along z. */
function viewAngle(view: Vec3): number {
  return Math.hypot(view.x, view.y) > 1e-9 ? Math.atan2(view.y, view.x) : 0;
}

/**
 * Cubic Bezier segments along the circle `center + r (cos t * a + sin t * b)`
 * from `t0` over `span` radians (negative goes the other way), in `count`
 * equal parts of at most a quarter turn each.
 */
function arc(
  center: Vec3,
  a: Vec3,
  b: Vec3,
  r: number,
  t0: number,
  span: number,
  count: number,
): Segment[] {
  const at = (t: number, k: number): Vec3 => {
    const c = Math.cos(t);
    const s = Math.sin(t);
    // The point at t, moved k times along the tangent.
    const u = c - k * s;
    const w = s + k * c;
    return {
      x: center.x + r * (u * a.x + w * b.x),
      y: center.y + r * (u * a.y + w * b.y),
      z: center.z + r * (u * a.z + w * b.z),
    };
  };
  const step = span / count;
  const k = (4 / 3) * Math.tan(step / 4);
  const segments: Segment[] = [];
  for (let i = 0; i < count; i++) {
    const from = t0 + step * i;
    const to = from + step;
    segments.push({ kind: 'bezier', c1: at(from, k), c2: at(to, -k), to: at(to, 0) });
  }
  return segments;
}

function rim(r: number, z: number, t: number): Vec3 {
  return { x: r * Math.cos(t), y: r * Math.sin(t), z };
}

/** Ends the path exactly at its start, so that it closes without a sliver. */
function closeAt(start: Vec3, segments: Segment[]): PathGeometry {
  const last = segments[segments.length - 1];
  if (last) segments[segments.length - 1] = { ...last, to: start };
  return { start, segments, closed: true };
}

function disc(r: number, z: number): PathGeometry {
  const e = ellipseGeometry(2 * r, 2 * r);
  const lift = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z });
  return {
    start: lift(e.start),
    segments: e.segments.map((s) =>
      s.kind === 'line'
        ? { kind: 'line', to: lift(s.to) }
        : { kind: 'bezier', c1: lift(s.c1), c2: lift(s.c2), to: lift(s.to) },
    ),
    closed: true,
  };
}

/**
 * The outline of a cylinder's side: the two contour lines where the side
 * turns away from the viewer, joined by half of each end's rim. At the end
 * that faces the viewer this is the far half of the rim, since the end itself
 * is drawn on top; at the other end it is the near half. The result covers
 * the whole silhouette. When the ends are seen edge-on the two choices of
 * half project to the same line, so the outline changes smoothly.
 *
 * Commands: M L C C L C C Z.
 */
function cylinderSide(r: number, h: number, view: Vec3): PathGeometry {
  const t1 = viewAngle(view) + HALF_PI;
  const sigma = view.z >= 0 ? Math.PI : -Math.PI;
  const start = rim(r, -h, t1);
  return closeAt(start, [
    { kind: 'line', to: rim(r, h, t1) },
    ...arc({ x: 0, y: 0, z: h }, X, Y, r, t1, sigma, 2),
    { kind: 'line', to: rim(r, -h, t1 + sigma) },
    ...arc({ x: 0, y: 0, z: -h }, X, Y, r, t1 + sigma, sigma, 2),
  ]);
}

/**
 * The outline of a cone's side: the two contour lines from the base rim to
 * the tip, and the part of the rim between them that is farthest from the
 * tip on screen. When the tip is inside the base on screen there are no
 * contour lines; both meet at one rim point, the rim is drawn all the way
 * round, and the path runs to the tip and back along one line.
 *
 * Commands: M L L C C C C Z.
 */
function coneSide(r: number, l: number, view: Vec3): PathGeometry {
  const psi = viewAngle(view);
  const rho = Math.hypot(view.x, view.y);
  let beta: number;
  if (l * rho > 1e-12) {
    beta = Math.acos(Math.min(1, Math.max(-1, (-r * view.z) / (l * rho))));
  } else {
    beta = view.z > 0 ? Math.PI : view.z < 0 ? 0 : HALF_PI;
  }
  // Generators within beta of psi face the viewer. Their rim is the far side
  // when the base is hidden, and the near side when the base is visible.
  const sigma = view.z >= 0 ? 2 * beta : -(2 * Math.PI - 2 * beta);
  const from = psi - beta;
  const start = rim(r, 0, psi + beta);
  return closeAt(start, [
    { kind: 'line', to: { x: 0, y: 0, z: l } },
    { kind: 'line', to: rim(r, 0, from) },
    ...arc({ x: 0, y: 0, z: 0 }, X, Y, r, from, sigma, 4),
  ]);
}

/**
 * The outline of a hemisphere's dome: half of the base rim, then half of the
 * sphere's contour (the great circle perpendicular to the view) on the dome
 * side. The two halves meet where the contour crosses the base.
 *
 * Commands: M C C C C Z.
 */
function dome(r: number, view: Vec3): PathGeometry {
  const psi = viewAngle(view);
  const rho = Math.hypot(view.x, view.y);
  const e1: Vec3 = { x: Math.sin(psi), y: -Math.cos(psi), z: 0 };
  const minusE1: Vec3 = { x: -e1.x, y: -e1.y, z: 0 };
  const sign = view.z < 0 ? -1 : 1;
  // Perpendicular to the view and to e1, on the dome side (z >= 0).
  const e2: Vec3 =
    rho > 1e-9
      ? { x: (-view.z * view.x) / rho, y: (-view.z * view.y) / rho, z: rho }
      : { x: -sign * Math.cos(psi), y: -sign * Math.sin(psi), z: 0 };
  const sigma = view.z >= 0 ? Math.PI : -Math.PI;
  const origin: Vec3 = { x: 0, y: 0, z: 0 };
  const start = rim(r, 0, psi - HALF_PI);
  return closeAt(start, [
    ...arc(origin, X, Y, r, psi - HALF_PI, sigma, 2),
    ...arc(origin, minusE1, e2, r, 0, Math.PI, 2),
  ]);
}

/**
 * Depth of a solid's front surface at a screen point, or undefined when the
 * line of sight misses the solid. The line of sight is followed in the
 * solid's local space, where the solid has its plain shape.
 */
export function surfaceDepth(s: Surface, x: number, y: number): number | undefined {
  const m = s.inverse;
  // Local point where the line of sight crosses screen depth 0, and the
  // local direction of one unit of screen depth.
  const px = m[0] * x + m[1] * y + m[9];
  const py = m[3] * x + m[4] * y + m[10];
  const pz = m[6] * x + m[7] * y + m[11];
  const dx = m[2];
  const dy = m[5];
  const dz = m[8];
  const r = s.radius;
  let count: number;
  let slabbed: boolean;
  if (s.kind === 'cylinder') {
    count = quadratic(dx * dx + dy * dy, 2 * (px * dx + py * dy), px * px + py * py - r * r);
    slabbed = linear(pz, dz, -s.length / 2, s.length / 2);
  } else if (s.kind === 'cone') {
    if (s.length <= 0) return undefined;
    const k = r / s.length;
    const q = r - k * pz;
    count = quadratic(
      dx * dx + dy * dy - k * k * dz * dz,
      2 * (px * dx + py * dy) + 2 * q * k * dz,
      px * px + py * py - q * q,
    );
    slabbed = linear(pz, dz, 0, s.length);
  } else {
    count = quadratic(
      dx * dx + dy * dy + dz * dz,
      2 * (px * dx + py * dy + pz * dz),
      px * px + py * py + pz * pz - r * r,
    );
    slabbed = linear(pz, dz, 0, Number.POSITIVE_INFINITY);
  }
  if (!slabbed) return undefined;
  let front: number | undefined;
  for (let i = 0; i < count; i++) {
    const a = Math.max(intervals[2 * i] as number, slab[0] as number);
    const b = Math.min(intervals[2 * i + 1] as number, slab[1] as number);
    if (a <= b && Number.isFinite(b) && (front === undefined || b > front)) front = b;
  }
  return front;
}

// Scratch space for surfaceDepth, which runs for every sample point of the
// depth sorter: the intervals found by `quadratic` and by `linear`.
const intervals = new Float64Array(4);
const slab = new Float64Array(2);

/**
 * The values of s where `z0 + s * dz` lies in [lo, hi], written to `slab`.
 * Returns false when there are none.
 */
function linear(z0: number, dz: number, lo: number, hi: number): boolean {
  if (Math.abs(dz) < 1e-12) {
    if (!(z0 >= lo && z0 <= hi)) return false;
    slab[0] = Number.NEGATIVE_INFINITY;
    slab[1] = Number.POSITIVE_INFINITY;
    return true;
  }
  const a = (lo - z0) / dz;
  const b = (hi - z0) / dz;
  if (a < b) {
    slab[0] = a;
    slab[1] = b;
  } else {
    slab[0] = b;
    slab[1] = a;
  }
  return true;
}

/**
 * The intervals of s where `a s^2 + b s + c <= 0`, written to `intervals` as
 * pairs of ends. Returns how many there are (0, 1 or 2).
 */
function quadratic(a: number, b: number, c: number): number {
  const set = (i: number, lo: number, hi: number) => {
    intervals[2 * i] = lo;
    intervals[2 * i + 1] = hi;
  };
  const scale = Math.max(1, Math.abs(b), Math.abs(c));
  if (Math.abs(a) < 1e-10 * scale) {
    if (Math.abs(b) < 1e-12) {
      if (!(c <= 0)) return 0;
      set(0, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
      return 1;
    }
    const root = -c / b;
    if (b > 0) set(0, Number.NEGATIVE_INFINITY, root);
    else set(0, root, Number.POSITIVE_INFINITY);
    return 1;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) {
    if (a > 0) return 0;
    set(0, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
    return 1;
  }
  const sq = Math.sqrt(disc);
  const r1 = (-b - sq) / (2 * a);
  const r2 = (-b + sq) / (2 * a);
  const lo = Math.min(r1, r2);
  const hi = Math.max(r1, r2);
  if (a > 0) {
    set(0, lo, hi);
    return 1;
  }
  set(0, Number.NEGATIVE_INFINITY, lo);
  set(1, hi, Number.POSITIVE_INFINITY);
  return 2;
}
