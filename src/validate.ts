import { closest, describe, type ValidationIssue, ZpupValidationError } from './errors.ts';
import {
  ellipseGeometry,
  type PathGeometry,
  polygonGeometry,
  rectGeometry,
  type Segment,
} from './geometry.ts';
import type { Vec3 } from './math.ts';
import type { NodeType, Scene } from './types.ts';

/** A node after validation, with every default filled in. */
export interface NormalizedNode {
  readonly type: NodeType;
  readonly id: string | undefined;
  /** JSON-style location in the input, for messages. */
  readonly location: string;
  readonly translate: Vec3;
  readonly rotate: Vec3;
  readonly scale: Vec3;
  readonly visible: boolean;
  readonly children: readonly NormalizedNode[];
  /** Drawing options; undefined for groups. */
  readonly shape: NormalizedShape | undefined;
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

const NODE_TYPES: readonly NodeType[] = ['group', 'path', 'ellipse', 'rect', 'polygon'];

/** Common names for node types that zpup spells differently. */
const TYPE_ALIASES: Readonly<Record<string, NodeType>> = {
  anchor: 'group',
  circle: 'ellipse',
  oval: 'ellipse',
  line: 'path',
  polyline: 'path',
  shape: 'path',
  dot: 'path',
  point: 'path',
  sphere: 'path',
  square: 'rect',
  rectangle: 'rect',
  triangle: 'polygon',
  hexagon: 'polygon',
};

const NODE_KEYS = ['type', 'id', 'translate', 'rotate', 'scale', 'visible', 'children'] as const;
const SHAPE_KEYS = ['color', 'stroke', 'fill'] as const;
const KEYS_BY_TYPE: Readonly<Record<NodeType, readonly string[]>> = {
  group: NODE_KEYS,
  path: [...NODE_KEYS, ...SHAPE_KEYS, 'path', 'closed'],
  ellipse: [...NODE_KEYS, ...SHAPE_KEYS, 'diameter', 'width', 'height'],
  rect: [...NODE_KEYS, ...SHAPE_KEYS, 'width', 'height'],
  polygon: [...NODE_KEYS, ...SHAPE_KEYS, 'sides', 'radius'],
};
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

class Checker {
  readonly issues: ValidationIssue[] = [];
  private readonly seen = new Set<object>();

  report(
    path: string,
    nodeId: string | undefined,
    expected: string,
    value: unknown,
    hint?: string,
    unknownKey?: string,
  ): void {
    const received = unknownKey === undefined ? describe(value) : `unknown option "${unknownKey}"`;
    const where = nodeId === undefined ? path : `${path} (in node "${nodeId}")`;
    const tail = hint ? ` ${hint}` : '';
    const message =
      unknownKey === undefined
        ? `${where}: expected ${expected}, received ${received}.${tail}`
        : `${where}: unknown option "${unknownKey}".${tail} Allowed: ${expected}.`;
    const issue: ValidationIssue = { path, expected, received, message };
    if (nodeId !== undefined) issue.nodeId = nodeId;
    if (hint !== undefined) issue.hint = hint;
    this.issues.push(issue);
  }

