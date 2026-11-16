import { colorNames, isColorName } from './color.ts';
import {
  closest,
  describe,
  makeIssue,
  type PathSegment,
  type ValidationIssue,
  ZpupValidationError,
} from './errors.ts';
import {
  ellipseGeometry,
  type PathGeometry,
  polygonGeometry,
  rectGeometry,
  type Segment,
} from './geometry.ts';
import type { Vec3 } from './math.ts';
import { FACE_KEYS, type NormalizedSolid, type SolidKind } from './solids.ts';
import type { NodeType, Scene } from './types.ts';

/** A location in the input: object keys and array indices from the root. */
export type Path = readonly PathSegment[];

/** A node after validation, with every default filled in. */
export interface NormalizedNode {
  readonly type: NodeType;
  readonly id: string | undefined;
  /** Location in the input, for messages, such as `["scene", "children", 0]`. */
  readonly location: Path;
  readonly translate: Vec3;
  readonly rotate: Vec3;
  readonly scale: Vec3;
  readonly visible: boolean;
  readonly children: readonly NormalizedNode[];
  /** Drawing options of a flat shape; undefined for groups and solids. */
  readonly shape: NormalizedShape | undefined;
  /** Drawing options of a solid; undefined for everything else. */
  readonly solid: NormalizedSolid | undefined;
}

export interface NormalizedShape {
  readonly geometry: PathGeometry;
  readonly color: string;
  readonly stroke: number;
  readonly fill: boolean;
}

export interface NormalizedScene {
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
  readonly background: string | undefined;
  readonly title: string | undefined;
  readonly rotate: Vec3;
  readonly children: readonly NormalizedNode[];
}

const NODE_TYPES: readonly NodeType[] = [
  'group',
  'path',
  'ellipse',
  'rect',
  'polygon',
  'box',
  'cylinder',
  'cone',
  'hemisphere',
];
const SOLID_TYPES: readonly SolidKind[] = ['box', 'cylinder', 'cone', 'hemisphere'];

function isSolid(type: NodeType): type is SolidKind {
  return (SOLID_TYPES as readonly string[]).includes(type);
}

/**
 * Names other tools use for node types. A `direct` alias takes the same
 * options, so the rest of the node is checked as that type; otherwise the
 * node has to be written differently and only the options every node shares
 * are checked.
 */
interface TypeAlias {
  readonly type?: NodeType;
  readonly direct: boolean;
  readonly hint: string;
}

