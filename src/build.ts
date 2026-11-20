/**
 * Typed helpers for writing scenes in code. Each helper only adds the `type`
 * field and returns a plain object, so `group({ children: [...] })` is exactly
 * `{ type: "group", children: [...] }` and stays JSON-serializable. `type`
 * comes first, so the JSON reads like a hand-written scene.
 */
import type {
  BoxNode,
  ConeNode,
  CylinderNode,
  DotNode,
  EllipseNode,
  GroupNode,
  HemisphereNode,
  PathNode,
  PolygonNode,
  PyramidNode,
  RectNode,
  Scene,
} from './types.ts';

type Options<T extends { type: string }> = Omit<T, 'type'>;

/** `{ type, ...options }`, with `type` first and winning over a `type` in `options`. */
function node<T extends { type: string }>(type: T['type'], options: Options<T>): T {
  const out = { type, ...options } as T;
  out.type = type;
  return out;
}

/** Returns the scene unchanged; it exists for type checking and editor hints. */
export function scene(options: Scene): Scene {
  return options;
}

/** An invisible container that moves, rotates and scales its children together. */
export function group(options: Options<GroupNode> = {}): GroupNode {
  return node('group', options);
}

/** A free-form path: one point for a dot, two for a line, more for a polyline or polygon. */
export function path(options: Options<PathNode>): PathNode {
  return node('path', options);
}

/** A single round dot, drawn like a sphere. Its diameter is `stroke`. */
export function dot(options: Options<DotNode>): DotNode {
  return node('dot', options);
}

/** An ellipse or circle in the local x/y plane. */
export function ellipse(options: Options<EllipseNode>): EllipseNode {
  return node('ellipse', options);
}

/** A rectangle in the local x/y plane. */
export function rect(options: Options<RectNode>): RectNode {
  return node('rect', options);
}

/** A regular polygon in the local x/y plane. */
export function polygon(options: Options<PolygonNode>): PolygonNode {
  return node('polygon', options);
}

/** A box centered on the origin, `width` by `height` by `depth`. */
export function box(options: Options<BoxNode>): BoxNode {
  return node('box', options);
}

/**
 * A pyramid standing on its base at y = 0 with its top at y = -`height`.
 * `ridge` makes the top an edge: as long as `width`, it is a gable roof.
 */
export function pyramid(options: Options<PyramidNode>): PyramidNode {
  return node('pyramid', options);
}

/** A cylinder along the local z axis. `rotate: { x: 90 }` stands it up. */
export function cylinder(options: Options<CylinderNode>): CylinderNode {
  return node('cylinder', options);
}

/**
 * A cone with its base at z = 0 and its tip toward +z. `rotate: { x: 90 }` points it up.
 * `tipDiameter` cuts the tip off: a lamp shade, a pot or a cup.
 */
export function cone(options: Options<ConeNode>): ConeNode {
  return node('cone', options);
}

/** Half a sphere with its dome toward +z. `rotate: { x: 90 }` points it up. */
export function hemisphere(options: Options<HemisphereNode>): HemisphereNode {
  return node('hemisphere', options);
}
