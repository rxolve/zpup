import type { Vec3 } from './math.ts';
import { type SolidBody, type Surface, surfaceDepth } from './solids.ts';

/**
 * A projected shape as seen by the depth sorter. Points are in screen space:
 * `x` and `y` are pixels and `z` is depth, larger meaning closer to the viewer.
 */
export interface DepthShape {
  /** The outline approximated by straight lines. */
  readonly points: readonly Vec3[];
  /** Whether the outline continues from the last point back to the first. */
  readonly closed: boolean;
  /** Whether the inside is painted. */
  readonly fill: boolean;
  /** Half the stroke width, in pixels. */
  readonly radius: number;
  /**
   * Index of the shape this one continues (the previous piece of the same
   * outline). When the order is otherwise free, a piece is painted right after
   * the piece it continues so that renderers can join them into one path.
   */
  readonly follows?: number;
  /**
   * Shapes with the same `solid` are faces of one convex solid. They are not
   * compared by depth: the one with the lower `layer` is painted first, and
   * faces on the same layer only share edges, so either order is right.
   */
  readonly solid?: number;
  readonly layer?: number;
  /** For a face of a solid: the solid as a whole, shared by all of its faces. */
  readonly body?: SolidBody;
  /** For a filled area that is not flat: its exact front surface. */
  readonly surface?: Surface;
  /**
   * The plane the shape lies in, when it is known to be flat: a point on it
   * and its normal (either way). An outline segment is a line, so its plane
   * cannot be found from its points; it comes from the shape it is part of.
   */
  readonly plane?: { readonly point: Vec3; readonly normal: Vec3 };
}

interface Plane {
  readonly center: Vec3;
  readonly normal: Vec3;
}

interface Analyzed {
  readonly index: number;
  readonly follows: number | undefined;
  readonly points: readonly Vec3[];
  readonly segments: readonly (readonly [Vec3, Vec3])[];
  readonly radius: number;
  readonly fill: boolean;
  /** Present for filled shapes that are flat and not seen edge-on. */
  readonly plane: Plane | undefined;
  readonly surface: Surface | undefined;
  /** The plane the shape lies in, when known, with its normal turned toward the viewer and of unit length. */
  readonly carrier: Plane | undefined;
  /** Whether the inside has a known depth (a plane or a surface). */
  readonly area: boolean;
  readonly solid: number | undefined;
  readonly body: SolidBody | undefined;
  readonly layer: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  /** Mean depth of the outline, used when overlap gives no answer. */
  readonly meanDepth: number;
  /** Built on the first call to {@link depthAt}. */
  bands?: Bands;
}

/**
 * The shape's stroke segments and outline edges sorted into horizontal bands,
 * so that a depth query only looks at those that can reach its row. Which
 * segments and edges are skipped changes nothing: a skipped segment is too far
 * away to count, and a skipped edge does not cross the row.
 */
interface Bands {
  readonly minY: number;
  readonly height: number;
  /** Indices into `segments`, per band. Empty when the stroke has no width. */
  readonly segments: readonly (readonly number[])[];
  /** Indices `i` of outline edges from `points[i - 1]` (or the last point) to `points[i]`, per band. */
  readonly edges: readonly (readonly number[])[];
}

/** Extra reach for band membership, well above the {@link EPSILON} slack in the stroke test. */
const BAND_MARGIN = 0.01;

const EPSILON = 1e-6;

/**
 * How much work the sorter has done since the counters were last reset:
 * calls to {@link depthOrder}, pairs compared, of those the pairs that
 * needed the area grid of a round surface, and pairs measured to break a
 * cycle. Not part of the public API; tests
 * use it to catch performance regressions without timing anything.
 */
export const depthWork = { sorts: 0, comparisons: 0, roundComparisons: 0, cycleComparisons: 0 };

function analyze(shape: DepthShape, index: number): Analyzed {
  const { points, radius } = shape;
  const segments: [Vec3, Vec3][] = [];
  for (let i = 0; i + 1 < points.length; i++)
    segments.push([points[i] as Vec3, points[i + 1] as Vec3]);
  if (shape.closed && points.length > 2)
    segments.push([points[points.length - 1] as Vec3, points[0] as Vec3]);
  if (points.length === 1) segments.push([points[0] as Vec3, points[0] as Vec3]);

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let depthSum = 0;
  const surface = shape.fill ? shape.surface : undefined;
  const plane = shape.fill && !surface ? fitPlane(points) : undefined;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    depthSum += p.z;
  }
  return {
    index,
    follows: shape.follows,
    points,
    segments,
    radius,
    fill: shape.fill,
    plane,
    surface,
    carrier: shape.plane && towardViewer(shape.plane.point, shape.plane.normal),
    area: plane !== undefined || surface !== undefined,
    solid: shape.solid,
    body: shape.body,
    layer: shape.layer ?? 0,
    minX: minX - radius,
    maxX: maxX + radius,
    minY: minY - radius,
    maxY: maxY + radius,
    meanDepth: points.length > 0 ? depthSum / points.length : 0,
  };
}

