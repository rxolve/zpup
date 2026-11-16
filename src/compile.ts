import { depthOrder } from './depth.ts';
import {
  controlPoints,
  flatten,
  type PathGeometry,
  type Segment,
  splitPath,
  transformGeometry,
} from './geometry.ts';
import { compose, localMatrix, type Matrix, rotationMatrix, strokeScale } from './math.ts';
import type { Scene } from './types.ts';
import { type NormalizedNode, normalizeScene } from './validate.ts';

/** A 2D path command in screen pixels. */
export type PathCommand =
  | { readonly op: 'M'; readonly x: number; readonly y: number }
  | { readonly op: 'L'; readonly x: number; readonly y: number }
  | {
      readonly op: 'C';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly op: 'Z' };

/** A round dot: a single point drawn with a thick stroke. */
export interface DotItem {
  readonly kind: 'dot';
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly color: string;
  /** Depth of the dot's center; larger is closer. */
  readonly depth: number;
  readonly nodeId: string | undefined;
}

/** A stroked and/or filled path. */
export interface PathItem {
  readonly kind: 'path';
  readonly commands: readonly PathCommand[];
  readonly color: string;
  /** Stroke width in pixels; 0 means no outline. Strokes have round caps and joins. */
  readonly stroke: number;
  readonly fill: boolean;
  /** Mean depth of the outline; larger is closer. */
  readonly depth: number;
  readonly nodeId: string | undefined;
}

export type DrawItem = DotItem | PathItem;

/**
 * A renderer-independent, flat description of what to draw: items are already
 * projected to 2D and sorted back to front. Renderers (SVG today, canvas
 * later) only need to paint `items` in order.
 */
export interface Frame {
  readonly width: number;
  readonly height: number;
  readonly background: string | undefined;
  readonly title: string | undefined;
  readonly items: readonly DrawItem[];
}

/** One depth-sorted piece of a shape. Unfilled strokes are split into pieces. */
interface Piece {
  readonly shape: number;
  readonly piece: number;
  readonly pieceCount: number;
  readonly geometry: PathGeometry;
  /** True for the line a closed polyline adds from its last point back to its start. */
  readonly closing: boolean;
  /** Whether the whole shape is closed. */
  readonly shapeClosed: boolean;
  readonly color: string;
  readonly stroke: number;
  readonly fill: boolean;
  readonly nodeId: string | undefined;
}

/**
 * Validates a scene, applies every transform, projects it orthographically
 * and sorts the shapes by depth.
 * @throws {ZpupValidationError} when the scene is invalid.
 */
export function compileScene(scene: Scene): Frame {
  const s = normalizeScene(scene);
  // Screen space: origin at the image center, scaled by zoom, rotated by the view.
  const view = compose(
    [s.zoom, 0, 0, 0, s.zoom, 0, 0, 0, s.zoom, s.width / 2, s.height / 2, 0],
    rotationMatrix(s.rotate),
  );
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
          });
        });
      }
    }
    for (const child of node.children) visit(child, world);
  };
  for (const child of s.children) visit(child, view);

  const flattened = pieces.map((p) => flatten(p.geometry));
  const order = depthOrder(
    pieces.map((p, i) => ({
      points: flattened[i] ?? [],
      closed: p.geometry.closed,
      fill: p.fill,
      radius: p.stroke / 2,
      ...(p.piece > 0 ? { follows: i - 1 } : {}),
    })),
  );

  // Join runs of consecutive pieces of the same shape back into one path.
  const runs: number[][] = [];
  for (const i of order) {
    const p = pieces[i] as Piece;
    const run = runs[runs.length - 1];
    const last = run ? (pieces[run[run.length - 1] as number] as Piece) : undefined;
    if (run && last && last.shape === p.shape && last.piece + 1 === p.piece) run.push(i);
    else runs.push([i]);
  }

  const items: DrawItem[] = [];
  for (const run of runs) {
    const first = pieces[run[0] as number] as Piece;
    const whole = run.length === first.pieceCount;
    const segments: Segment[] = [];
    for (const i of run) {
      const p = pieces[i] as Piece;
      if (!(whole && p.closing)) segments.push(...p.geometry.segments);
    }
    const geometry: PathGeometry = {
      start: first.geometry.start,
      segments,
      closed: whole ? first.shapeClosed : false,
    };
    let depthSum = 0;
    let depthCount = 0;
    for (const i of run) {
      for (const q of flattened[i] ?? []) {
        depthSum += q.z;
        depthCount++;
      }
    }
    const depth = depthSum / Math.max(1, depthCount);
    const all = controlPoints(geometry);
    const start = geometry.start;
    const isDot = all.every(
      (q) => Math.abs(q.x - start.x) < 1e-9 && Math.abs(q.y - start.y) < 1e-9,
    );
    if (isDot) {
      if (first.stroke > 0) {
        items.push({
          kind: 'dot',
          x: start.x,
          y: start.y,
          radius: first.stroke / 2,
          color: first.color,
          depth,
          nodeId: first.nodeId,
        });
      }
      continue;
    }
    items.push({
      kind: 'path',
      commands: toCommands(geometry),
      color: first.color,
      stroke: first.stroke,
      fill: first.fill,
      depth,
      nodeId: first.nodeId,
    });
  }
  return { width: s.width, height: s.height, background: s.background, title: s.title, items };
}

function toCommands(g: PathGeometry): PathCommand[] {
  const commands: PathCommand[] = [{ op: 'M', x: g.start.x, y: g.start.y }];
  for (const seg of g.segments) {
    if (seg.kind === 'line') {
      commands.push({ op: 'L', x: seg.to.x, y: seg.to.y });
    } else {
      commands.push({
        op: 'C',
        x1: seg.c1.x,
        y1: seg.c1.y,
        x2: seg.c2.x,
        y2: seg.c2.y,
        x: seg.to.x,
        y: seg.to.y,
      });
    }
  }
  if (g.closed) commands.push({ op: 'Z' });
  return commands;
}
