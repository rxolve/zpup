import type { DepthShape } from './depth.ts';
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