/** A plane with its normal of unit length and toward the viewer; undefined when seen edge-on. */
function towardViewer(center: Vec3, normal: Vec3): Plane | undefined {
  const size = Math.hypot(normal.x, normal.y, normal.z);
  if (!(Math.abs(normal.z) > size * 1e-9)) return undefined;
  const k = (normal.z > 0 ? 1 : -1) / size;
  return { center, normal: { x: normal.x * k, y: normal.y * k, z: normal.z * k } };
}

/**
 * Whether all of `b`, stroke included, lies behind the plane of `a` by at
 * least `a`'s stroke radius. Then a plane parallel to `a`'s separates the two,
 * so `a` is in front of `b` wherever they overlap on screen, and no sampling
 * is needed: a detail lying outside a sphere on a plane that faces the viewer
 * stays in front of the sphere right up to the sphere's outline, where depth
 * samples change steeply. A round surface bulges past its outline points, so
 * it is never `b` here.
 */
function behindPlane(a: Analyzed, b: Analyzed): boolean {
  const plane = a.carrier;
  if (!plane || b.surface || b.points.length === 0) return false;
  const { center, normal } = plane;
  const limit = -a.radius - b.radius + EPSILON;
  for (const q of b.points) {
    const d =
      normal.x * (q.x - center.x) + normal.y * (q.y - center.y) + normal.z * (q.z - center.z);
    if (d > limit) return false;
  }
  return true;
}

/** Slack, in screen units, for a point counted as lying on a face's plane. */
const ON_PLANE = 1e-4;

/**
 * Where the outline of `b` lies against the plane of the flat face `a`: 1
 * when all of it is on the plane or on the viewer's side and some of it is
 * clearly on the viewer's side, -1 for the far side, 0 when it straddles the
 * plane or lies in it.
 */
function sideOfFace(a: Analyzed, b: Analyzed): number {
  const plane = a.plane && towardViewer(a.plane.center, a.plane.normal);
  if (!plane) return 0;
  const { center, normal } = plane;
  let near = false;
  let far = false;
  for (const q of b.points) {
    const d =
      normal.x * (q.x - center.x) + normal.y * (q.y - center.y) + normal.z * (q.z - center.z);
    if (d > ON_PLANE) near = true;
    else if (d < -ON_PLANE) far = true;
    if (near && far) return 0;
  }
  return near ? 1 : far ? -1 : 0;
}

/**
 * Orders two flat faces of different solids by the plane of either one: 1
 * when `a` is in front, -1 when behind, 0 when the planes do not decide.
 *
 * Solids stand on each other's flat faces, so a wall often has an edge lying
 * exactly in the plane of the face it stands on or carries (a hut's wall under
 * the base of its roof). Depth samples near that edge differ by rounding
 * only, and when the face is seen nearly edge-on its depth changes steeply
 * across the screen, so sampling can put the wall behind it. A face whose
 * outline lies wholly on one side of the other's plane needs no sampling: the
 * plane separates them. Strokes are ignored here; the faces of touching
 * solids overlap by their strokes and are still meant to be apart.
 */
function splitByFacePlane(a: Analyzed, b: Analyzed): number {
  if (a.solid === undefined || b.solid === undefined || !a.plane || !b.plane) return 0;
  // b on the viewer's side of a's plane, or a on the far side of b's: b in front.
  const bInFront = sideOfFace(a, b) > 0 || sideOfFace(b, a) < 0;
  const aInFront = sideOfFace(b, a) > 0 || sideOfFace(a, b) < 0;
  if (aInFront === bInFront) return 0;
  return aInFront ? 1 : -1;
}

/**
 * Whether a flat face of the solid that `a` belongs to has all of `b` on its
 * outer side: 1 when that puts `b` in front of the solid, -1 when behind, 0
 * when no face does (or only faces seen edge-on, which leave nothing of the
 * two overlapping on screen).
 *
 * A solid lies wholly on the inner side of each of its flat faces. So when
 * `b` lies wholly on the outer side of one, that plane separates the two,
 * and whichever is on the viewer's side of it is in front everywhere, for
 * every face of the solid at once. This settles solids that stand on each
 * other and details that rest on a face, which meet along an edge or a
 * plane where depth samples differ by rounding only. Two cylinders of one
 * width stacked end to end are the plainest case: their sides share half a
 * rim. A stroke counts as part of `b`, except the rounded edges of another
 * solid, which reach into touching solids on purpose.
 */
