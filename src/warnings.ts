import { parseColor } from './color.ts';
import { compileNormalized } from './compile.ts';
import { crossingAreas } from './depth.ts';
import { formatPath, type ValidationIssue } from './errors.ts';
import {
  compilePieces,
  depthShapes,
  type Piece,
  paintedColor,
  piecesOverlap,
  visiblePieces,
} from './pieces.ts';
import { FACE_KEYS } from './solids.ts';
import { formatNumber } from './svg.ts';
import {
  Checker,
  type NormalizedNode,
  type NormalizedScene,
  normalize,
  type Path,
} from './validate.ts';

/**
 * Looks for things in a valid scene that are allowed but probably not what
 * was meant: angles that look like radians, shapes that lie entirely outside
 * the image, a scene that draws nothing, solids whose color cannot be shaded,
 * and shapes that pass through each other. Warnings never stop a scene from
 * rendering.
 *
 * Returns an empty array for an invalid scene; use {@link checkScene} for
 * errors. Each warning has the same fields as a validation issue.
 */
export function checkSceneWarnings(input: unknown): ValidationIssue[] {
  const { scene } = normalize(input);
  if (!scene) return [];
  const c = new Checker();
  radians(c, scene);
  if (!nothingDrawn(c, scene)) offScreen(c, scene);
  unshadedSolids(c, scene);
  passingThrough(c, scene);
  return c.issues;
}

function walk(nodes: readonly NormalizedNode[], visit: (node: NormalizedNode) => void): void {
  for (const node of nodes) {
    visit(node);
    walk(node.children, visit);
  }
}

const TWO_PI = 2 * Math.PI;

/**
 * Every non-zero angle in the scene is a fraction no larger than 2π. Whole
 * numbers (0, 90, 5) never count as a sign of radians, and one small angle on
 * its own only counts when it is close to a common radian value such as π/4.
 */
function radians(c: Checker, s: NormalizedScene): void {
  const angles: { path: Path; nodeId: string | undefined; value: number }[] = [];
  const add = (path: Path, nodeId: string | undefined, r: { x: number; y: number; z: number }) => {
    for (const axis of ['x', 'y', 'z'] as const) {
      if (r[axis] !== 0) angles.push({ path: [...path, 'rotate', axis], nodeId, value: r[axis] });
    }
  };
  add(['scene'], undefined, s.rotate);
  walk(s.children, (node) => add(node.location, node.id, node.rotate));
  if (angles.length === 0) return;
  if (!angles.every((a) => Math.abs(a.value) <= TWO_PI + 1e-3)) return;
  if (angles.every((a) => Number.isInteger(a.value))) return;
  const landmark = (v: number) => {
    const twelfths = v / (Math.PI / 12);
    return Math.round(twelfths) !== 0 && Math.abs(twelfths - Math.round(twelfths)) < 0.02;
  };
  if (angles.length < 2 && !angles.some((a) => landmark(a.value))) return;
  const first = angles.find((a) => !Number.isInteger(a.value)) ?? (angles[0] as (typeof angles)[0]);
  const degrees = (v: number) => formatNumber((v * 180) / Math.PI, 1);
  const examples = angles
    .slice(0, 3)
    .map((a) => `${formatNumber(a.value, 4)} rad = ${degrees(a.value)} degrees`)
    .join(', ');
  const more = angles.length > 1 ? ` (and ${angles.length - 1} more, all at most 2π)` : '';
  c.note(
    first.path,
    first.nodeId,
    'an angle in degrees',
    `${formatNumber(first.value, 4)}${more}`,
    `Every rotation in this scene is a small fraction, which looks like radians. Zpup angles are in degrees: multiply radians by 57.2958 (${examples}).`,
  );
}

