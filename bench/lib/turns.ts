/**
 * Turn errors: how much of a picture is painted in the wrong front-to-back
 * order. Both 3D engines paint whole shapes back to front (the painter's
 * algorithm), so a shape painted later can cover a part of an earlier one that
 * is really in front of it. This module checks one view against a per-pixel
 * depth buffer; it knows nothing about either engine. The adapters
 * (turns-zpup.ts, and the Zdog one in zdog-runner.cjs with its parser in
 * zdog.ts) turn a scene into painted primitives in the order the engine paints
 * them.
 *
 * The rule, per sample point of a grid over the image: among the primitives
 * that cover the point, take the one painted last (what the viewer sees) and
 * the one whose surface is nearest the viewer there (what should be seen). The
 * point is wrong when the nearest one is more than DEPTH_TOLERANCE pixels in
 * front of the painted one and the two have different colors. Same-colored
 * overlaps are not counted: a mistake there cannot be seen.
 *
 * Screen space throughout: x to the right, y down, z toward the viewer, all in
 * pixels of the image.
 */
import { type Surface, surfaceDepth } from '../../src/solids.ts';

export interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * One painted element, with enough geometry to say whether it covers a point
 * and how far from the viewer its surface is there.
 */
export interface Primitive {
  readonly color: string;
  /**
   * A filled area: closed outlines, filled by the nonzero rule (the SVG
   * default, which both engines use). Its depth is the plane through the
   * outlines, or the front of `solid` when given. A fill seen edge-on has no
   * plane and covers nothing.
   */
  readonly fill?: { readonly rings: readonly (readonly Point[])[]; readonly solid?: Surface };
  /**
   * Stroked lines with round caps and joins, as tubes of this radius: the
   * depth at distance d from the center line is z + sqrt(radius² - d²). A
   * line of one point is a ball.
   */
  readonly stroke?: { readonly radius: number; readonly lines: readonly (readonly Point[])[] };
}

export interface ViewCount {
  /** Grid points covered by at least one primitive. */
  covered: number;
  /** Covered grid points painted in the wrong order (see the rule above). */
  wrong: number;
}

/** In pixels. Shapes closer together than this count as touching, not as one in front. */
export const DEPTH_TOLERANCE = 1.5;

/** Turns about the vertical axis that every scene is checked at, added to its own view. */
export const TURN_OFFSETS_DEG: readonly number[] = Array.from({ length: 12 }, (_, i) => i * 30);

/**
 * Spacing of the sample grid in pixels: one point per pixel. A coarser grid
 * (2) changed no run's median by more than 0.1 percentage points and is
 * available for larger runs; this one is cheap enough.
 */
export const GRID_STEP = 1;

/** Below this share of its size, a fill's normal is treated as edge-on. */
const EDGE_ON = 0.02;

/**
 * Checks one view. `primitives` must be in paint order, first painted first.
 * The grid has a point at the center of every `step` by `step` cell of the
 * width by height image; nothing outside the image is counted.
 */
export function checkView(
  primitives: readonly Primitive[],
  size: { width: number; height: number },
  step = GRID_STEP,
): ViewCount {
  const { topZ, topId, deepZ, deepId } = paint(primitives, size, step);
  const colors = primitives.map((p) => normalizeColor(p.color));
  let covered = 0;
  let wrong = 0;
  for (let k = 0; k < topId.length; k++) {
    const top = topId[k] as number;
    if (top < 0) continue;
    covered++;
    const deep = deepId[k] as number;
    if (
      deep !== top &&
      (deepZ[k] as number) - (topZ[k] as number) > DEPTH_TOLERANCE &&
      colors[deep] !== colors[top]
    ) {
      wrong++;
    }
  }
  return { covered, wrong };
}

/**
 * For every grid point (row by row), the index of the primitive painted last
 * there, or -1. Used to compare the checker's idea of the picture with the
 * picture itself.
 */
export function paintedMap(
  primitives: readonly Primitive[],
  size: { width: number; height: number },
  step = GRID_STEP,
): Int32Array {
  return paint(primitives, size, step).topId;
}

function paint(
  primitives: readonly Primitive[],
  size: { width: number; height: number },
  step: number,
) {
  const nx = Math.max(0, Math.ceil(size.width / step));
  const ny = Math.max(0, Math.ceil(size.height / step));
  const topZ = new Float64Array(nx * ny);
  const topId = new Int32Array(nx * ny).fill(-1);
  const deepZ = new Float64Array(nx * ny).fill(Number.NEGATIVE_INFINITY);
  const deepId = new Int32Array(nx * ny).fill(-1);
  primitives.forEach((p, id) => {
    const depth = rasterize(p, nx, ny, step);
    if (!depth) return;
    const { i0, j0, w, h, z } = depth;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const d = z[j * w + i] as number;
        if (d === Number.NEGATIVE_INFINITY) continue;
        const k = (j0 + j) * nx + i0 + i;
        topZ[k] = d;
        topId[k] = id;
        if (d > (deepZ[k] as number)) {
          deepZ[k] = d;
          deepId[k] = id;
        }
      }
    }
  });
  return { topZ, topId, deepZ, deepId };
}