function outsideFace(a: Analyzed, b: Analyzed): number {
  if (!a.body) return 0;
  for (const { point, normal } of a.body.planes) {
    const size = Math.hypot(normal.x, normal.y, normal.z);
    if (!(Math.abs(normal.z) > size * 1e-9)) continue;
    const level = normal.x * point.x + normal.y * point.y + normal.z * point.z;
    let least: number;
    if (b.body) {
      least = b.body.support(normal);
    } else {
      if (b.surface || b.points.length === 0) continue;
      least = Number.POSITIVE_INFINITY;
      for (const q of b.points) {
        least = Math.min(least, normal.x * q.x + normal.y * q.y + normal.z * q.z);
      }
      least -= b.radius * size;
    }
    if (least - level >= -ON_PLANE * size) return normal.z > 0 ? 1 : -1;
  }
  return 0;
}

/** Best-fit plane by Newell's method; undefined when degenerate or edge-on. */
function fitPlane(points: readonly Vec3[]): Plane | undefined {
  if (points.length < 3) return undefined;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Vec3;
    const b = points[(i + 1) % points.length] as Vec3;
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
    cx += a.x;
    cy += a.y;
    cz += a.z;
  }
  const size = Math.hypot(nx, ny, nz);
  if (size < EPSILON || Math.abs(nz) < size * 1e-6) return undefined;
  const n = points.length;
  return { center: { x: cx / n, y: cy / n, z: cz / n }, normal: { x: nx, y: ny, z: nz } };
}

function buildBands(s: Analyzed): Bands {
  const count = Math.max(
    1,
    Math.min(64, Math.ceil(Math.max(s.segments.length, s.points.length) / 2)),
  );
  const minY = s.minY;
  const height = Math.max((s.maxY - s.minY) / count, EPSILON);
  const band = (y: number) => Math.min(count - 1, Math.max(0, Math.floor((y - minY) / height)));
  const fill = (lists: number[][], lo: number, hi: number, value: number) => {
    for (let k = band(lo); k <= band(hi); k++) (lists[k] as number[]).push(value);
  };
  const segments: number[][] = Array.from({ length: count }, () => []);
  if (s.radius > 0) {
    const reach = s.radius + BAND_MARGIN;
    s.segments.forEach(([a, b], i) => {
      fill(segments, Math.min(a.y, b.y) - reach, Math.max(a.y, b.y) + reach, i);
    });
  }
  const edges: number[][] = Array.from({ length: count }, () => []);
  if (s.area) {
    const { points } = s;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i] as Vec3;
      const b = points[j] as Vec3;
      fill(edges, Math.min(a.y, b.y), Math.max(a.y, b.y), i);
    }
  }
  return { minY, height, segments, edges };
}

function bandOf(bands: Bands, y: number): number {
  const k = Math.floor((y - bands.minY) / bands.height);
  return Math.min(bands.segments.length - 1, Math.max(0, k));
}