const DOT = '{ "type": "path", "path": [{}], "stroke": 20 }';
const polygonOf = (sides: number): TypeAlias => ({
  type: 'polygon',
  direct: false,
  hint: `Use { "type": "polygon", "sides": ${sides}, "radius": 20 }.`,
});
const TYPE_ALIASES: Readonly<Record<string, TypeAlias>> = {
  anchor: { type: 'group', direct: true, hint: 'Zdog\'s Anchor is a "group".' },
  g: { type: 'group', direct: true, hint: 'SVG\'s <g> is a "group".' },
  container: { type: 'group', direct: true, hint: 'A "group" holds other nodes.' },
  circle: {
    type: 'ellipse',
    direct: true,
    hint: 'A circle is an "ellipse" with "diameter", e.g. { "type": "ellipse", "diameter": 40 }.',
  },
  oval: { type: 'ellipse', direct: true, hint: 'Give it a "width" and a "height".' },
  disc: {
    type: 'ellipse',
    direct: true,
    hint: 'A disc is a filled "ellipse": { "type": "ellipse", "diameter": 40, "fill": true }.',
  },
  disk: {
    type: 'ellipse',
    direct: true,
    hint: 'A disc is a filled "ellipse": { "type": "ellipse", "diameter": 40, "fill": true }.',
  },
  ring: {
    type: 'ellipse',
    direct: false,
    hint: 'For a ring use an unfilled "ellipse" with a thick stroke: { "type": "ellipse", "diameter": 60, "stroke": 8 }.',
  },
  torus: {
    type: 'ellipse',
    direct: false,
    hint: 'For a ring use an unfilled "ellipse" with a thick stroke: { "type": "ellipse", "diameter": 60, "stroke": 8 }.',
  },
  sphere: {
    type: 'path',
    direct: false,
    hint: `For a sphere use a dot: ${DOT} (the stroke is its diameter). For half a sphere use "hemisphere".`,
  },
  ball: {
    type: 'path',
    direct: false,
    hint: `For a ball use a dot: ${DOT} (the stroke is its diameter).`,
  },
  dot: { type: 'path', direct: false, hint: `For a dot use ${DOT}.` },
  point: { type: 'path', direct: false, hint: `For a dot use ${DOT}.` },
  line: {
    type: 'path',
    direct: false,
    hint: 'For a line use { "type": "path", "path": [{ "x": -20 }, { "x": 20 }] }.',
  },
  segment: {
    type: 'path',
    direct: false,
    hint: 'For a line use { "type": "path", "path": [{ "x": -20 }, { "x": 20 }] }.',
  },
  polyline: { type: 'path', direct: true, hint: 'List the points in "path".' },
  shape: { type: 'path', direct: true, hint: 'Zdog\'s Shape is a "path".' },
  curve: {
    type: 'path',
    direct: false,
    hint: 'Use a "path" with a { "bezier": [control1, control2, end] } entry.',
  },
  arc: {
    type: 'path',
    direct: false,
    hint: 'Use a "path" with a { "bezier": [control1, control2, end] } entry.',
  },
  capsule: {
    type: 'path',
    direct: false,
    hint: 'For a capsule use a two-point "path" with a thick stroke: { "type": "path", "path": [{ "y": -20 }, { "y": 20 }], "stroke": 16 }.',
  },
  square: { type: 'rect', direct: true, hint: 'Give it a "width" and a "height".' },
  rectangle: { type: 'rect', direct: true, hint: 'Give it a "width" and a "height".' },
  plane: { type: 'rect', direct: true, hint: 'Give it a "width" and a "height".' },
  roundedrect: {
    type: 'rect',
    direct: true,
    hint: 'A thick "stroke" rounds its corners.',
  },
  triangle: {
    type: 'polygon',
    direct: false,
    hint: 'For a triangle use { "type": "polygon", "sides": 3, "radius": 20 }, or a closed "path" with three points and "fill": true.',
  },
  pentagon: polygonOf(5),
  hexagon: polygonOf(6),
  octagon: polygonOf(8),
  cube: {
    type: 'box',
    direct: true,
    hint: 'Give it a "width", "height" and "depth", e.g. { "type": "box", "width": 40, "height": 40, "depth": 40 }.',
  },
  cuboid: { type: 'box', direct: true, hint: 'Give it a "width", "height" and "depth".' },
  block: { type: 'box', direct: true, hint: 'Give it a "width", "height" and "depth".' },
  tube: {
    type: 'cylinder',
    direct: true,
    hint: 'Give it a "diameter" and a "length".',
  },
  dome: { type: 'hemisphere', direct: true, hint: 'Give it a "diameter".' },
  halfsphere: { type: 'hemisphere', direct: true, hint: 'Give it a "diameter".' },
  pyramid: {
    type: 'cone',
    direct: false,
    hint: 'There is no pyramid. Use a "cone", or build the sides from closed, filled "path" nodes.',
  },
  text: {
    direct: false,
    hint: 'zpup draws no text; build letters from "path" nodes or leave them out.',
  },
  image: { direct: false, hint: 'zpup draws no images; build the picture from shapes.' },
};

const NODE_KEYS = ['type', 'id', 'translate', 'rotate', 'scale', 'visible', 'children'] as const;
const SHAPE_KEYS = ['color', 'stroke', 'fill'] as const;
const SOLID_KEYS = [...NODE_KEYS, ...SHAPE_KEYS, 'shade'];
const KEYS_BY_TYPE: Readonly<Record<NodeType, readonly string[]>> = {
  group: NODE_KEYS,
  path: [...NODE_KEYS, ...SHAPE_KEYS, 'path', 'closed'],
  ellipse: [...NODE_KEYS, ...SHAPE_KEYS, 'diameter', 'width', 'height'],
  rect: [...NODE_KEYS, ...SHAPE_KEYS, 'width', 'height'],
  polygon: [...NODE_KEYS, ...SHAPE_KEYS, 'sides', 'radius'],
  box: [...SOLID_KEYS, 'width', 'height', 'depth', ...FACE_KEYS.box],
  cylinder: [...SOLID_KEYS, 'diameter', 'length', ...FACE_KEYS.cylinder],
  cone: [...SOLID_KEYS, 'diameter', 'length', ...FACE_KEYS.cone],
  hemisphere: [...SOLID_KEYS, 'diameter', ...FACE_KEYS.hemisphere],
};
const ALL_NODE_KEYS = [...new Set(NODE_TYPES.flatMap((t) => KEYS_BY_TYPE[t]))];
const SCENE_KEYS = ['width', 'height', 'zoom', 'background', 'title', 'rotate', 'children'];

