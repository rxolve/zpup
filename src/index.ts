export { dot, ellipse, group, path, polygon, rect, scene } from './build.ts';
export {
  compileScene,
  type DotItem,
  type DrawItem,
  type Frame,
  type PathCommand,
  type PathItem,
} from './compile.ts';
export { type ValidationIssue, ZpupValidationError } from './errors.ts';
export {
  add,
  compose,
  cross,
  dot as dotProduct,
  IDENTITY,
  length,
  lerp,
  localMatrix,
  type Matrix,
  multiplyScalar,
  rotate,
  rotationMatrix,
  subtract,
  transformPoint,
  type Vec3,
  vec3,
} from './math.ts';
export { renderSpinSvg, type SpinOptions } from './spin.ts';
export { formatNumber, frameToSvg, renderSvg, type SvgOptions } from './svg.ts';
export type {
  BezierInput,
  EllipseNode,
  GroupNode,
  Node,
  NodeBase,
  NodeType,
  PathNode,
  PathPoint,
  PolygonNode,
  RectNode,
  RotationInput,
  Scene,
  ShapeBase,
  VectorInput,
} from './types.ts';
export { checkScene } from './validate.ts';