/** The depth of one primitive at every grid point of its bounds; -Infinity where it does not cover. */
function rasterize(
  p: Primitive,
  nx: number,
  ny: number,
  step: number,
): { i0: number; j0: number; w: number; h: number; z: Float64Array } | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const grow = (q: Point, r: number) => {
    minX = Math.min(minX, q.x - r);
    maxX = Math.max(maxX, q.x + r);
    minY = Math.min(minY, q.y - r);
    maxY = Math.max(maxY, q.y + r);
  };
  const plane = p.fill && !p.fill.solid ? fitPlane(p.fill.rings) : undefined;
  const fills = p.fill && (p.fill.solid || plane);
  if (fills) for (const ring of p.fill?.rings ?? []) for (const q of ring) grow(q, 0);
  const radius = p.stroke && p.stroke.radius > 0 ? p.stroke.radius : 0;
  if (radius > 0) for (const line of p.stroke?.lines ?? []) for (const q of line) grow(q, radius);
  if (!(minX <= maxX && minY <= maxY)) return undefined;

  // Grid point (i, j) sits at ((i + 0.5) * step, (j + 0.5) * step).
  const i0 = Math.max(0, Math.ceil(minX / step - 0.5));
  const i1 = Math.min(nx - 1, Math.floor(maxX / step - 0.5));
  const j0 = Math.max(0, Math.ceil(minY / step - 0.5));
  const j1 = Math.min(ny - 1, Math.floor(maxY / step - 0.5));
  if (i1 < i0 || j1 < j0) return undefined;
  const w = i1 - i0 + 1;
  const h = j1 - j0 + 1;
  const z = new Float64Array(w * h).fill(Number.NEGATIVE_INFINITY);

  if (fills && p.fill) {
    const solid = p.fill.solid;
    const crossings: { x: number; dir: number }[] = [];
    for (let j = 0; j < h; j++) {
      const y = (j0 + j + 0.5) * step;
      crossings.length = 0;
      for (const ring of p.fill.rings) {
        for (let a = 0; a < ring.length; a++) {
          const s = ring[a] as Point;
          const e = ring[(a + 1) % ring.length] as Point;
          if (s.y > y !== e.y > y) {
            crossings.push({
              x: s.x + ((y - s.y) * (e.x - s.x)) / (e.y - s.y),
              dir: e.y > s.y ? 1 : -1,
            });
          }
        }
      }
      crossings.sort((a, b) => a.x - b.x);
      let winding = 0;
      for (let c = 0; c + 1 < crossings.length; c++) {
        winding += (crossings[c] as { dir: number }).dir;
        if (winding === 0) continue;
        const from = (crossings[c] as { x: number }).x;
        const to = (crossings[c + 1] as { x: number }).x;
        const a = Math.max(i0, Math.ceil(from / step - 0.5));
        const b = Math.min(i1, Math.floor(to / step - 0.5));
        for (let i = a; i <= b; i++) {
          const x = (i + 0.5) * step;
          if (x <= from || x >= to) continue;
          const d = solid
            ? surfaceDepth(solid, x, y)
            : plane
              ? plane.z0 - (plane.nx * (x - plane.x0) + plane.ny * (y - plane.y0)) / plane.nz
              : undefined;
          if (d !== undefined && Number.isFinite(d)) z[j * w + (i - i0)] = d;
        }
      }
    }
  }

  if (radius > 0 && p.stroke) {
    const r2 = radius * radius;
    for (const line of p.stroke.lines) {
      const n = line.length;
      for (let s = 0; s < Math.max(1, n - 1); s++) {
        const a = line[s] as Point | undefined;
        const b = (line[s + 1] ?? a) as Point | undefined;
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const si0 = Math.max(i0, Math.ceil((Math.min(a.x, b.x) - radius) / step - 0.5));
        const si1 = Math.min(i1, Math.floor((Math.max(a.x, b.x) + radius) / step - 0.5));
        const sj0 = Math.max(j0, Math.ceil((Math.min(a.y, b.y) - radius) / step - 0.5));
        const sj1 = Math.min(j1, Math.floor((Math.max(a.y, b.y) + radius) / step - 0.5));
        for (let j = sj0; j <= sj1; j++) {
          const y = (j + 0.5) * step;
          for (let i = si0; i <= si1; i++) {
            const x = (i + 0.5) * step;
            const t =
              len2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / len2));
            const ex = x - a.x - dx * t;
            const ey = y - a.y - dy * t;
            const d2 = ex * ex + ey * ey;
            if (d2 > r2) continue;
            const d = a.z + (b.z - a.z) * t + Math.sqrt(r2 - d2);
            const k = (j - j0) * w + (i - i0);
            if (d > (z[k] as number)) z[k] = d;
          }
        }
      }
    }
  }
  return { i0, j0, w, h, z };
}