/** Reports a scene with nothing to paint. Returns whether it did. */
function nothingDrawn(c: Checker, s: NormalizedScene): boolean {
  if (compileNormalized(s).items.length > 0) return false;
  let shapes = 0;
  let hidden = 0;
  let invisibleStroke = 0;
  const count = (nodes: readonly NormalizedNode[], shown: boolean) => {
    for (const node of nodes) {
      const visible = shown && node.visible;
      if (node.shape || node.solid) {
        shapes++;
        if (!visible) hidden++;
        else if (node.shape && node.shape.stroke === 0 && !node.shape.fill) invisibleStroke++;
      }
      count(node.children, visible);
    }
  };
  count(s.children, true);
  let received: string;
  let hint: string;
  if (shapes === 0) {
    received = s.children.length === 0 ? 'no nodes' : 'only groups, which draw nothing';
    hint = 'Add shapes, for example { "type": "ellipse", "diameter": 40, "fill": true }.';
  } else if (hidden === shapes) {
    received = 'only hidden shapes';
    hint = 'Every shape is in a node with "visible": false. Remove it or set it to true.';
  } else if (hidden + invisibleStroke === shapes) {
    received = 'shapes with "stroke": 0 and no fill';
    hint = 'A shape needs a "stroke" above 0 or "fill": true to show.';
  } else if (compilePieces(s).some((p) => p.culled)) {
    received = 'only shapes turned away with "backface": false';
    hint =
      'They show only while their front (local +z) faces the viewer. Turn them or the view, or remove "backface": false.';
  } else {
    received = 'shapes that are too small to draw';
    hint = 'Check "scale" and the sizes of the shapes.';
  }
  c.note(['scene', 'children'], undefined, 'at least one visible shape', received, hint);
  return true;
}

const MAX_OFF_SCREEN = 3;

/** Shapes that lie entirely outside the image, typically from top-left coordinates. */
function offScreen(c: Checker, s: NormalizedScene): void {
  // Keyed by the node's location written out, since arrays compare by identity.
  const bounds = new Map<
    string,
    {
      location: Path;
      nodeId: string | undefined;
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
    }
  >();
  for (const p of compilePieces(s)) {
    const pad = p.stroke / 2;
    const key = formatPath(p.location);
    let b = bounds.get(key);
    if (!b) {
      b = {
        location: p.location,
        nodeId: p.nodeId,
        minX: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      };
      bounds.set(key, b);
    }
    for (const q of p.points) {
      b.minX = Math.min(b.minX, q.x - pad);
      b.maxX = Math.max(b.maxX, q.x + pad);
      b.minY = Math.min(b.minY, q.y - pad);
      b.maxY = Math.max(b.maxY, q.y + pad);
    }
  }
  const outside = [...bounds].filter(
    ([, b]) => b.maxX < 0 || b.minX > s.width || b.maxY < 0 || b.minY > s.height,
  );
  if (outside.length === 0) return;
  const n = (v: number) => formatNumber(v, 0);
  const halfW = s.width / 2 / s.zoom;
  const halfH = s.height / 2 / s.zoom;
  const origin =
    `The origin (0, 0) is the center of the image, so x runs from ${n(-halfW)} to ${n(halfW)} ` +
    `and y from ${n(-halfH)} to ${n(halfH)} (y down). If you placed shapes from the top-left ` +
    `corner as in SVG, subtract ${n(halfW)} from x and ${n(halfH)} from y.`;
  outside.slice(0, MAX_OFF_SCREEN).forEach(([, b], i) => {
    const rest =
      i === MAX_OFF_SCREEN - 1 && outside.length > MAX_OFF_SCREEN
        ? ` ${outside.length - MAX_OFF_SCREEN} more shapes are outside too.`
        : '';
    c.note(
      b.location,
      b.nodeId,
      `a shape at least partly inside the ${n(s.width)} by ${n(s.height)} image`,
      `a shape entirely outside it (from ${n(b.minX)}, ${n(b.minY)} to ${n(b.maxX)}, ${n(b.maxY)} in image pixels)`,
      origin + rest,
    );
  });
}

/** Solids whose color Zpup cannot lighten or darken, so every face would look the same. */
function unshadedSolids(c: Checker, s: NormalizedScene): void {
  walk(s.children, (node) => {
    const solid = node.solid;
    if (!solid?.shade || parseColor(solid.color)) return;
    // A solid of flat faces that all have their own color has nothing left to shade.
    const flat = solid.kind === 'box' || solid.kind === 'pyramid';
    if (flat && Object.keys(solid.faces).length === FACE_KEYS[solid.kind].length) return;
    c.note(
      [...node.location, 'color'],
      node.id,
      'a color that can be shaded: hex, rgb(), hsl() or a color name',
      JSON.stringify(solid.color),
      'Every face gets this one color, so the solid looks flat. Use a hex color, give faces their own colors (such as "frontFace"), or set "shade": false.',
    );
  });
}

