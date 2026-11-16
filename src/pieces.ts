import { type DepthShape, depthOrder } from './depth.ts';
import { flatten, type PathGeometry, splitPath, transformGeometry } from './geometry.ts';
import {
  compose,
  localMatrix,
  type Matrix,
  rotationMatrix,
  strokeScale,
  type Vec3,
} from './math.ts';
import type { NormalizedNode, NormalizedScene } from './validate.ts';

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
  readonly color: string;
  /** Stroke width in pixels. */
  readonly stroke: number;
  readonly fill: boolean;
  readonly nodeId: string | undefined;
  /** The outline approximated by straight lines, for depth analysis. */
  readonly points: readonly Vec3[];
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
  const visit = (node: NormalizedNode, parent: Matrix) => {
    if (!node.visible) return;
    const world = compose(parent, localMatrix(node.translate, node.rotate, node.scale));
    if (node.shape) {
      const { color, fill } = node.shape;
      const stroke = node.shape.stroke * strokeScale(world);
      const geometry = transformGeometry(world, node.shape.geometry);
      if (stroke > 0 || fill) {
        const shape = shapeCount++;
        // A filled shape is one flat sheet. An outline can pass in front of
        // one thing and behind another, so each of its segments is sorted
        // on its own and adjacent pieces are joined again when drawn.
        const split = fill ? [{ geometry, closing: false }] : splitPath(geometry);
        split.forEach((part, piece) => {
          pieces.push({
            shape,
            piece,
            pieceCount: split.length,
            geometry: part.geometry,
            closing: part.closing,
            shapeClosed: geometry.closed,
            color,
            stroke,
            fill,
            nodeId: node.id,
            points: flatten(part.geometry),
          });
        });
      }
    }
    for (const child of node.children) visit(child, world);
  };
  for (const child of s.children) visit(child, viewMatrix(s, rotate));
  return pieces;
}

/** The input the depth sorter needs for each piece, in the same order. */
export function depthShapes(pieces: readonly Piece[]): DepthShape[] {
  return pieces.map((p, i) => ({
    points: p.points,
    closed: p.geometry.closed,
    fill: p.fill,
    radius: p.stroke / 2,
    ...(p.piece > 0 ? { follows: i - 1 } : {}),
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
  const order = depthOrder(depthShapes(pieces));
  const position = positions(order);
  const constraints: [number, number][] = [];
  const bounds = pieces.map(pieceBounds);
  for (let a = 0; a < pieces.length; a++) {
    for (let b = a + 1; b < pieces.length; b++) {
      if (!piecesOverlap(pieces[a] as Piece, pieces[b] as Piece, bounds[a], bounds[b])) continue;
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
): boolean {
  if (ba.maxX < bb.minX || bb.maxX < ba.minX || ba.maxY < bb.minY || bb.maxY < ba.minY) {
    return false;
  }
  const reach = a.stroke / 2 + b.stroke / 2 + OVERLAP_SLACK;
  const sa = outline(a);
  const sb = outline(b);
  for (const p of a.points)
    for (const [q, r] of sb) if (distanceToSegment(p, q, r) <= reach) return true;
  for (const p of b.points)
    for (const [q, r] of sa) if (distanceToSegment(p, q, r) <= reach) return true;
  for (const [p, q] of sa) for (const [r, t] of sb) if (segmentsCross(p, q, r, t)) return true;
  if (a.fill && b.points.some((p) => insidePolygon(a.points, p))) return true;
  if (b.fill && a.points.some((p) => insidePolygon(b.points, p))) return true;
  return false;
}

function outline(p: Piece): [Vec3, Vec3][] {
  const { points } = p;
  const segments: [Vec3, Vec3][] = [];
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