/** Even-odd test over the outline edges that can cross row `y`. */
function insideBand(s: Analyzed, edges: readonly number[], x: number, y: number): boolean {
  const { points } = s;
  let inside = false;
  for (const i of edges) {
    const a = points[i] as Vec3;
    const b = points[i === 0 ? points.length - 1 : i - 1] as Vec3;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Depth of the front surface of a shape at a screen point, or undefined when
 * the shape does not cover that point. Round strokes are treated as tubes
 * (and single points as spheres), so their surface bulges toward the viewer;
 * filled areas are treated as flat sheets, except the round surfaces of
 * solids, whose exact depth is known.
 */
function depthAt(s: Analyzed, x: number, y: number): number | undefined {
  s.bands ??= buildBands(s);
  const k = bandOf(s.bands, y);
  let best: number | undefined;
  const r2 = s.radius * s.radius;
  if (s.radius > 0) {
    for (const i of s.bands.segments[k] as number[]) {
      const segment = s.segments[i] as readonly [Vec3, Vec3];
      const a = segment[0];
      const b = segment[1];
      const t = closestT(a, b, x, y);
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      const d2 = (x - px) ** 2 + (y - py) ** 2;
      if (d2 <= r2 + EPSILON) {
        const z = a.z + (b.z - a.z) * t + Math.sqrt(Math.max(0, r2 - d2));
        if (best === undefined || z > best) best = z;
      }
    }
  }
  if (s.area && insideBand(s, s.bands.edges[k] as number[], x, y)) {
    const z = s.plane
      ? s.plane.center.z -
        (s.plane.normal.x * (x - s.plane.center.x) + s.plane.normal.y * (y - s.plane.center.y)) /
          s.plane.normal.z
      : s.surface && surfaceDepth(s.surface, x, y);
    if (z !== undefined && (best === undefined || z > best)) best = z;
  }
  return best;
}

/**
 * {@link depthAt} for the points `(xs[i], y)` of one row, written to `out`
 * with the same arithmetic, and NaN where depthAt gives undefined (depths are
 * never NaN). Only points where `need[i]` is not NaN (or all, when `need` is
 * not given) are computed; the others are left NaN. The band and the outline
 * crossings of the row are found once for the whole row.
 */
function rowDepths(
  s: Analyzed,
  y: number,
  xs: Float64Array,
  out: Float64Array,
  need?: Float64Array,
): void {
  s.bands ??= buildBands(s);
  const k = bandOf(s.bands, y);
  const count = xs.length;
  out.fill(Number.NaN);
  const r2 = s.radius * s.radius;
  if (s.radius > 0) {
    for (const index of s.bands.segments[k] as number[]) {
      const segment = s.segments[index] as readonly [Vec3, Vec3];
      const a = segment[0];
      const b = segment[1];
      // Points farther than the stroke from the segment's columns cannot pass.
      const left = Math.min(a.x, b.x) - s.radius - BAND_MARGIN;
      const right = Math.max(a.x, b.x) + s.radius + BAND_MARGIN;
      for (let i = 0; i < count; i++) {
        if (need && Number.isNaN(need[i] as number)) continue;
        const x = xs[i] as number;
        if (x < left || x > right) continue;
        const t = closestT(a, b, x, y);
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t;
        const d2 = (x - px) ** 2 + (y - py) ** 2;
        if (d2 <= r2 + EPSILON) {
          const z = a.z + (b.z - a.z) * t + Math.sqrt(Math.max(0, r2 - d2));
          const best = out[i] as number;
          if (Number.isNaN(best) || z > best) out[i] = z;
        }
      }
    }
  }
  if (!s.area) return;
  // Where the row crosses the outline: a point is inside when an odd number
  // of crossings lie to its right, as in the even-odd test of depthAt.
  const crossings: number[] = [];
  const { points } = s;
  for (const index of s.bands.edges[k] as number[]) {
    const a = points[index] as Vec3;
    const b = points[index === 0 ? points.length - 1 : index - 1] as Vec3;
    if (a.y > y !== b.y > y) crossings.push(((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x);
  }
  if (crossings.length === 0) return;
  for (let i = 0; i < count; i++) {
    if (need && Number.isNaN(need[i] as number)) continue;
    const x = xs[i] as number;
    let inside = false;
    for (const c of crossings) if (x < c) inside = !inside;
    if (!inside) continue;
    const z = s.plane
      ? s.plane.center.z -
        (s.plane.normal.x * (x - s.plane.center.x) + s.plane.normal.y * (y - s.plane.center.y)) /
          s.plane.normal.z
      : s.surface && surfaceDepth(s.surface, x, y);
    const best = out[i] as number;
    if (z !== undefined && (Number.isNaN(best) || z > best)) out[i] = z;
  }
}

/** Parameter of the point on segment ab closest to (x, y), in screen space. */
function closestT(a: Vec3, b: Vec3, x: number, y: number): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPSILON) return 0;
  return Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / len2));
}

function intersection(a: Vec3, b: Vec3, c: Vec3, d: Vec3): [number, number] | undefined {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < EPSILON) return undefined;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return undefined;
  return [a.x + rx * t, a.y + ry * t];
}

/**
 * Closest pair of points between two screen-space segments, written to `out`
 * as `[px, py, qx, qy]` (a point on `ab`, then one on `cd`). Writing into one
 * reused array avoids an allocation per pair of segments.
 */