/** A pair of nodes whose shapes pass through each other, at the view where it shows most. */
export interface Crossing {
  readonly a: { readonly location: Path; readonly nodeId: string | undefined };
  readonly b: { readonly location: Path; readonly nodeId: string | undefined };
  /** Screen area, in square pixels, that shows the wrong shape whichever is painted last. */
  readonly area: number;
  /** How far the view is turned about the vertical axis from the scene's own, in degrees. */
  readonly turnDeg: number;
}

/** The turns checked: the scene's own view and seven more around the vertical axis. */
const CROSSING_TURNS_DEG = [0, 45, 90, 135, 180, 225, 270, 315];

/** A depth difference below this many pixels is not seen as a wrong order. */
const CROSSING_TOLERANCE = 1.5;

/**
 * Every pair of nodes of different colors whose shapes pass through each
 * other, largest wrong area first. For each pair of pieces, the wrong area is
 * the smaller of the areas where one is in front and where the other is; a
 * pair of nodes gets the sum over its pieces, at the turn where it is largest.
 */
export function findCrossings(s: NormalizedScene): Crossing[] {
  const found = new Map<string, Crossing>();
  for (const turnDeg of CROSSING_TURNS_DEG) {
    const pieces = visiblePieces(compilePieces(s, { ...s.rotate, y: s.rotate.y + turnDeg }));
    // Touching solids overlap by their rounded edges on purpose: leave the edges out.
    const shapes = depthShapes(pieces).map((d) =>
      d.solid === undefined ? d : { ...d, radius: 0 },
    );
    const keys = pieces.map((p) => formatPath(p.location));
    const colors = pieces.map((p) => paintedColor(p).toLowerCase());
    const areas = new Map<string, { a: Piece; b: Piece; area: number }>();
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        if (keys[i] === keys[j] || colors[i] === colors[j]) continue;
        const a = pieces[i] as Piece;
        const b = pieces[j] as Piece;
        if (!piecesOverlap(a, b)) continue;
        const front = crossingAreas(shapes[i] as never, shapes[j] as never, CROSSING_TOLERANCE);
        const wrong = Math.min(front.a, front.b);
        if (wrong <= 0) continue;
        const key = `${keys[i]}|${keys[j]}`;
        const sum = areas.get(key);
        if (sum) sum.area += wrong;
        else areas.set(key, { a, b, area: wrong });
      }
    }
    for (const [key, { a, b, area }] of areas) {
      const best = found.get(key);
      if (best && best.area >= area) continue;
      found.set(key, {
        a: { location: a.location, nodeId: a.nodeId },
        b: { location: b.location, nodeId: b.nodeId },
        area,
        turnDeg,
      });
    }
  }
  return [...found.values()].sort((x, y) => y.area - x.area);
}

const MAX_CROSSINGS = 3;

/** A wrong area below this share of the image is too small to mention. */
const CROSSING_SHARE = 0.001;

/** Shapes of different colors that pass through each other, so that no paint order is right. */
function passingThrough(c: Checker, s: NormalizedScene): void {
  const crossings = findCrossings(s).filter((x) => x.area >= CROSSING_SHARE * s.width * s.height);
  crossings.slice(0, MAX_CROSSINGS).forEach((x, i) => {
    const other = x.b.nodeId === undefined ? formatPath(x.b.location) : `"${x.b.nodeId}"`;
    const turned = x.turnDeg === 0 ? '' : ` with the view turned by ${x.turnDeg} degrees`;
    const rest =
      i === MAX_CROSSINGS - 1 && crossings.length > MAX_CROSSINGS
        ? ` ${crossings.length - MAX_CROSSINGS} more pairs of shapes do the same.`
        : '';
    c.note(
      x.a.location,
      x.a.nodeId,
      'shapes that do not pass through each other',
      `a shape that passes through ${other}`,
      `Each is partly in front of the other, so neither can be painted on top: about ${formatNumber(x.area, 0)} square pixels show the wrong one${turned}, and the picture flickers there as it turns. Move one clear of the other, or let a detail rest on a surface instead of sitting half inside it. Shapes of the same color can overlap freely.${rest}`,
    );
  });
}
