import { depthOrder } from './depth.ts';
import { controlPoints, type PathGeometry, type Segment } from './geometry.ts';
import type { Vec3 } from './math.ts';
import { compilePieces, depthShapes, type Piece, paintedColor, visiblePieces } from './pieces.ts';
import type { Scene } from './types.ts';
import { type NormalizedScene, normalizeScene } from './validate.ts';

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

/**
 * Validates a scene, applies every transform, projects it orthographically
 * and sorts the shapes by depth.
 * @throws {ZpupValidationError} when the scene is invalid.
 */
export function compileScene(scene: Scene): Frame {
  return compileNormalized(normalizeScene(scene));
}

/** {@link compileScene} for a scene that is already validated. */
export function compileNormalized(s: NormalizedScene, rotate: Vec3 = s.rotate): Frame {
  const pieces = visiblePieces(compilePieces(s, rotate));
  const order = depthOrder(depthShapes(pieces));
  return {
    width: s.width,
    height: s.height,
    background: s.background,
    title: s.title,
    items: joinPieces(pieces, order),
  };
}

/**
 * Turns pieces painted in `order` into draw items, joining runs of
 * consecutive pieces of the same shape back into one path.
 */
export function joinPieces(pieces: readonly Piece[], order: readonly number[]): DrawItem[] {
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
      for (const q of (pieces[i] as Piece).points) {
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
          color: paintedColor(first),
          depth,
          nodeId: first.nodeId,
        });
      }
      continue;
    }
    items.push({
      kind: 'path',
      commands: toCommands(geometry),
      color: paintedColor(first),
      stroke: first.stroke,
      fill: first.fill,
      depth,
      nodeId: first.nodeId,
    });
  }
  return items;
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
