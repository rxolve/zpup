import { type DepthShape, depthOrder } from './depth.ts';
import {
  controlPoints,
  flatten,
  type PathGeometry,
  splitPath,
  transformGeometry,
} from './geometry.ts';
import {
  compose,
  IDENTITY,
  length,
  localMatrix,
  type Matrix,
  rotationMatrix,
  strokeScale,
  transformNormal,
  type Vec3,
} from './math.ts';
import type { SoftKind } from './shading.ts';
import { type SolidBody, type Surface, solidFaces } from './solids.ts';
import type { NormalizedNode, NormalizedScene, Path } from './validate.ts';

/**
 * One depth-sorted piece of a shape, in screen space. A filled shape is one
 * piece; an unfilled outline is split into one piece per segment (see
 * `splitPath`).
 *
 * For a given scene, the list of pieces has the same length and the same
 * meaning at every view angle: piece `i` at one angle is piece `i` at another.
 * Animation relies on this to identify pieces by index.
 */
export interface Piece {
  /** Index of the shape this piece belongs to, in tree order. */
  readonly shape: number;
  /** Position of this piece within its shape. */
  readonly piece: number;
  readonly pieceCount: number;
  readonly geometry: PathGeometry;
  /** True for the line a closed polyline adds from its last point back to its start. */
  readonly closing: boolean;
  /** Whether the whole shape is closed. */
  readonly shapeClosed: boolean;
  /** The color of the front; see {@link paintedColor} for the color drawn. */
  readonly color: string;
  /** Stroke width in pixels. */
  readonly stroke: number;
  readonly fill: boolean;
  readonly nodeId: string | undefined;
  /** Location of the node in the input, for messages. */
  readonly location: Path;
  /** The outline approximated by straight lines, for depth analysis. */
  readonly points: readonly Vec3[];
  /** For a face of a solid: the index of the solid, in tree order. */
  readonly solid: number | undefined;
  /** For a face of a solid: the solid as a whole (see {@link SolidBody}). */
  readonly body: SolidBody | undefined;
  /** Paint order within a solid: lower first. */
  readonly layer: number;
  /**
   * A face of a solid that is turned away from the viewer. The solid's other
   * faces always cover it, so the still renderer leaves it out; the turning
   * animation keeps it, since it comes into view as the scene turns.
   */
  readonly backfacing: boolean;
  /** For a round surface of a solid: its exact depth, which a plane cannot give. */
  readonly surface: Surface | undefined;
  /** Whether the outline depends on the view angle (round surfaces). */
  readonly viewDependent: boolean;
  /** For a round surface of a solid: how soft shading paints it. Dots are recognized by their shape. */
  readonly soft: SoftKind | undefined;
  /**
   * The `backface` option of a flat shape: true (drawn from both sides),
   * false (left out while turned away) or the color of its back. Always true
   * for faces of solids.
   */
  readonly backface: boolean | string;
  /**
   * For a flat shape: its front normal in screen space, not normalized (the
   * node's local +z, carried through every transform as a surface normal, so
   * that it stays perpendicular to the shape's plane). Undefined for faces of
   * solids.
   */
  readonly normal: Vec3 | undefined;
  /** Whether the front faces the viewer (see {@link facesViewer}). Always true for faces of solids. */
  readonly front: boolean;
  /** A flat shape with `backface: false` whose front faces away: neither painted nor depth-sorted. */
  readonly culled: boolean;
  /**
   * For a shape that lies in its local x/y plane (every ellipse, rect and
   * polygon, and a path whose points all have z = 0): that plane in screen
   * space, through `point` with normal `normal`.
   */
  readonly plane: { readonly point: Vec3; readonly normal: Vec3 } | undefined;
}

/**
 * Whether a front normal in screen space faces the viewer. Exactly edge-on
 * counts as facing away (the shape has no area then), as does a shape
 * flattened to a line by a zero scale, which has no front.
 */
export function facesViewer(normal: Vec3): boolean {
  return normal.z > FACING_EPSILON * length(normal);
}