/** Well-known aliases for option names. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  colour: 'color',
  fillColor: 'color',
  strokeWidth: 'stroke',
  lineWidth: 'stroke',
  position: 'translate',
  rotation: 'rotate',
  points: 'path',
  radius: 'diameter',
  size: 'diameter',
};

const DEFAULT_COLOR = '#333';
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const ONE: Vec3 = { x: 1, y: 1, z: 1 };

export class Checker {
  readonly issues: ValidationIssue[] = [];
  private readonly seen = new Set<object>();

  report(
    path: Path,
    nodeId: string | undefined,
    expected: string,
    value: unknown,
    hint?: string,
    unknownKey?: string,
  ): void {
    const received = unknownKey === undefined ? describe(value) : `unknown option "${unknownKey}"`;
    const tail = hint ? ` ${hint}` : '';
    const detail =
      unknownKey === undefined
        ? `expected ${expected}, received ${received}.${tail}`
        : `unknown option "${unknownKey}".${tail} Allowed: ${expected}.`;
    this.issues.push(makeIssue({ pathSegments: path, nodeId, expected, received, hint, detail }));
  }

  /** Like {@link report}, with `received` already written out as text. */
  note(
    path: Path,
    nodeId: string | undefined,
    expected: string,
    received: string,
    hint: string,
  ): void {
    const detail = `expected ${expected}, received ${received}. ${hint}`;
    this.issues.push(makeIssue({ pathSegments: path, nodeId, expected, received, hint, detail }));
  }

  /** Guards against the same object appearing twice (which includes cycles). */
  enter(value: object, path: Path, nodeId: string | undefined): boolean {
    if (this.seen.has(value)) {
      this.report(
        path,
        nodeId,
        'a node that appears only once in the tree',
        '(the same object again)',
        'Nodes cannot be shared or nested inside themselves; create a copy instead.',
      );
      return false;
    }
    this.seen.add(value);
    return true;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const COLOR_PATTERNS = [
  /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
  /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([0-9a-z.,%/+\-\s]*\)$/i,
];

function isColor(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return isColorName(text) || COLOR_PATTERNS.some((re) => re.test(text));
}

/** A hint for a word that is not a CSS color name, such as "blu". */
function colorNameHint(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^[a-z]+$/i.test(value.trim())) return undefined;
  const guess = closest(value.trim(), colorNames());
  return guess
    ? `Did you mean "${guess}"?`
    : `"${value.trim()}" is not a CSS color name. Use a name such as "tomato" or a hex color such as "#e62".`;
}

function numberHint(value: unknown, example: string): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== '' && Number.isFinite(Number(trimmed))) return `Remove the quotes: ${trimmed}.`;
    if (/^-?[\d.]+\s*[a-z%]+$/i.test(trimmed)) {
      return `Use a plain number in scene units without a unit suffix, e.g. ${parseFloat(trimmed)}.`;
    }
  }
  return `For example ${example}.`;
}

