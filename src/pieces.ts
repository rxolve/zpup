import { type DepthShape, depthOrder } from './depth.ts';
import { flatten, type PathGeometry, splitPath, transformGeometry } from './geometry.ts';
import {
  compose,
  IDENTITY,
  localMatrix,
  type Matrix,
  rotationMatrix,
  strokeScale,
  type Vec3,
} from './math.ts';
import { type Surface, solidFaces } from './solids.ts';
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
            layer: 0,
            backfacing: false,
            surface: undefined,
            viewDependent: false,
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
          layer: face.layer,
          backfacing: face.backfacing,
          surface: face.surface,
          viewDependent: face.viewDependent,
        });
      }
    }
    for (const child of node.children) visit(child, world, model);
  };
  const view = viewMatrix(s, rotate);
  for (const child of s.children) visit(child, view, IDENTITY);
  return pieces;
}

/** The pieces the still renderer paints: everything except faces turned away. */
export function visiblePieces(pieces: readonly Piece[]): Piece[] {
  return pieces.filter((p) => !p.backfacing);
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
    ...(p.surface === undefined ? {} : { surface: p.surface }),
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
  // only need to stay behind that solid's other faces.
  const front: number[] = [];
  const back: number[] = [];
  pieces.forEach((p, i) => {
    (p.backfacing ? back : front).push(i);
  });
  const frontOrder = depthOrder(depthShapes(front.map((i) => pieces[i] as Piece))).map(
    (k) => front[k] as number,
  );
  const order = [...back, ...frontOrder];
  const position = positions(order);
  const constraints: [number, number][] = [];
  const bounds = pieces.map(pieceBounds);
  for (let a = 0; a < pieces.length; a++) {
    for (let b = a + 1; b < pieces.length; b++) {
      const pa = pieces[a] as Piece;
      const pb = pieces[b] as Piece;
      const sameSolid = pa.solid !== undefined && pa.solid === pb.solid;
      if (pa.backfacing || pb.backfacing) {
        if (!sameSolid || (pa.backfacing && pb.backfacing)) continue;
      } else if (sameSolid && pa.layer === pb.layer) {
        // Faces of one solid that both face the viewer only share edges.
        continue;
      }
      if (!piecesOverlap(pa, pb, bounds[a], bounds[b])) continue;
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