/** Below this share of its length, a normal's depth component counts as zero. */
export const FACING_EPSILON = 1e-9;

/** The color a piece is painted in: its back color when it shows its back. */
export function paintedColor(p: Piece): string {
  return !p.front && typeof p.backface === 'string' ? p.backface : p.color;
}

/**
 * The transform from scene units to screen space: origin at the image
 * center, scaled by zoom, rotated by `rotate` (normally the scene's view
 * rotation).
 */
export function viewMatrix(s: NormalizedScene, rotate: Vec3 = s.rotate): Matrix {
  return compose(
    [s.zoom, 0, 0, 0, s.zoom, 0, 0, 0, s.zoom, s.width / 2, s.height / 2, 0],
    rotationMatrix(rotate),
  );
}

/**
 * Applies every transform to a validated scene and splits its shapes into
 * pieces, in tree order. Invisible nodes and shapes with neither stroke nor
 * fill produce no pieces, whatever the view angle.
 */
export function compilePieces(s: NormalizedScene, rotate: Vec3 = s.rotate): Piece[] {
  const pieces: Piece[] = [];
  let shapeCount = 0;
  let solidCount = 0;
  const visit = (node: NormalizedNode, parent: Matrix, parentModel: Matrix) => {
    if (!node.visible) return;
    const local = localMatrix(node.translate, node.rotate, node.scale);
    const world = compose(parent, local);
    const model = compose(parentModel, local);
    const base = { nodeId: node.id, location: node.location };
    if (node.shape) {
      const { color, fill, backface } = node.shape;
      const stroke = node.shape.stroke * strokeScale(world);
      const geometry = transformGeometry(world, node.shape.geometry);
      // The front is the side the local +z axis points to. As a normal, it
      // stays perpendicular to the plane under any scale, so it turns
      // edge-on exactly when the shape does; a mirroring scale keeps its sign
      // (only a negative z scale moves the front to the other side).
      const normal = transformNormal(world, LOCAL_Z);
      const front = facesViewer(normal);
      const plane = controlPoints(node.shape.geometry).every((q) => q.z === 0)
        ? { point: { x: world[9], y: world[10], z: world[11] }, normal }
        : undefined;
      if (stroke > 0 || fill) {
        const shape = shapeCount++;
        // A filled shape is one flat sheet. An outline can pass in front of
        // one thing and behind another, so each of its segments is sorted
        // on its own and adjacent pieces are joined again when drawn.
        const split = fill ? [{ geometry, closing: false }] : splitPath(geometry);
        split.forEach((part, piece) => {
          pieces.push({
            ...base,
            shape,
            piece,
            pieceCount: split.length,
            geometry: part.geometry,
            closing: part.closing,
            shapeClosed: geometry.closed,
            color,
            stroke,
            fill,
            points: flatten(part.geometry),
            solid: undefined,
            body: undefined,
            layer: 0,
            backfacing: false,
            surface: undefined,
            viewDependent: false,
            soft: undefined,
            backface,
            normal,
            front,
            culled: backface === false && !front,
            plane,
          });
        });
      }
    }
    if (node.solid) {
      const solid = solidCount++;
      const stroke = node.solid.stroke * strokeScale(world);
      for (const face of solidFaces(node.solid, world, model)) {
        pieces.push({
          ...base,
          shape: shapeCount++,
          piece: 0,
          pieceCount: 1,
          geometry: face.geometry,
          closing: false,
          shapeClosed: true,
          color: face.color,
          stroke,
          fill: true,
          points: flatten(face.geometry),
          solid,
          body: face.body,
          layer: face.layer,
          backfacing: face.backfacing,
          surface: face.surface,
          viewDependent: face.viewDependent,
          soft: face.soft,
          backface: true,
          normal: undefined,
          front: true,
          culled: false,
          plane: undefined,
        });
      }
    }
    for (const child of node.children) visit(child, world, model);
  };
  const view = viewMatrix(s, rotate);
  for (const child of s.children) visit(child, view, IDENTITY);
  return pieces;
}