function readNumber(
  c: Checker,
  obj: Record<string, unknown>,
  key: string,
  path: Path,
  nodeId: string | undefined,
  rule: {
    min?: number;
    exclusiveMin?: boolean;
    integer?: boolean;
    example: string;
    hint?: (value: unknown) => string | undefined;
  },
): number | undefined {
  const value = obj[key];
  const where = [...path, key];
  let expected = rule.integer ? 'an integer' : 'a number';
  if (rule.min !== undefined)
    expected += rule.exclusiveMin ? ` greater than ${rule.min}` : ` of at least ${rule.min}`;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    c.report(where, nodeId, expected, value, rule.hint?.(value) ?? numberHint(value, rule.example));
    return undefined;
  }
  const tooSmall =
    rule.min !== undefined && (rule.exclusiveMin ? value <= rule.min : value < rule.min);
  if (tooSmall || (rule.integer && !Number.isInteger(value))) {
    c.report(where, nodeId, expected, value, `For example ${rule.example}.`);
    return undefined;
  }
  return value;
}

function readVector(
  c: Checker,
  value: unknown,
  path: Path,
  nodeId: string | undefined,
  example: string,
): Vec3 | undefined {
  if (!isPlainObject(value)) {
    let hint = `Write an object such as ${example}; missing components default to 0.`;
    if (Array.isArray(value)) hint = `Arrays are not accepted. Write ${example} instead.`;
    else if (typeof value === 'number')
      hint = `Write ${example}; a single number is not accepted here.`;
    c.report(path, nodeId, 'an object with optional numeric x, y and z', value, hint);
    return undefined;
  }
  let ok = true;
  for (const key of Object.keys(value)) {
    if (key !== 'x' && key !== 'y' && key !== 'z') {
      const guess = closest(key, ['x', 'y', 'z']);
      c.report(
        [...path, key],
        nodeId,
        '"x", "y", "z"',
        undefined,
        guess ? `Did you mean "${guess}"?` : 'Remove this key.',
        key,
      );
      ok = false;
    }
  }
  const out = { x: 0, y: 0, z: 0 };
  for (const axis of ['x', 'y', 'z'] as const) {
    const component = value[axis];
    if (component === undefined) continue;
    if (typeof component !== 'number' || !Number.isFinite(component)) {
      c.report([...path, axis], nodeId, 'a finite number', component, numberHint(component, '10'));
      ok = false;
    } else {
      out[axis] = component;
    }
  }
  return ok ? out : undefined;
}

function readBoolean(
  c: Checker,
  obj: Record<string, unknown>,
  key: string,
  path: Path,
  nodeId: string | undefined,
  fallback: boolean,
): boolean {
  const value = obj[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    const hint = value === 'true' || value === 'false' ? `Remove the quotes: ${value}.` : undefined;
    c.report([...path, key], nodeId, 'true or false', value, hint);
    return fallback;
  }
  return value;
}

function readColor(
  c: Checker,
  obj: Record<string, unknown>,
  key: string,
  path: Path,
  nodeId: string | undefined,
): string | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (!isColor(value)) {
    c.report(
      [...path, key],
      nodeId,
      'a CSS color string such as "#e62", "rgb(230, 100, 30)" or "tomato"',
      value,
      colorNameHint(value),
    );
    return undefined;
  }
  return value.trim();
}

/** Reads `fill`, which takes true or false; colors belong in `color`. */
function readFill(
  c: Checker,
  obj: Record<string, unknown>,
  path: Path,
  nodeId: string | undefined,
  solid: boolean,
): boolean {
  const value = obj.fill;
  const where = [...path, 'fill'];
  if (value === undefined) return solid;
  if (solid) {
    if (value !== true) {
      c.report(
        where,
        nodeId,
        'true (solids are always filled)',
        value,
        isColor(value)
          ? 'Colors go in "color", e.g. "color": "#e62". Remove "fill".'
          : 'Remove "fill"; for an outline only, use "path", "ellipse", "rect" or "polygon".',
      );
    }
    return true;
  }
  if (typeof value === 'boolean') return value;
  let hint: string | undefined;
  if (value === 'true' || value === 'false') hint = `Remove the quotes: ${value}.`;
  else if (value === 'none' || value === 'transparent' || value === '')
    hint = 'Use false, or leave "fill" out, for no fill.';
  else if (isColor(value))
    hint = `"fill" only switches filling on; the fill color is "color". Write "color": "${value.trim()}", "fill": true.`;
  c.report(where, nodeId, 'true or false', value, hint);
  return false;
}