function closestPair(a: Vec3, b: Vec3, c: Vec3, d: Vec3, out: Float64Array): void {
  const hit = intersection(a, b, c, d);
  if (hit) {
    out[0] = hit[0];
    out[1] = hit[1];
    out[2] = hit[0];
    out[3] = hit[1];
    return;
  }
  out[0] = a.x;
  out[1] = a.y;
  out[2] = c.x;
  out[3] = c.y;
  let bestDistance = Number.POSITIVE_INFINITY;
  const consider = (px: number, py: number, qx: number, qy: number) => {
    const dist = (px - qx) ** 2 + (py - qy) ** 2;
    if (dist < bestDistance) {
      bestDistance = dist;
      out[0] = px;
      out[1] = py;
      out[2] = qx;
      out[3] = qy;
    }
  };
  const onSegment = (p: Vec3, r: Vec3, s: Vec3, flip: boolean) => {
    const t = closestT(r, s, p.x, p.y);
    const qx = r.x + (s.x - r.x) * t;
    const qy = r.y + (s.y - r.y) * t;
    if (flip) consider(qx, qy, p.x, p.y);
    else consider(p.x, p.y, qx, qy);
  };
  onSegment(a, c, d, false);
  onSegment(b, c, d, false);
  onSegment(c, a, b, true);
  onSegment(d, a, b, true);
}

const pair = new Float64Array(4);

/** Screen points where two shapes are likely to overlap. */
function samplePoints(a: Analyzed, b: Analyzed): [number, number][] {
  const samples: [number, number][] = [];
  // Outline points find filled areas that contain the other shape.
  for (const p of a.points) samples.push([p.x, p.y]);
  for (const p of b.points) samples.push([p.x, p.y]);
  let ix = 0;
  let iy = 0;
  let count = 0;
  for (const [p, q] of a.segments) {
    for (const [r, s] of b.segments) {
      // The middle of the region where the two round strokes overlap,
      // measured along the line between their closest points.
      closestPair(p, q, r, s, pair);
      const px = pair[0] as number;
      const py = pair[1] as number;
      const qx = pair[2] as number;
      const qy = pair[3] as number;
      const distance = Math.hypot(qx - px, qy - py);
      if (distance === 0) {
        samples.push([px, py]);
        ix += px;
        iy += py;
        count++;
      } else if (distance <= a.radius + b.radius) {
        const lo = Math.max(0, distance - b.radius);
        const hi = Math.min(a.radius, distance);
        const t = Math.min(hi, Math.max(lo, (distance + a.radius - b.radius) / 2)) / distance;
        samples.push([px + (qx - px) * t, py + (qy - py) * t]);
      }
      // A round stroke that reaches across the edge of a filled area covers
      // part of its inside too. The points above lie on that edge, where the
      // inside test can go either way, so also sample halfway between the
      // edge and the far side of the stroke.
      if (distance > 0) {
        if (b.area && distance <= a.radius) {
          const t = (distance + a.radius) / 2 / distance;
          samples.push([px + (qx - px) * t, py + (qy - py) * t]);
        }
        if (a.area && distance <= b.radius) {
          const t = (distance + b.radius) / 2 / distance;
          samples.push([qx + (px - qx) * t, qy + (py - qy) * t]);
        }
      }
    }
  }
  // Two filled areas that cross without containing each other's corners.
  if (count > 1) samples.push([ix / count, iy / count]);
  return samples;
}

/** 1 when `a` is in front of `b`, -1 when behind, 0 when they do not overlap or it is unclear. */
function compare(a: Analyzed, b: Analyzed): number {
  if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) return 0;
  if (a.solid !== undefined && a.solid === b.solid) return Math.sign(a.layer - b.layer);
  const outsideA = outsideFace(a, b);
  if (outsideA !== 0) return -outsideA;
  const outsideB = outsideFace(b, a);
  if (outsideB !== 0) return outsideB;
  if (behindPlane(a, b)) return 1;
  if (behindPlane(b, a)) return -1;
  const split = splitByFacePlane(a, b);
  if (split !== 0) return split;
  if (a.surface || b.surface) {
    depthWork.roundComparisons++;
    return compareRound(a, b);
  }
  let front = 0;
  let behind = 0;
  let total = 0;
  for (const [x, y] of samplePoints(a, b)) {
    const za = depthAt(a, x, y);
    if (za === undefined) continue;
    const zb = depthAt(b, x, y);
    if (zb === undefined) continue;
    const d = za - zb;
    if (d > EPSILON) front++;
    else if (d < -EPSILON) behind++;
    total += d;
  }
  if (front !== behind) return front > behind ? 1 : -1;
  if (total > EPSILON) return 1;
  if (total < -EPSILON) return -1;
  return 0;
}

/** Grid points per side used to estimate overlapping area against a round surface. */
const AREA_GRID = 12;
const gridXs = new Float64Array(AREA_GRID);
const gridA = new Float64Array(AREA_GRID);
const gridB = new Float64Array(AREA_GRID);