  /** Guards against the same object appearing twice (which includes cycles). */
  enter(value: object, path: string, nodeId: string | undefined): boolean {
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
  /^[a-z]+$/i,
];

function isColor(value: unknown): value is string {
  return typeof value === 'string' && COLOR_PATTERNS.some((re) => re.test(value.trim()));
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
  path: string,
  nodeId: string | undefined,
  rule: { min?: number; exclusiveMin?: boolean; integer?: boolean; example: string },
): number | undefined {
  const value = obj[key];
  const where = `${path}.${key}`;
  let expected = rule.integer ? 'an integer' : 'a number';
  if (rule.min !== undefined)
    expected += rule.exclusiveMin ? ` greater than ${rule.min}` : ` of at least ${rule.min}`;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    c.report(where, nodeId, expected, value, numberHint(value, rule.example));
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
  path: string,
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
        `${path}.${key}`,
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
      c.report(
        `${path}.${axis}`,
        nodeId,
        'a finite number',
        component,
        numberHint(component, '10'),
      );
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
  path: string,
  nodeId: string | undefined,
  fallback: boolean,
): boolean {
  const value = obj[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    const hint = value === 'true' || value === 'false' ? `Remove the quotes: ${value}.` : undefined;
    c.report(`${path}.${key}`, nodeId, 'true or false', value, hint);
    return fallback;
  }
  return value;
}

function readColor(
  c: Checker,
  obj: Record<string, unknown>,
  key: string,
  path: string,
  nodeId: string | undefined,
): string | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (!isColor(value)) {
    c.report(
      `${path}.${key}`,
      nodeId,
      'a CSS color string such as "#e62", "rgb(230, 100, 30)" or "tomato"',
      value,
    );
    return undefined;
  }
  return value.trim();
}

function checkKeys(
  c: Checker,
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  nodeId: string | undefined,
  owner: string,
): void {
  for (const key of Object.keys(obj)) {
    if (allowed.includes(key)) continue;
    let hint: string;
    const alias = KEY_ALIASES[key];
    const guess = alias && allowed.includes(alias) ? alias : closest(key, allowed);
    const isEllipse = owner === 'an "ellipse" node';
    const otherTypes = NODE_TYPES.filter((t) => KEYS_BY_TYPE[t].includes(key));
    if (owner === 'a "group" node' && (SHAPE_KEYS as readonly string[]).includes(key)) {
      hint = `Groups draw nothing; set "${key}" on the shapes inside the group.`;
    } else if (isEllipse && key === 'radius') {
      hint = 'Use "diameter" (twice the radius).';
    } else if (guess) {
      hint = `Did you mean "${guess}"?`;
    } else if (otherTypes.length > 0 && owner !== 'the scene') {
      hint = `"${key}" is an option of ${otherTypes.map((t) => `"${t}"`).join(', ')} nodes.`;
    } else {
      hint = 'Remove this option.';
    }
    c.report(
      `${path}.${key}`,
      nodeId,
      `${allowed.map((k) => `"${k}"`).join(', ')} (options of ${owner})`,
      undefined,
      hint,
      key,
    );
  }
}

function readChildren(
  c: Checker,
  value: unknown,
  path: string,
  nodeId: string | undefined,
): NormalizedNode[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    c.report(path, nodeId, 'an array of nodes', value, 'Wrap a single node in an array: [node].');
    return [];
  }
  const out: NormalizedNode[] = [];
  value.forEach((child, i) => {
    const node = readNode(c, child, `${path}[${i}]`);
    if (node) out.push(node);
  });
  return out;
}

