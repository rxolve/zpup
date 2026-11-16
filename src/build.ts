/**
 * Typed helpers for writing scenes in code. Each helper only adds the `type`
 * field and returns a plain object, so `group({ children: [...] })` is exactly
 * `{ type: "group", children: [...] }` and stays JSON-serializable.
 */
import type { EllipseNode, GroupNode, PathNode, PolygonNode, RectNode, Scene } from './types.ts';

type Options<T extends { type: string }> = Omit<T, 'type'>;

/** Returns the scene unchanged; it exists for type checking and editor hints. */
export function scene(options: Scene): Scene {
  return options;
}

/** An invisible container that moves, rotates and scales its children together. */
export function group(options: Options<GroupNode> = {}): GroupNode {
  return { ...options, type: 'group' };
}

/** A free-form path: one point for a dot, two for a line, more for a polyline or polygon. */
export function path(options: Options<PathNode>): PathNode {
  return { ...options, type: 'path' };
}

/** A single round dot, drawn like a sphere. Its diameter is `stroke`. */
export function dot(options: Omit<Options<PathNode>, 'path' | 'fill' | 'closed'>): PathNode {
  return { ...options, type: 'path', path: [{}] };
}

/** An ellipse or circle in the local x/y plane. */
export function ellipse(options: Options<EllipseNode>): EllipseNode {
  return { ...options, type: 'ellipse' };
}

/** A rectangle in the local x/y plane. */
export function rect(options: Options<RectNode>): RectNode {
  return { ...options, type: 'rect' };
}

/** A regular polygon in the local x/y plane. */
export function polygon(options: Options<PolygonNode>): PolygonNode {
  return { ...options, type: 'polygon' };
}