/**
 * {@link compare} for pairs where one shape is the round surface of a solid.
 *
 * A flat detail lying on a round surface (a door on a tower) can be partly in
 * front of the surface and partly behind it as it passes the surface's edge,
 * where the surface's depth changes steeply; both parts are inside the
 * overlap. No single order is right then, so the order that is right for the
 * larger share of the area both cover (strokes included) wins. The area is
 * estimated on a grid over the common bounds. When the grid finds no common
 * point, the usual sample points decide, by the sum of depth differences.
 */
function compareRound(a: Analyzed, b: Analyzed): number {
  const minX = Math.max(a.minX, b.minX);
  const maxX = Math.min(a.maxX, b.maxX);
  const minY = Math.max(a.minY, b.minY);
  const maxY = Math.min(a.maxY, b.maxY);
  let front = 0;
  let behind = 0;
  const xs = gridXs;
  for (let i = 0; i < AREA_GRID; i++) xs[i] = minX + ((maxX - minX) * (i + 0.5)) / AREA_GRID;
  const za = gridA;
  const zb = gridB;
  for (let j = 0; j < AREA_GRID; j++) {
    const y = minY + ((maxY - minY) * (j + 0.5)) / AREA_GRID;
    rowDepths(a, y, xs, za);
    rowDepths(b, y, xs, zb, za);
    for (let i = 0; i < AREA_GRID; i++) {
      const da = za[i] as number;
      const db = zb[i] as number;
      if (Number.isNaN(da) || Number.isNaN(db)) continue;
      if (da - db > EPSILON) front++;
      else if (db - da > EPSILON) behind++;
    }
  }
  if (front !== behind) return front > behind ? 1 : -1;
  let total = 0;
  for (const [x, y] of samplePoints(a, b)) {
    const za = depthAt(a, x, y);
    if (za === undefined) continue;
    const zb = depthAt(b, x, y);
    if (zb === undefined) continue;
    total += za - zb;
  }
  if (total > EPSILON) return 1;
  if (total < -EPSILON) return -1;
  return 0;
}

/**
 * The area, in square pixels, where `a` is closer to the viewer than `b`:
 * what is lost of `a` when it is painted before `b`. Estimated on a grid
 * over their common bounds.
 */
function frontArea(a: Analyzed, b: Analyzed): number {
  const minX = Math.max(a.minX, b.minX);
  const maxX = Math.min(a.maxX, b.maxX);
  const minY = Math.max(a.minY, b.minY);
  const maxY = Math.min(a.maxY, b.maxY);
  if (!(maxX > minX) || !(maxY > minY)) return 0;
  depthWork.cycleComparisons++;
  const xs = gridXs;
  for (let i = 0; i < AREA_GRID; i++) xs[i] = minX + ((maxX - minX) * (i + 0.5)) / AREA_GRID;
  let front = 0;
  for (let j = 0; j < AREA_GRID; j++) {
    const y = minY + ((maxY - minY) * (j + 0.5)) / AREA_GRID;
    rowDepths(a, y, xs, gridA);
    rowDepths(b, y, xs, gridB, gridA);
    for (let i = 0; i < AREA_GRID; i++) {
      if ((gridA[i] as number) - (gridB[i] as number) > EPSILON) front++;
    }
  }
  return (front * (maxX - minX) * (maxY - minY)) / (AREA_GRID * AREA_GRID);
}

/**
 * The shape to paint next when every shape left waits for another one, which
 * means some of them form a cycle. Whichever shape of a cycle goes first is
 * painted over, wrongly, by the shapes that should have gone before it; the
 * shape that loses the least area that way is chosen. A ring around a post
 * shows why: the post is in front of the ring's lid nearly everywhere, the
 * ring's side is in front of the post, and the lid goes over the side of its
 * own solid. Painting the lid first loses only the edge it shares with the
 * side; any other choice loses the whole front of the ring, or the post
 * where the lid crosses it.
 *
 * Only shapes in a cycle that waits for nothing outside itself are
 * candidates. Shapes further on, which wait for a cycle without being part
 * of one, would otherwise go first whenever they lose little, and be painted
 * over for no reason. Ties go to the lower mean depth.
 */
