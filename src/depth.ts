import type { Vec3 } from './math.ts';

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
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  /** Mean depth of the outline, used when overlap gives no answer. */
  readonly meanDepth: number;
}

const EPSILON = 1e-6;

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
    plane: shape.fill ? fitPlane(points) : undefined,
    minX: minX - radius,
    maxX: maxX + radius,
    minY: minY - radius,
    maxY: maxY + radius,
    meanDepth: points.length > 0 ? depthSum / points.length : 0,
  };
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

function insidePolygon(points: readonly Vec3[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i] as Vec3;
    const b = points[j] as Vec3;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Depth of the front surface of a shape at a screen point, or undefined when
 * the shape does not cover that point. Round strokes are treated as tubes
 * (and single points as spheres), so their surface bulges toward the viewer;
 * filled areas are treated as flat sheets.
 */
function depthAt(s: Analyzed, x: number, y: number): number | undefined {
  let best: number | undefined;
  const r2 = s.radius * s.radius;
  if (s.radius > 0) {
    for (const [a, b] of s.segments) {
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
  if (s.plane && insidePolygon(s.points, x, y)) {
    const { center: c, normal: n } = s.plane;
    const z = c.z - (n.x * (x - c.x) + n.y * (y - c.y)) / n.z;
    if (best === undefined || z > best) best = z;
  }
  return best;
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

/** Closest pair of points between two screen-space segments. */
function closestPair(a: Vec3, b: Vec3, c: Vec3, d: Vec3): [number, number, number, number] {
  const hit = intersection(a, b, c, d);
  if (hit) return [hit[0], hit[1], hit[0], hit[1]];
  let best: [number, number, number, number] = [a.x, a.y, c.x, c.y];
  let bestDistance = Number.POSITIVE_INFINITY;
  const consider = (px: number, py: number, qx: number, qy: number) => {
    const dist = (px - qx) ** 2 + (py - qy) ** 2;
    if (dist < bestDistance) {
      bestDistance = dist;
      best = [px, py, qx, qy];
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
  return best;
}

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
      const [px, py, qx, qy] = closestPair(p, q, r, s);
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
    }
  }
  // Two filled areas that cross without containing each other's corners.
  if (count > 1) samples.push([ix / count, iy / count]);
  return samples;
}

/** 1 when `a` is in front of `b`, -1 when behind, 0 when they do not overlap or it is unclear. */
function compare(a: Analyzed, b: Analyzed): number {
  if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) return 0;
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

/**
 * Returns the order in which to paint shapes, back to front, as indices into
 * `shapes`.
 *
 * Every pair of shapes whose screen bounds overlap is compared where they
 * actually overlap, and the resulting "paint before" constraints are
 * topologically sorted. Shapes that do not overlap, or whose order is unclear,
 * fall back to mean depth and then to input order. Cycles (for example three
 * sticks woven over and under each other) are broken at the shape with the
 * lowest mean depth. When several shapes are free to go next, the one that
 * continues the previous shape (see {@link DepthShape.follows}) wins. The
 * result is fully deterministic.
 */
export function depthOrder(shapes: readonly DepthShape[]): number[] {
  const items = shapes.map(analyze);
  const n = items.length;
  // after[i] lists shapes that must be painted after shape i.
  const after: number[][] = items.map(() => []);
  const blockers = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const result = compare(items[i] as Analyzed, items[j] as Analyzed);
      if (result > 0) {
        (after[j] as number[]).push(i);
        blockers[i] = (blockers[i] ?? 0) + 1;
      } else if (result < 0) {
        (after[i] as number[]).push(j);
        blockers[j] = (blockers[j] ?? 0) + 1;
      }
    }
  }

  const placed = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  const precedes = (a: Analyzed, b: Analyzed) =>
    a.meanDepth < b.meanDepth || (a.meanDepth === b.meanDepth && a.index < b.index);
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
    const chosen = (pick ?? fallback) as Analyzed;
    placed[chosen.index] = true;
    order.push(chosen.index);
    previous = chosen.index;
    for (const next of after[chosen.index] as number[]) blockers[next] = (blockers[next] ?? 0) - 1;
  }
  return order;
}

/** The ordering a classic painter's algorithm would use: mean depth only. */
export function meanDepthOrder(shapes: readonly DepthShape[]): number[] {
  return shapes
    .map(analyze)
    .sort((a, b) => a.meanDepth - b.meanDepth || a.index - b.index)
    .map((a) => a.index);
}