const LOCAL_Z: Vec3 = { x: 0, y: 0, z: 1 };

/**
 * The pieces the still renderer paints: everything except faces of solids
 * turned away and flat shapes with `backface: false` turned away.
 */
export function visiblePieces(pieces: readonly Piece[]): Piece[] {
  return pieces.filter((p) => !p.backfacing && !p.culled);
}

/** The input the depth sorter needs for each piece, in the same order. */
export function depthShapes(pieces: readonly Piece[]): DepthShape[] {
  return pieces.map((p, i) => ({
    points: p.points,
    closed: p.geometry.closed,
    fill: p.fill,
    radius: p.stroke / 2,
    ...(p.piece > 0 ? { follows: i - 1 } : {}),
    ...(p.solid === undefined ? {} : { solid: p.solid, layer: p.layer }),
    ...(p.body === undefined ? {} : { body: p.body }),
    ...(p.surface === undefined ? {} : { surface: p.surface }),
    ...(p.plane === undefined ? {} : { plane: p.plane }),
  }));
}

/**
 * Paint order of `pieces` as the still renderer would choose it, and the
 * "paint `a` before `b`" pairs it implies for every two pieces that overlap
 * on screen. Pieces that do not overlap can go in any order.
 */
export function paintConstraints(pieces: readonly Piece[]): {
  order: number[];
  constraints: [number, number][];
} {
  // Faces turned away go first. Their own solid always covers them, so they
  // only need to stay behind that solid's other faces. Culled pieces are not
  // drawn at all; they go first only so that the order lists every piece.
  const front: number[] = [];
  const back: number[] = [];
  const culled: number[] = [];
  pieces.forEach((p, i) => {
    (p.culled ? culled : p.backfacing ? back : front).push(i);
  });
  const bounds = pieces.map(pieceBounds);
  const outlines = pieces.map(outline);
  // Whether two pieces overlap is asked twice for the same pairs: by the
  // sorter, which then skips pairs that cannot meet, and for the constraints.
  const n = pieces.length;
  const known = new Int8Array(n * n);
  const overlap = (a: number, b: number): boolean => {
    const key = a < b ? a * n + b : b * n + a;
    if (known[key] === 0) {
      const yes = piecesOverlap(
        pieces[a] as Piece,
        pieces[b] as Piece,
        bounds[a],
        bounds[b],
        outlines[a],
        outlines[b],
      );
      known[key] = yes ? 1 : -1;
    }
    return known[key] === 1;
  };
  const frontOrder = depthOrder(depthShapes(front.map((i) => pieces[i] as Piece)), (i, j) =>
    overlap(front[i] as number, front[j] as number),
  ).map((k) => front[k] as number);
  const order = [...culled, ...back, ...frontOrder];
  const position = positions(order);
  const constraints: [number, number][] = [];
  for (let a = 0; a < pieces.length; a++) {
    for (let b = a + 1; b < pieces.length; b++) {
      const pa = pieces[a] as Piece;
      const pb = pieces[b] as Piece;
      if (pa.culled || pb.culled) continue;
      const sameSolid = pa.solid !== undefined && pa.solid === pb.solid;
      if (pa.backfacing || pb.backfacing) {
        if (!sameSolid || (pa.backfacing && pb.backfacing)) continue;
      } else if (sameSolid && pa.layer === pb.layer) {
        // Faces of one solid that both face the viewer only share edges.
        continue;
      }
      if (!overlap(a, b)) continue;
      constraints.push((position[a] as number) < (position[b] as number) ? [a, b] : [b, a]);
    }
  }
  return { order, constraints };
}

interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Extra reach, in pixels, so that shapes that touch through antialiasing count as overlapping. */
const OVERLAP_SLACK = 0.5;

