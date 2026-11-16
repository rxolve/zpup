import { type Matrix, sinCosDegrees, transformPoint, type Vec3 } from './math.ts';

/** A straight line or cubic Bezier segment that starts where the previous one ended. */
export type Segment =
  | { readonly kind: 'line'; readonly to: Vec3 }
  | { readonly kind: 'bezier'; readonly c1: Vec3; readonly c2: Vec3; readonly to: Vec3 };

/** A path made of segments. Orthographic projection is affine, so Bezier curves stay exact. */
export interface PathGeometry {
  readonly start: Vec3;
  readonly segments: readonly Segment[];
  readonly closed: boolean;
}

/** Control-point distance that makes four cubic Beziers approximate a circle. */
const KAPPA = (4 * (Math.SQRT2 - 1)) / 3;

export function ellipseGeometry(width: number, height: number): PathGeometry {
  const rx = width / 2;
  const ry = height / 2;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  const p = (x: number, y: number): Vec3 => ({ x, y, z: 0 });
  return {
    start: p(0, -ry),
    segments: [
      { kind: 'bezier', c1: p(kx, -ry), c2: p(rx, -ky), to: p(rx, 0) },
      { kind: 'bezier', c1: p(rx, ky), c2: p(kx, ry), to: p(0, ry) },
      { kind: 'bezier', c1: p(-kx, ry), c2: p(-rx, ky), to: p(-rx, 0) },
      { kind: 'bezier', c1: p(-rx, -ky), c2: p(-kx, -ry), to: p(0, -ry) },
    ],
    closed: true,
  };
}

export function rectGeometry(width: number, height: number): PathGeometry {
  const x = width / 2;
  const y = height / 2;
  return {
    start: { x: -x, y: -y, z: 0 },
    segments: [
      { kind: 'line', to: { x, y: -y, z: 0 } },
      { kind: 'line', to: { x, y, z: 0 } },
      { kind: 'line', to: { x: -x, y, z: 0 } },
    ],
    closed: true,
  };
}

export function polygonGeometry(sides: number, radius: number): PathGeometry {
  const corner = (i: number): Vec3 => {
    const [sin, cos] = sinCosDegrees((i * 360) / sides);
    return { x: radius * sin, y: -radius * cos, z: 0 };
  };
  const segments: Segment[] = [];
  for (let i = 1; i < sides; i++) segments.push({ kind: 'line', to: corner(i) });
  return { start: corner(0), segments, closed: true };
}

export function transformGeometry(m: Matrix, g: PathGeometry): PathGeometry {
  const t = (p: Vec3) => transformPoint(m, p);
  return {
    start: t(g.start),
    segments: g.segments.map((s) =>
      s.kind === 'line'
        ? { kind: 'line', to: t(s.to) }
        : { kind: 'bezier', c1: t(s.c1), c2: t(s.c2), to: t(s.to) },
    ),
    closed: g.closed,
  };
}

/** Every point that defines the path, including Bezier control points. */
export function controlPoints(g: PathGeometry): Vec3[] {
  const points = [g.start];
  for (const s of g.segments) {
    if (s.kind === 'bezier') points.push(s.c1, s.c2);
    points.push(s.to);
  }
  return points;
}

/**
 * Splits a path into open one-segment pieces for depth sorting. Bezier
 * segments are halved so that curves such as ellipses get eight pieces.
 * A closed path gets an extra closing line unless it already ends at its start.
 */
export function splitPath(g: PathGeometry): { geometry: PathGeometry; closing: boolean }[] {
  if (g.segments.length === 0) return [{ geometry: g, closing: false }];
  const pieces: { geometry: PathGeometry; closing: boolean }[] = [];
  let from = g.start;
  for (const s of g.segments) {
    if (s.kind === 'line') {
      pieces.push({ geometry: { start: from, segments: [s], closed: false }, closing: false });
    } else {
      const [first, second] = halveBezier(from, s);
      pieces.push({ geometry: { start: from, segments: [first], closed: false }, closing: false });
      pieces.push({
        geometry: { start: first.to, segments: [second], closed: false },
        closing: false,
      });
    }
    from = s.to;
  }
  if (g.closed && !samePoint(from, g.start)) {
    pieces.push({
      geometry: { start: from, segments: [{ kind: 'line', to: g.start }], closed: false },
      closing: true,
    });
  }
  return pieces;
}

type Bezier = Extract<Segment, { kind: 'bezier' }>;

/** Splits a cubic Bezier at t = 0.5 (de Casteljau). */
function halveBezier(from: Vec3, s: Bezier): [Bezier, Bezier] {
  const mid = (a: Vec3, b: Vec3): Vec3 => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  });
  const ab = mid(from, s.c1);
  const bc = mid(s.c1, s.c2);
  const cd = mid(s.c2, s.to);
  const abc = mid(ab, bc);
  const bcd = mid(bc, cd);
  const center = mid(abc, bcd);
  return [
    { kind: 'bezier', c1: ab, c2: abc, to: center },
    { kind: 'bezier', c1: bcd, c2: cd, to: s.to },
  ];
}

const BEZIER_STEPS = 8;

/** Approximates the path with straight lines (used for depth analysis, not for drawing). */
export function flatten(g: PathGeometry): Vec3[] {
  const points = [g.start];
  let from = g.start;
  for (const s of g.segments) {
    if (s.kind === 'line') {
      points.push(s.to);
    } else {
      for (let i = 1; i <= BEZIER_STEPS; i++) {
        const t = i / BEZIER_STEPS;
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const c = 3 * u * t * t;
        const d = t * t * t;
        points.push({
          x: a * from.x + b * s.c1.x + c * s.c2.x + d * s.to.x,
          y: a * from.y + b * s.c1.y + c * s.c2.y + d * s.to.y,
          z: a * from.z + b * s.c1.z + c * s.c2.z + d * s.to.z,
        });
      }
    }
    from = s.to;
  }
  // A closed path whose last point repeats the first needs no duplicate.
  const last = points[points.length - 1];
  if (g.closed && points.length > 1 && last && samePoint(last, g.start)) points.pop();
  return points;
}

function samePoint(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}