function cheapestBreak(
  items: readonly Analyzed[],
  placed: readonly boolean[],
  before: readonly (readonly number[])[],
  after: readonly (readonly number[])[],
  lost: (first: number, second: number) => number,
  precedes: (a: Analyzed, b: Analyzed) => boolean,
): Analyzed | undefined {
  let best: Analyzed | undefined;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const v of sourceCycles(placed, before, after)) {
    let cost = 0;
    for (const w of before[v] as readonly number[]) if (!placed[w]) cost += lost(v, w);
    const item = items[v] as Analyzed;
    if (cost < bestCost - EPSILON || (cost <= bestCost + EPSILON && best && precedes(item, best))) {
      best = item;
      bestCost = Math.min(cost, bestCost);
    }
  }
  return best;
}

/**
 * The shapes not yet placed that belong to a group of shapes all waiting for
 * each other (a strongly connected component of the "paint before" graph)
 * which waits for nothing outside itself. Tarjan's algorithm, with its own
 * stack instead of recursion so that a long chain of shapes cannot overflow.
 */
function sourceCycles(
  placed: readonly boolean[],
  before: readonly (readonly number[])[],
  after: readonly (readonly number[])[],
): number[] {
  const n = placed.length;
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const group = new Int32Array(n).fill(-1);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const path: number[] = [];
  const edge = new Int32Array(n);
  let counter = 0;
  let groups = 0;
  for (let root = 0; root < n; root++) {
    if (placed[root] || index[root] !== -1) continue;
    path.push(root);
    while (path.length > 0) {
      const v = path[path.length - 1] as number;
      if (index[v] === -1) {
        index[v] = low[v] = counter++;
        stack.push(v);
        onStack[v] = 1;
      }
      const next = after[v] as readonly number[];
      let descended = false;
      while ((edge[v] as number) < next.length) {
        const w = next[edge[v] as number] as number;
        edge[v] = (edge[v] as number) + 1;
        if (placed[w]) continue;
        if (index[w] === -1) {
          path.push(w);
          descended = true;
          break;
        }
        if (onStack[w]) low[v] = Math.min(low[v] as number, index[w] as number);
      }
      if (descended) continue;
      path.pop();
      const parent = path[path.length - 1];
      if (parent !== undefined) low[parent] = Math.min(low[parent] as number, low[v] as number);
      if (low[v] === index[v]) {
        let w: number;
        do {
          w = stack.pop() as number;
          onStack[w] = 0;
          group[w] = groups;
        } while (w !== v);
        groups++;
      }
    }
  }
  const waitsOutside = new Uint8Array(groups);
  for (let v = 0; v < n; v++) {
    if (placed[v]) continue;
    for (const w of before[v] as readonly number[]) {
      if (!placed[w] && group[w] !== group[v]) waitsOutside[group[v] as number] = 1;
    }
  }
  const result: number[] = [];
  for (let v = 0; v < n; v++) {
    if (!placed[v] && !waitsOutside[group[v] as number]) result.push(v);
  }
  return result;
}

/**
 * Returns the order in which to paint shapes, back to front, as indices into
 * `shapes`.
 *
 * Every pair of shapes whose screen bounds overlap is compared where they
 * actually overlap, and the resulting "paint before" constraints are
 * topologically sorted. Shapes that do not overlap, or whose order is unclear,
 * fall back to mean depth and then to input order. Cycles (for example three
 * sticks woven over and under each other, or a ring around a post) have no
 * right order, so they are broken where it shows least: at the shape that
 * loses the smallest area to the shapes painted over it (see
 * {@link cheapestBreak}). When several shapes are free to go next, the one
 * that continues the previous shape (see {@link DepthShape.follows}) wins.
 * The result is fully deterministic.
 *
 * `mayOverlap(i, j)`, when given, says whether shapes `i < j` can cover a
 * common point at all. It must never answer false for shapes that do; a pair
 * it rules out is not compared, which gives the same result as comparing it
 * (no common point, so no answer) without the cost. Faces of one solid are
 * ordered by rule and always compared.
 */