function pieceBounds(p: Piece): Bounds {
  const pad = p.stroke / 2 + OVERLAP_SLACK;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const q of p.points) {
    minX = Math.min(minX, q.x);
    maxX = Math.max(maxX, q.x);
    minY = Math.min(minY, q.y);
    maxY = Math.max(maxY, q.y);
  }
  return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
}

/**
 * Whether two pieces may cover a common pixel on screen. Errs on the side of
 * "yes": a false positive only adds a constraint the sorter already meets.
 */
export function piecesOverlap(
  a: Piece,
  b: Piece,
  ba: Bounds = pieceBounds(a),
  bb: Bounds = pieceBounds(b),
  oa: readonly Segment2[] = outline(a),
  ob: readonly Segment2[] = outline(b),
): boolean {
  if (ba.maxX < bb.minX || bb.maxX < ba.minX || ba.maxY < bb.minY || bb.maxY < ba.minY) {
    return false;
  }
  const reach = a.stroke / 2 + b.stroke / 2 + OVERLAP_SLACK;
  // Only points and segments inside the other piece's bounds can meet it.
  // The bounds already reach out by that piece's own stroke and the slack,
  // so they are widened by the rest of `reach`, and a little more for
  // rounding.
  const wa = widen(ba, b.stroke / 2 + BOUNDS_MARGIN);
  const wb = widen(bb, a.stroke / 2 + BOUNDS_MARGIN);
  const sa = oa.filter((s) => segmentMeets(s, wb));
  const sb = ob.filter((s) => segmentMeets(s, wa));
  for (const p of a.points) {
    if (!contains(wb, p)) continue;
    for (const [q, r] of sb) if (distanceToSegment(p, q, r) <= reach) return true;
  }
  for (const p of b.points) {
    if (!contains(wa, p)) continue;
    for (const [q, r] of sa) if (distanceToSegment(p, q, r) <= reach) return true;
  }
  for (const [p, q] of sa) for (const [r, t] of sb) if (segmentsCross(p, q, r, t)) return true;
  if (a.fill && b.points.some((p) => contains(ba, p) && insidePolygon(a.points, p))) return true;
  if (b.fill && a.points.some((p) => contains(bb, p) && insidePolygon(b.points, p))) return true;
  return false;
}

/** Rounding allowance for the bounds tests in {@link piecesOverlap}. */
const BOUNDS_MARGIN = 1e-6;

function widen(b: Bounds, by: number): Bounds {
  return { minX: b.minX - by, maxX: b.maxX + by, minY: b.minY - by, maxY: b.maxY + by };
}

function contains(b: Bounds, p: Vec3): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

function segmentMeets([p, q]: Segment2, b: Bounds): boolean {
  return (
    Math.max(p.x, q.x) >= b.minX &&
    Math.min(p.x, q.x) <= b.maxX &&
    Math.max(p.y, q.y) >= b.minY &&
    Math.min(p.y, q.y) <= b.maxY
  );
}

type Segment2 = readonly [Vec3, Vec3];

function outline(p: Piece): Segment2[] {
  const { points } = p;
  const segments: Segment2[] = [];
  for (let i = 0; i + 1 < points.length; i++)
    segments.push([points[i] as Vec3, points[i + 1] as Vec3]);
  if ((p.fill || p.geometry.closed) && points.length > 2) {
    segments.push([points[points.length - 1] as Vec3, points[0] as Vec3]);
  }
  if (points.length === 1) segments.push([points[0] as Vec3, points[0] as Vec3]);
  return segments;
}

function distanceToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function segmentsCross(a: Vec3, b: Vec3, c: Vec3, d: Vec3): boolean {
  const side = (p: Vec3, q: Vec3, r: Vec3) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = side(c, d, a);
  const d2 = side(c, d, b);
  const d3 = side(a, b, c);
  const d4 = side(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function insidePolygon(points: readonly Vec3[], p: Vec3): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i] as Vec3;
    const b = points[j] as Vec3;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function positions(order: readonly number[]): number[] {
  const position: number[] = [];
  order.forEach((piece, n) => {
    position[piece] = n;
  });
  return position;
}