/** Hint for a `stroke` that is not a number: it is a width, and its color is `color`. */
function strokeHint(value: unknown): string | undefined {
  if (value === 'none' || value === false) return 'Use 0 for no outline.';
  if (value === true) return 'Use a width in scene units, e.g. 2.';
  if (typeof value === 'string' && Number.isNaN(Number.parseFloat(value)) && isColor(value)) {
    return `"stroke" is the outline width in scene units; its color is "color". Write "stroke": 2, "color": "${value.trim()}".`;
  }
  return undefined;
}

function checkKeys(
  c: Checker,
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: Path,
  nodeId: string | undefined,
  owner: string,
  type?: NodeType,
): void {
  for (const key of Object.keys(obj)) {
    if (allowed.includes(key)) continue;
    let hint: string;
    const alias = KEY_ALIASES[key];
    const guess = alias && allowed.includes(alias) ? alias : closest(key, allowed);
    const otherTypes = NODE_TYPES.filter((t) => KEYS_BY_TYPE[t].includes(key));
    const special = type === undefined ? undefined : keyHint(type, key);
    if (type === 'group' && (SHAPE_KEYS as readonly string[]).includes(key)) {
      hint = `Groups draw nothing; set "${key}" on the shapes inside the group.`;
    } else if (special) {
      hint = special;
    } else if (guess) {
      hint = `Did you mean "${guess}"?`;
    } else if (otherTypes.length > 0 && owner !== 'the scene') {
      hint = `"${key}" is an option of ${otherTypes.map((t) => `"${t}"`).join(', ')} nodes.`;
    } else {
      hint = 'Remove this option.';
    }
    c.report(
      [...path, key],
      nodeId,
      `${allowed.map((k) => `"${k}"`).join(', ')} (options of ${owner})`,
      undefined,
      hint,
      key,
    );
  }
}

/** Hints for options that are easy to get wrong on a particular node type. */
function keyHint(type: NodeType, key: string): string | undefined {
  const round = type === 'cylinder' || type === 'cone' || type === 'hemisphere';
  if (key === 'radius' && (type === 'ellipse' || round))
    return 'Use "diameter" (twice the radius).';
  if ((type === 'cylinder' || type === 'cone') && (key === 'height' || key === 'depth')) {
    return 'Use "length", the size along the local z axis. Add "rotate": { "x": 90 } to stand it up.';
  }
  if (type === 'hemisphere' && (key === 'height' || key === 'length')) {
    return 'A hemisphere is as tall as its radius; set only "diameter".';
  }
  if (type === 'box' && (key === 'size' || key === 'diameter' || key === 'length')) {
    return 'Use "width", "height" and "depth".';
  }
  if (type === 'cylinder' && key.endsWith('Face') && key !== 'frontFace') {
    return 'A cylinder\'s ends are "frontFace" (+z) and "backface" (-z); with "rotate": { "x": 90 } the frontFace is on top. The side uses "color".';
  }
  if ((type === 'cone' || type === 'hemisphere') && /face$/i.test(key) && key !== 'backface') {
    return `The flat side of a ${type} is "backface"; the round surface uses "color".`;
  }
  if (isSolid(type) && /^(fill|stroke|side|top|front)(Color|Colour)$/i.test(key)) {
    return 'Use "color" for the whole solid, or a face option such as "frontFace" for one face.';
  }
  return undefined;
}

function readChildren(
  c: Checker,
  value: unknown,
  path: Path,
  nodeId: string | undefined,
): NormalizedNode[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    c.report(path, nodeId, 'an array of nodes', value, 'Wrap a single node in an array: [node].');
    return [];
  }
  const out: NormalizedNode[] = [];
  value.forEach((child, i) => {
    const node = readNode(c, child, [...path, i]);
    if (node) out.push(node);
  });
  return out;
}