/**
 * The plane of a fill (Newell's method, through the mean of its points), or
 * undefined when it is seen edge-on and so covers nothing.
 */
function fitPlane(rings: readonly (readonly Point[])[]) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let x0 = 0;
  let y0 = 0;
  let z0 = 0;
  let count = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as Point;
      const b = ring[(i + 1) % ring.length] as Point;
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
      x0 += a.x;
      y0 += a.y;
      z0 += a.z;
      count++;
    }
  }
  const size = Math.hypot(nx, ny, nz);
  if (count < 3 || !(size > 1e-9) || Math.abs(nz) <= size * EDGE_ON) return undefined;
  return { nx, ny, nz, x0: x0 / count, y0: y0 / count, z0: z0 / count };
}

/** Lowercase, no spaces, and #abc spelled #aabbcc, so that one color written two ways compares equal. */
export function normalizeColor(color: string): string {
  const c = color.trim().toLowerCase().replace(/\s+/g, '');
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/.exec(c);
  if (short)
    return `#${short
      .slice(1)
      .map((h) => (h ? h + h : ''))
      .join('')}`;
  return c;
}

/**
 * A round solid in the local frame `surfaceDepth` expects, from two screen
 * points on its axis: for a cylinder the centers of its two ends, for a cone
 * the center of its base and its apex, for a hemisphere the center of its flat
 * face and the top of its dome. Undefined when the solid has no size.
 */
export function solidFrame(
  kind: Surface['kind'],
  base: Point,
  tip: Point,
  radius: number,
): Surface | undefined {
  const ax = tip.x - base.x;
  const ay = tip.y - base.y;
  const az = tip.z - base.z;
  const length = Math.hypot(ax, ay, az);
  if (!(length > 1e-6) || !(radius > 1e-6)) return undefined;
  const w = { x: ax / length, y: ay / length, z: az / length };
  // Any unit vector perpendicular to the axis, and the third one to complete the frame.
  const helper = Math.abs(w.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = normalize(cross(w, helper));
  const v = cross(w, u);
  const c =
    kind === 'cylinder'
      ? { x: (base.x + tip.x) / 2, y: (base.y + tip.y) / 2, z: (base.z + tip.z) / 2 }
      : base;
  const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y + a.z * b.z;
  return {
    kind,
    radius,
    length,
    inverse: [u.x, u.y, u.z, v.x, v.y, v.z, w.x, w.y, w.z, -dot(u, c), -dot(v, c), -dot(w, c)],
  };
}

function cross(a: Point, b: Point): Point {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function normalize(a: Point): Point {
  const n = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / n, y: a.y / n, z: a.z / n };
}

/** What is stored on a sample's score. */
export interface TurnErrors {
  /** The share of covered grid points that are wrong, averaged over the views (0 to 1). */
  mean: number;
  /** The share in the worst view. */
  worst: number;
  /** The turn of the worst view, in degrees from the scene's own view. */
  worstOffsetDeg: number;
  /** Views checked (views that cover nothing are left out). */
  views: number;
  /** Painted elements the checker could not model and left out, summed over the views. */
  excluded: number;
}

/** Sums up the views of one sample. Undefined when no view covers anything. */
export function summarizeViews(
  views: readonly { offsetDeg: number; count: ViewCount; excluded: number }[],
): TurnErrors | undefined {
  const used = views.filter((v) => v.count.covered > 0);
  if (used.length === 0) return undefined;
  let sum = 0;
  let worst = -1;
  let worstOffsetDeg = 0;
  for (const v of used) {
    const share = v.count.wrong / v.count.covered;
    sum += share;
    if (share > worst) {
      worst = share;
      worstOffsetDeg = v.offsetDeg;
    }
  }
  return {
    mean: sum / used.length,
    worst,
    worstOffsetDeg,
    views: used.length,
    excluded: views.reduce((n, v) => n + v.excluded, 0),
  };
}
