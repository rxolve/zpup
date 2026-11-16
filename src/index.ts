export {
  box,
  cone,
  cylinder,
  dot,
  ellipse,
  group,
  hemisphere,
  path,
  polygon,
  rect,
  scene,
} from './build.ts';
export {
  compileScene,
  type DotItem,
  type DrawItem,
  type Frame,
  type PathCommand,
  type PathItem,
} from './compile.ts';
export { type PathSegment, type ValidationIssue, ZpupValidationError } from './errors.ts';
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
  BoxNode,
  ConeNode,
  CylinderNode,
  EllipseNode,
  GroupNode,
  HemisphereNode,
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
  SolidBase,
  VectorInput,
} from './types.ts';
export { checkScene } from './validate.ts';
export { checkSceneWarnings } from './warnings.ts';