function readPath(
  c: Checker,
  value: unknown,
  path: Path,
  nodeId: string | undefined,
  closed: boolean,
): PathGeometry | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    c.report(
      path,
      nodeId,
      'a non-empty array of points',
      value,
      'For example [{ "x": -10 }, { "x": 10 }] for a line, or [{}] for a dot at the origin.',
    );
    return undefined;
  }
  const example = '{ "x": 0, "y": 0, "z": 0 }';
  let start: Vec3 | undefined;
  const segments: Segment[] = [];
  let ok = true;
  value.forEach((entry, i) => {
    const where = [...path, i];
    if (isPlainObject(entry) && 'bezier' in entry) {
      if (i === 0) {
        c.report(
          where,
          nodeId,
          'a plain point to start the path',
          entry,
          `Start with a point such as ${example}.`,
        );
        ok = false;
        return;
      }
      const extra = Object.keys(entry).filter((k) => k !== 'bezier');
      for (const key of extra) {
        c.report([...where, key], nodeId, '"bezier"', undefined, 'Remove this key.', key);
        ok = false;
      }
      const b = entry.bezier;
      if (!Array.isArray(b) || b.length !== 3) {
        c.report(
          [...where, 'bezier'],
          nodeId,
          'an array of three points [control1, control2, end]',
          b,
          'For example { "bezier": [{ "x": 0, "y": -10 }, { "x": 10, "y": -10 }, { "x": 10 }] }.',
        );
        ok = false;
        return;
      }
      const [c1, c2, to] = b.map((p, j) =>
        readVector(c, p, [...where, 'bezier', j], nodeId, example),
      );
      if (c1 && c2 && to) segments.push({ kind: 'bezier', c1, c2, to });
      else ok = false;
      return;
    }
    const point = readVector(c, entry, where, nodeId, example);
    if (!point) {
      ok = false;
    } else if (i === 0) {
      start = point;
    } else {
      segments.push({ kind: 'line', to: point });
    }
  });
  return ok && start ? { start, segments, closed } : undefined;
}

function readEllipseSize(
  c: Checker,
  obj: Record<string, unknown>,
  path: Path,
  nodeId: string | undefined,
): [number, number] | undefined {
  const hasDiameter = obj.diameter !== undefined;
  const hasWidth = obj.width !== undefined;
  const hasHeight = obj.height !== undefined;
  const size = { min: 0, example: '20' };
  if (hasDiameter) {
    if (hasWidth || hasHeight) {
      c.report(
        [...path, 'diameter'],
        nodeId,
        'either "diameter" or "width" and "height", not both',
        obj.diameter,
        'Remove "diameter", or remove "width" and "height".',
      );
      return undefined;
    }
    const d = readNumber(c, obj, 'diameter', path, nodeId, size);
    return d === undefined ? undefined : [d, d];
  }
  if (!hasWidth && !hasHeight) {
    c.report(
      [...path, 'diameter'],
      nodeId,
      'a "diameter", or a "width" and a "height"',
      undefined,
      'For example { "type": "ellipse", "diameter": 20 }.',
    );
    return undefined;
  }
  const w = readNumber(c, obj, 'width', path, nodeId, size);
  const h = readNumber(c, obj, 'height', path, nodeId, size);
  return w === undefined || h === undefined ? undefined : [w, h];
}