export function depthOrder(
  shapes: readonly DepthShape[],
  mayOverlap?: (i: number, j: number) => boolean,
): number[] {
  depthWork.sorts++;
  const items = shapes.map(analyze);
  const n = items.length;
  // after[i] lists shapes that must be painted after shape i.
  const after: number[][] = items.map(() => []);
  // before[i] lists shapes that must be painted before shape i.
  const before: number[][] = items.map(() => []);
  const blockers = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = items[i] as Analyzed;
      const b = items[j] as Analyzed;
      const sameSolid = a.solid !== undefined && a.solid === b.solid;
      if (mayOverlap && !sameSolid && !mayOverlap(i, j)) continue;
      depthWork.comparisons++;
      const result = compare(a, b);
      if (result > 0) {
        (after[j] as number[]).push(i);
        (before[i] as number[]).push(j);
        blockers[i] = (blockers[i] ?? 0) + 1;
      } else if (result < 0) {
        (after[i] as number[]).push(j);
        (before[j] as number[]).push(i);
        blockers[j] = (blockers[j] ?? 0) + 1;
      }
    }
  }

  const placed = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  const precedes = (a: Analyzed, b: Analyzed) =>
    a.meanDepth < b.meanDepth || (a.meanDepth === b.meanDepth && a.index < b.index);
  // What painting `first` before `second` costs. Only asked for shapes caught
  // in a cycle, and kept, since a cycle is often broken one shape at a time.
  const lostAreas = new Map<number, number>();
  const lost = (first: number, second: number): number => {
    const key = first * n + second;
    let area = lostAreas.get(key);
    if (area === undefined) {
      area = frontArea(items[first] as Analyzed, items[second] as Analyzed);
      lostAreas.set(key, area);
    }
    return area;
  };
  let previous = -1;
  while (order.length < n) {
    let pick: Analyzed | undefined;
    let fallback: Analyzed | undefined;
    for (const item of items) {
      if (placed[item.index]) continue;
      if (!fallback || precedes(item, fallback)) fallback = item;
      if (blockers[item.index] !== 0) continue;
      if (item.follows === previous && previous >= 0) {
        pick = item;
        break;
      }
      if (!pick || (pick.follows !== previous && precedes(item, pick))) pick = item;
    }
    const chosen = (pick ??
      cheapestBreak(items, placed, before, after, lost, precedes) ??
      fallback) as Analyzed;
    placed[chosen.index] = true;
    order.push(chosen.index);
    previous = chosen.index;
    for (const next of after[chosen.index] as number[]) blockers[next] = (blockers[next] ?? 0) - 1;
  }
  return order;
}

/**
 * Compares two shapes where they overlap on screen: 1 when `a` is in front of
 * `b`, -1 when behind, 0 when they do not overlap or it is unclear.
 */
export function compareShapes(a: DepthShape, b: DepthShape): number {
  return compare(analyze(a, 0), analyze(b, 1));
}

/** Grid points per side used by {@link crossingAreas}. */
const CROSSING_GRID = 20;
const crossXs = new Float64Array(CROSSING_GRID);
const crossA = new Float64Array(CROSSING_GRID);
const crossB = new Float64Array(CROSSING_GRID);

/**
 * How much of the screen area two shapes both cover each one is in front of,
 * in square pixels: `a` where `a` is closer to the viewer by more than
 * `tolerance`, `b` likewise. When both are well above zero the shapes pass
 * through each other, and whichever is painted last, the smaller of the two
 * areas shows the wrong shape. The areas are estimated on a grid over the
 * common bounds, so they are good to a few percent of those bounds.
 */
export function crossingAreas(
  a: DepthShape,
  b: DepthShape,
  tolerance: number,
): { a: number; b: number } {
  const sa = analyze(a, 0);
  const sb = analyze(b, 1);
  const minX = Math.max(sa.minX, sb.minX);
  const maxX = Math.min(sa.maxX, sb.maxX);
  const minY = Math.max(sa.minY, sb.minY);
  const maxY = Math.min(sa.maxY, sb.maxY);
  if (!(maxX > minX) || !(maxY > minY)) return { a: 0, b: 0 };
  let front = 0;
  let behind = 0;
  for (let i = 0; i < CROSSING_GRID; i++) {
    crossXs[i] = minX + ((maxX - minX) * (i + 0.5)) / CROSSING_GRID;
  }
  for (let j = 0; j < CROSSING_GRID; j++) {
    const y = minY + ((maxY - minY) * (j + 0.5)) / CROSSING_GRID;
    rowDepths(sa, y, crossXs, crossA);
    rowDepths(sb, y, crossXs, crossB, crossA);
    for (let i = 0; i < CROSSING_GRID; i++) {
      const d = (crossA[i] as number) - (crossB[i] as number);
      if (d > tolerance) front++;
      else if (d < -tolerance) behind++;
    }
  }
  const cell = ((maxX - minX) * (maxY - minY)) / (CROSSING_GRID * CROSSING_GRID);
  return { a: front * cell, b: behind * cell };
}

/** The ordering a classic painter's algorithm would use: mean depth only. */
export function meanDepthOrder(shapes: readonly DepthShape[]): number[] {
  return shapes
    .map(analyze)
    .sort((a, b) => a.meanDepth - b.meanDepth || a.index - b.index)
    .map((a) => a.index);
}