function readPath(
  c: Checker,
  value: unknown,
  path: string,
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
    const where = `${path}[${i}]`;
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
        c.report(`${where}.${key}`, nodeId, '"bezier"', undefined, 'Remove this key.', key);
        ok = false;
      }
      const b = entry.bezier;
      if (!Array.isArray(b) || b.length !== 3) {
        c.report(
          `${where}.bezier`,
          nodeId,
          'an array of three points [control1, control2, end]',
          b,
          'For example { "bezier": [{ "x": 0, "y": -10 }, { "x": 10, "y": -10 }, { "x": 10 }] }.',
        );
        ok = false;
        return;
      }
      const [c1, c2, to] = b.map((p, j) =>
        readVector(c, p, `${where}.bezier[${j}]`, nodeId, example),
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
  path: string,
  nodeId: string | undefined,
): [number, number] | undefined {
  const hasDiameter = obj.diameter !== undefined;
  const hasWidth = obj.width !== undefined;
  const hasHeight = obj.height !== undefined;
  const size = { min: 0, example: '20' };
  if (hasDiameter) {
    if (hasWidth || hasHeight) {
      c.report(
        `${path}.diameter`,
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
      `${path}.diameter`,
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

function readNode(c: Checker, input: unknown, path: string): NormalizedNode | undefined {
  if (!isPlainObject(input)) {
    c.report(path, undefined, 'a node object such as { "type": "ellipse", "diameter": 20 }', input);
    return undefined;
  }
  let nodeId: string | undefined;
  if (input.id !== undefined) {
    if (typeof input.id === 'string') nodeId = input.id;
    else c.report(`${path}.id`, undefined, 'a string', input.id);
  }
  if (!c.enter(input, path, nodeId)) return undefined;

  const typeValue = input.type;
  const typeList = NODE_TYPES.map((t) => `"${t}"`).join(', ');
  if (typeof typeValue !== 'string' || !(NODE_TYPES as readonly string[]).includes(typeValue)) {
    let hint = 'Every node needs a "type".';
    if (typeof typeValue === 'string') {
      const guess = TYPE_ALIASES[typeValue.toLowerCase()] ?? closest(typeValue, NODE_TYPES);
      hint = guess ? `Did you mean "${guess}"?` : `Use one of ${typeList}.`;
      if (typeValue.toLowerCase() === 'dot' || typeValue.toLowerCase() === 'sphere') {
        hint = 'Use { "type": "path", "path": [{}], "stroke": 20 } for a dot.';
      }
    }
    c.report(`${path}.type`, nodeId, `one of ${typeList}`, typeValue, hint);
    // Still look inside so that problems in children are reported too.
    readChildren(c, input.children, `${path}.children`, nodeId);
    return undefined;
  }
  const type = typeValue as NodeType;

  checkKeys(
    c,
    input,
    KEYS_BY_TYPE[type],
    path,
    nodeId,
    `${type === 'ellipse' ? 'an' : 'a'} "${type}" node`,
  );

  const vectorExample = '{ "x": 0, "y": -20, "z": 10 }';
  const translate =
    input.translate === undefined
      ? ZERO
      : (readVector(c, input.translate, `${path}.translate`, nodeId, vectorExample) ?? ZERO);
  const rotate =
    input.rotate === undefined
      ? ZERO
      : (readVector(c, input.rotate, `${path}.rotate`, nodeId, '{ "x": 0, "y": 45, "z": 0 }') ??
        ZERO);
  let scale = ONE;
  if (typeof input.scale === 'number' && Number.isFinite(input.scale)) {
    scale = { x: input.scale, y: input.scale, z: input.scale };
  } else if (isPlainObject(input.scale)) {
    const s = readVector(c, input.scale, `${path}.scale`, nodeId, '{ "x": 2, "y": 1, "z": 1 }');
    if (s) {
      scale = {
        x: input.scale.x === undefined ? 1 : s.x,
        y: input.scale.y === undefined ? 1 : s.y,
        z: input.scale.z === undefined ? 1 : s.z,
      };
    }
  } else if (input.scale !== undefined) {
    c.report(
      `${path}.scale`,
      nodeId,
      'a number or an object with optional numeric x, y and z',
      input.scale,
      'For example 2, or { "x": 2 } to stretch along x only (missing axes default to 1).',
    );
  }
  const visible = readBoolean(c, input, 'visible', path, nodeId, true);
  const children = readChildren(c, input.children, `${path}.children`, nodeId);

  let shape: NormalizedShape | undefined;
  if (type !== 'group') {
    const color = readColor(c, input, 'color', path, nodeId) ?? DEFAULT_COLOR;
    const stroke =
      input.stroke === undefined
        ? 1
        : (readNumber(c, input, 'stroke', path, nodeId, { min: 0, example: '4' }) ?? 1);
    const fill = readBoolean(c, input, 'fill', path, nodeId, false);
    let geometry: PathGeometry | undefined;
    if (type === 'path') {
      const closed = readBoolean(c, input, 'closed', path, nodeId, false);
      geometry = readPath(c, input.path, `${path}.path`, nodeId, closed);
    } else if (type === 'ellipse') {
      const size = readEllipseSize(c, input, path, nodeId);
      if (size) geometry = ellipseGeometry(size[0], size[1]);
    } else if (type === 'rect') {
      const size = { min: 0, example: '20' };
      const w = readNumber(c, input, 'width', path, nodeId, size);
      const h = readNumber(c, input, 'height', path, nodeId, size);
      if (w !== undefined && h !== undefined) geometry = rectGeometry(w, h);
    } else {
      const sides = readNumber(c, input, 'sides', path, nodeId, {
        min: 3,
        integer: true,
        example: '6',
      });
      const radius = readNumber(c, input, 'radius', path, nodeId, { min: 0, example: '20' });
      if (sides !== undefined && radius !== undefined) geometry = polygonGeometry(sides, radius);
    }
    if (geometry) shape = { geometry, color, stroke, fill };
  }

  return { type, id: nodeId, location: path, translate, rotate, scale, visible, children, shape };
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

function normalize(input: unknown): { scene?: NormalizedScene; issues: ValidationIssue[] } {
  const c = new Checker();
  const path = 'scene';
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
    else c.report(`${path}.title`, undefined, 'a string', input.title);
  }
  const rotate =
    input.rotate === undefined
      ? ZERO
      : (readVector(c, input.rotate, `${path}.rotate`, undefined, '{ "x": -15, "y": 30 }') ?? ZERO);
  if (input.children === undefined) {
    c.report(
      `${path}.children`,
      undefined,
      'an array of nodes',
      undefined,
      'Use [] for an empty scene.',
    );
  }
  const children = readChildren(c, input.children, `${path}.children`, undefined);
  if (c.issues.length > 0 || width === undefined || height === undefined || zoom === undefined) {
    return { issues: c.issues };
  }
  return {
    scene: { width, height, zoom, background, title, rotate, children },
    issues: c.issues,
  };
}