function readNode(c: Checker, input: unknown, path: Path): NormalizedNode | undefined {
  if (!isPlainObject(input)) {
    c.report(path, undefined, 'a node object such as { "type": "ellipse", "diameter": 20 }', input);
    return undefined;
  }
  let nodeId: string | undefined;
  if (input.id !== undefined) {
    if (typeof input.id === 'string') nodeId = input.id;
    else c.report([...path, 'id'], undefined, 'a string', input.id);
  }
  if (!c.enter(input, path, nodeId)) return undefined;

  const typeValue = input.type;
  const typeList = NODE_TYPES.map((t) => `"${t}"`).join(', ');
  // When the type is wrong, the node is still checked as fully as possible,
  // so that one round of fixes is enough: as the intended type when it is
  // clear, otherwise only the options every node shares.
  let type: NodeType | undefined;
  let lenient = false;
  if (typeof typeValue === 'string' && (NODE_TYPES as readonly string[]).includes(typeValue)) {
    type = typeValue as NodeType;
  } else {
    let hint = 'Every node needs a "type".';
    if (typeof typeValue === 'string') {
      const key = typeValue.toLowerCase().replace(/[\s_-]/g, '');
      const alias = TYPE_ALIASES[key];
      const guess = alias ? undefined : closest(typeValue, NODE_TYPES);
      if (alias) {
        hint = alias.hint;
        if (alias.direct && alias.type) {
          type = alias.type;
          hint = `Did you mean "${type}"? ${hint}`;
        }
      } else if (guess) {
        hint = `Did you mean "${guess}"?`;
        type = guess as NodeType;
      } else {
        hint = `Use one of ${typeList}.`;
      }
      if (type) hint += ` The other options were checked as ${article(type)} "${type}".`;
    }
    c.report([...path, 'type'], nodeId, `one of ${typeList}`, typeValue, hint);
    lenient = true;
  }

  if (type) {
    checkKeys(c, input, KEYS_BY_TYPE[type], path, nodeId, `${article(type)} "${type}" node`, type);
  } else {
    checkKeys(c, input, ALL_NODE_KEYS, path, nodeId, 'any node');
  }

  const vectorExample = '{ "x": 0, "y": -20, "z": 10 }';
  const translate =
    input.translate === undefined
      ? ZERO
      : (readVector(c, input.translate, [...path, 'translate'], nodeId, vectorExample) ?? ZERO);
  const rotate =
    input.rotate === undefined
      ? ZERO
      : (readVector(c, input.rotate, [...path, 'rotate'], nodeId, '{ "x": 0, "y": 45, "z": 0 }') ??
        ZERO);
  let scale = ONE;
  if (typeof input.scale === 'number' && Number.isFinite(input.scale)) {
    scale = { x: input.scale, y: input.scale, z: input.scale };
  } else if (isPlainObject(input.scale)) {
    const s = readVector(c, input.scale, [...path, 'scale'], nodeId, '{ "x": 2, "y": 1, "z": 1 }');
    if (s) {
      scale = {
        x: input.scale.x === undefined ? 1 : s.x,
        y: input.scale.y === undefined ? 1 : s.y,
        z: input.scale.z === undefined ? 1 : s.z,
      };
    }
  } else if (input.scale !== undefined) {
    c.report(
      [...path, 'scale'],
      nodeId,
      'a number or an object with optional numeric x, y and z',
      input.scale,
      'For example 2, or { "x": 2 } to stretch along x only (missing axes default to 1).',
    );
  }
  const visible = readBoolean(c, input, 'visible', path, nodeId, true);
  const children = readChildren(c, input.children, [...path, 'children'], nodeId);

  // Options that a node of the wrong type has not got are skipped; required
  // options are not demanded, since the intended type may not need them.
  const present = (key: string) => !lenient || input[key] !== undefined;
  const shapeType = type;
  let shape: NormalizedShape | undefined;
  let solid: NormalizedSolid | undefined;
  if (shapeType !== 'group') {
    const color = readColor(c, input, 'color', path, nodeId) ?? DEFAULT_COLOR;
    const stroke =
      input.stroke === undefined
        ? 1
        : (readNumber(c, input, 'stroke', path, nodeId, {
            min: 0,
            example: '4',
            hint: strokeHint,
          }) ?? 1);
    const fill = readFill(c, input, path, nodeId, shapeType !== undefined && isSolid(shapeType));
    const size = { min: 0, example: '20' };
    const dimension = (key: string) =>
      present(key) ? readNumber(c, input, key, path, nodeId, size) : undefined;
    let geometry: PathGeometry | undefined;
    if (shapeType === 'path') {
      const closed = readBoolean(c, input, 'closed', path, nodeId, false);
      if (present('path')) geometry = readPath(c, input.path, [...path, 'path'], nodeId, closed);
    } else if (shapeType === 'ellipse') {
      if (!lenient || ['diameter', 'width', 'height'].some((k) => input[k] !== undefined)) {
        const ellipse = readEllipseSize(c, input, path, nodeId);
        if (ellipse) geometry = ellipseGeometry(ellipse[0], ellipse[1]);
      }
    } else if (shapeType === 'rect') {
      const w = dimension('width');
      const h = dimension('height');
      if (w !== undefined && h !== undefined) geometry = rectGeometry(w, h);
    } else if (shapeType === 'polygon') {
      const sides = present('sides')
        ? readNumber(c, input, 'sides', path, nodeId, { min: 3, integer: true, example: '6' })
        : undefined;
      const radius = dimension('radius');
      if (sides !== undefined && radius !== undefined) geometry = polygonGeometry(sides, radius);
    } else if (shapeType !== undefined && isSolid(shapeType)) {
      const shade = readBoolean(c, input, 'shade', path, nodeId, true);
      const faces: Record<string, string> = {};
      for (const key of FACE_KEYS[shapeType]) {
        const value = input[key];
        if (value === undefined) continue;
        if (typeof value === 'boolean') {
          c.report(
            [...path, key],
            nodeId,
            'a CSS color string such as "#e62"',
            value,
            value
              ? 'Leave the option out to shade this face from "color".'
              : 'Faces cannot be left out. Leave the option out to shade this face from "color".',
          );
          continue;
        }
        const face = readColor(c, input, key, path, nodeId);
        if (face !== undefined) faces[key] = face;
      }
      const dims = {
        width: 0,
        height: 0,
        depth: 0,
        diameter: 0,
        length: 0,
      };
      let ok = true;
      const need =
        shapeType === 'box'
          ? (['width', 'height', 'depth'] as const)
          : shapeType === 'hemisphere'
            ? (['diameter'] as const)
            : (['diameter', 'length'] as const);
      for (const key of need) {
        const value = dimension(key);
        if (value === undefined) ok = false;
        else dims[key] = value;
      }
      if (ok) solid = { kind: shapeType, ...dims, color, stroke, shade, faces };
    }
    if (geometry) shape = { geometry, color, stroke, fill };
  }
  if (lenient || type === undefined) return undefined;
  return {
    type,
    id: nodeId,
    location: path,
    translate,
    rotate,
    scale,
    visible,
    children,
    shape,
    solid,
  };
}

function article(type: string): string {
  return /^[aeiou]/.test(type) ? 'an' : 'a';
}

/**
 * Checks a scene description and returns every problem found, without
 * throwing. An empty array means the scene is valid.
 */
export function checkScene(input: unknown): ValidationIssue[] {
  return normalize(input).issues;
}

/**
 * Validates a scene description and fills in defaults.
 * @throws {ZpupValidationError} listing every problem when the scene is invalid.
 */
export function normalizeScene(input: Scene | unknown): NormalizedScene {
  const { scene, issues } = normalize(input);
  if (issues.length > 0 || !scene) throw new ZpupValidationError(issues);
  return scene;
}

export function normalize(input: unknown): { scene?: NormalizedScene; issues: ValidationIssue[] } {
  const c = new Checker();
  const path: Path = ['scene'];
  if (!isPlainObject(input)) {
    c.report(
      path,
      undefined,
      'a scene object such as { "width": 240, "height": 240, "children": [] }',
      input,
    );
    return { issues: c.issues };
  }
  checkKeys(c, input, SCENE_KEYS, path, undefined, 'the scene');
  const size = { min: 0, exclusiveMin: true, example: '240' };
  const width = readNumber(c, input, 'width', path, undefined, size);
  const height = readNumber(c, input, 'height', path, undefined, size);
  const zoom =
    input.zoom === undefined
      ? 1
      : readNumber(c, input, 'zoom', path, undefined, { min: 0, exclusiveMin: true, example: '2' });
  const background = readColor(c, input, 'background', path, undefined);
  let title: string | undefined;
  if (input.title !== undefined) {
    if (typeof input.title === 'string') title = input.title;
    else c.report([...path, 'title'], undefined, 'a string', input.title);
  }
  const rotate =
    input.rotate === undefined
      ? ZERO
      : (readVector(c, input.rotate, [...path, 'rotate'], undefined, '{ "x": -15, "y": 30 }') ??
        ZERO);
  if (input.children === undefined) {
    c.report(
      [...path, 'children'],
      undefined,
      'an array of nodes',
      undefined,
      'Use [] for an empty scene.',
    );
  }
  const children = readChildren(c, input.children, [...path, 'children'], undefined);
  if (c.issues.length > 0 || width === undefined || height === undefined || zoom === undefined) {
    return { issues: c.issues };
  }
  return {
    scene: { width, height, zoom, background, title, rotate, children },
    issues: c.issues,
  };
}
