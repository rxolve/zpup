import {
  closest,
  describe,
  makeIssue,
  type ValidationIssue,
  ZpupValidationError,
} from './errors.ts';
import { controlPoints, flatten, type PathGeometry, type Segment } from './geometry.ts';
import { lerp, type Vec3 } from './math.ts';
import {
  compilePieces,
  FACING_EPSILON,
  type Piece,
  paintConstraints,
  positions,
} from './pieces.ts';
import { Gradients, type SoftKind, tubeLayers } from './shading.ts';
import { escapeXml, formatNumber } from './svg.ts';
import type { Scene } from './types.ts';
import { checkScene, type NormalizedScene, normalizeScene } from './validate.ts';

/** Options for {@link renderSpinSvg}. */
export interface SpinOptions {
  /**
   * Which angle of the scene's view rotation (`scene.rotate`) turns. Default
   * `"y"`, a turntable: the scene spins about its vertical axis and keeps its
   * tilt.
   */
  axis?: 'x' | 'y' | 'z';
  /** Seconds for one full turn, at least 0.1. Default 8. */
  duration?: number;
  /**
   * Angles at which the geometry is computed exactly; the browser
   * interpolates linearly in between. More keyframes give smoother curves and
   * larger files. An integer from 4 to 720. Default 36 (every 10 degrees).
   */
  keyframes?: number;
  /** Whether the angle grows (`"positive"`, the default) or shrinks (`"negative"`). */
  direction?: 'positive' | 'negative';
  /** Digits kept after the decimal point in coordinates. An integer from 0 to 10. Default 1. */
  precision?: number;
}

interface ResolvedSpinOptions {
  readonly axis: 'x' | 'y' | 'z';
  readonly duration: number;
  readonly keyframes: number;
  readonly direction: 'positive' | 'negative';
  readonly precision: number;
}

/** Steps per turn at which the paint order is checked: every half degree. */
export const SPIN_STEPS = 720;

/**
 * A stretch of the turn, `[start, end)` in steps, during which one paint
 * order is used and every piece shows the same side. Ends fall on whole steps,
 * except where a flat shape with a `backface` option turns edge-on: there they
 * fall on the exact angle.
 */
export interface Epoch {
  readonly start: number;
  readonly end: number;
  /** Piece indices, back to front. */
  readonly order: readonly number[];
  /** What each piece shows during the epoch, by piece index. */
  readonly sides: readonly Side[];
}

/** What a piece shows: its front color, its back color, or nothing (`backface: false`). */
export type Side = 'front' | 'back' | 'hidden';

const OPTION_KEYS = ['axis', 'duration', 'keyframes', 'direction', 'precision'] as const;
const AXES = ['x', 'y', 'z'] as const;
const DIRECTIONS = ['positive', 'negative'] as const;

/**
 * Renders a scene as an SVG document that turns the view one full rotation,
 * forever, using SMIL animation and no JavaScript. It also plays inside an
 * `<img>` tag, so it works in a GitHub README. Renderers without SMIL show
 * the first frame, which is the scene as {@link renderSvg} draws it.
 *
 * This is a pure function: the same input gives the same string.
 * @throws {ZpupValidationError} when the scene or the options are invalid.
 */
export function renderSpinSvg(scene: Scene, options: SpinOptions = {}): string {
  const { resolved, issues } = resolveSpinOptions(options);
  const sceneIssues = checkScene(scene);
  if (sceneIssues.length > 0 || issues.length > 0 || !resolved) {
    const subject =
      sceneIssues.length === 0
        ? 'spin options'
        : issues.length === 0
          ? 'Zpup scene'
          : 'Zpup scene and spin options';
    throw new ZpupValidationError([...sceneIssues, ...issues], subject);
  }
  const s = normalizeScene(scene);
  return spinToSvg(s, resolved, planSpin(s, resolved));
}

/** Checks spin options and fills in defaults. */
export function resolveSpinOptions(options: unknown): {
  resolved: ResolvedSpinOptions | undefined;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const report = (key: string, expected: string, value: unknown, hint?: string) => {
    const received = describe(value);
    issues.push(
      makeIssue({
        pathSegments: ['options', key],
        expected,
        received,
        hint,
        detail: `expected ${expected}, received ${received}.${hint ? ` ${hint}` : ''}`,
      }),
    );
  };
  if (options === undefined) options = {};
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    const expected = 'an options object such as { "duration": 8 }';
    const received = describe(options);
    issues.push(
      makeIssue({
        pathSegments: ['options'],
        expected,
        received,
        detail: `expected ${expected}, received ${received}.`,
      }),
    );
    return { resolved: undefined, issues };
  }
  const o = options as Record<string, unknown>;
  const allowed = OPTION_KEYS.map((k) => `"${k}"`).join(', ');
  for (const key of Object.keys(o)) {
    if ((OPTION_KEYS as readonly string[]).includes(key)) continue;
    const guess = closest(key, OPTION_KEYS);
    const hint = guess ? `Did you mean "${guess}"?` : 'Remove this option.';
    issues.push(
      makeIssue({
        pathSegments: ['options', key],
        expected: `${allowed} (spin options)`,
        received: `unknown option "${key}"`,
        hint,
        detail: `unknown option "${key}". ${hint} Allowed: ${allowed}.`,
      }),
    );
  }

  const choice = <T extends string>(key: string, values: readonly T[], fallback: T): T => {
    const value = o[key];
    if (value === undefined) return fallback;
    if (typeof value === 'string' && (values as readonly string[]).includes(value))
      return value as T;
    const expected = values.map((v) => `"${v}"`).join(values.length > 2 ? ', ' : ' or ');
    const guess = typeof value === 'string' ? closest(value, values) : undefined;
    report(key, `one of ${expected}`, value, guess ? `Did you mean "${guess}"?` : undefined);
    return fallback;
  };
  const integer = (key: string, min: number, max: number, fallback: number): number => {
    const value = o[key];
    if (value === undefined) return fallback;
    if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) {
      return value;
    }
    const hint =
      typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value)
        ? `Use a whole number such as ${Math.min(max, Math.max(min, Math.round(value)))}.`
        : typeof value === 'string'
          ? `Use a plain number, e.g. ${fallback}.`
          : undefined;
    report(key, `an integer from ${min} to ${max}`, value, hint);
    return fallback;
  };

  const axis = choice('axis', AXES, 'y');
  const direction = choice('direction', DIRECTIONS, 'positive');
  let duration = 8;
  if (o.duration !== undefined) {
    const value = o.duration;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0.1) duration = value;
    else {
      report(
        'duration',
        'a number of seconds of at least 0.1',
        value,
        typeof value === 'string'
          ? 'Use a plain number of seconds without a unit, e.g. 8.'
          : undefined,
      );
    }
  }
  const keyframes = integer('keyframes', 4, SPIN_STEPS, 36);
  const precision = integer('precision', 0, 10, 1);
  if (issues.length > 0) return { resolved: undefined, issues };
  return { resolved: { axis, duration, keyframes, direction, precision }, issues };
}

/** The view rotation after turning `degrees` about `axis`. */
function turned(s: NormalizedScene, axis: 'x' | 'y' | 'z', degrees: number): Vec3 {
  return { ...s.rotate, [axis]: s.rotate[axis] + degrees };
}

/**
 * How a flat shape faces the viewer through the turn. The depth component of
 * its front normal is `a cos θ + b sin θ + c` for a turn of θ degrees, since
 * the turning angle enters one rotation about one axis; `length` is the
 * normal's length, which the turn does not change.
 */
export interface Facing {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly length: number;
}

/**
 * The facing function of a piece, from its normals at turns of 0, 90 and 180
 * degrees. Undefined for pieces that look the same from both sides.
 */
export function facingOf(at0: Piece, at90: Piece, at180: Piece): Facing | undefined {
  if (at0.backface === true || !at0.normal || !at90.normal || !at180.normal) return undefined;
  const f0 = at0.normal.z;
  const f90 = at90.normal.z;
  const f180 = at180.normal.z;
  const c = (f0 + f180) / 2;
  return { a: (f0 - f180) / 2, b: f90 - c, c, length: Math.hypot(at0.normal.x, at0.normal.y, f0) };
}

/** Whether the front faces the viewer after a turn of `degrees`, by the rule of `facesViewer`. */
export function facingAt(f: Facing, degrees: number): boolean {
  const t = (degrees * Math.PI) / 180;
  return f.a * Math.cos(t) + f.b * Math.sin(t) + f.c > FACING_EPSILON * f.length;
}

/**
 * The turns, as fractions in [0, 1), at which the front's depth component
 * changes sign: the solutions of `a cos θ + b sin θ + c = 0`, found in closed
 * form. None when it never changes sign (always in front, always turned away,
 * or touching zero at one angle only).
 */
export function facingTurns(f: Facing): number[] {
  const r = Math.hypot(f.a, f.b);
  if (r <= FACING_EPSILON * f.length) return [];
  const k = -f.c / r;
  if (!(k > -1 && k < 1)) return [];
  const phi = Math.atan2(f.b, f.a);
  const delta = Math.acos(k);
  const turn = (t: number) => {
    const u = t / (2 * Math.PI);
    return u - Math.floor(u);
  };
  return [turn(phi - delta), turn(phi + delta)].sort((x, y) => x - y);
}

/** The part of a turn, in steps, given to the still picture's sides when a shape turns at angle 0. */
const FIRST_FRAME_STEPS = SPIN_STEPS * 1e-6;

/** Turns closer than this, in steps, are one boundary. */
const SAME_STEP = 1e-9;

/**
 * Cuts one turn into epochs, each with one paint order that agrees with every
 * overlapping pair for its whole length, and one side shown by every piece.
 *
 * The turn is checked every half degree, and also at the exact angles where
 * a flat shape with a `backface` option turns edge-on, found in closed form
 * (see {@link facingTurns}); a shape with `backface: false` takes part in the
 * depth sort only while its front faces the viewer.
 *
 * The first epoch starts with the still renderer's order at angle 0. An order
 * is kept for as long as it stays valid (hysteresis). When it breaks, the
 * next order is chosen to satisfy the constraints of as many of the coming
 * steps as possible at once, and among such orders the one closest to the
 * previous order. Taking the longest valid stretch each time gives the
 * fewest epochs for the given steps.
 */
export function planSpin(
  s: NormalizedScene,
  options: Pick<ResolvedSpinOptions, 'axis' | 'direction'>,
): Epoch[] {
  const sign = options.direction === 'negative' ? -1 : 1;
  const compileAt = (step: number) =>
    compilePieces(s, turned(s, options.axis, (sign * step * 360) / SPIN_STEPS));
  const first = compileAt(0);
  const quarter = compileAt(SPIN_STEPS / 4);
  const half = compileAt(SPIN_STEPS / 2);
  const count = first.length;

  // Pieces that show a different side from behind, and when they turn.
  const facings = first.map((p, i) => facingOf(p, quarter[i] as Piece, half[i] as Piece));
  const boundaries: number[] = [];
  for (let step = 0; step < SPIN_STEPS; step++) boundaries.push(step);
  for (const f of facings) {
    if (f) for (const t of facingTurns(f)) boundaries.push(t * SPIN_STEPS);
  }
  boundaries.sort((x, y) => x - y);
  const starts: number[] = [];
  for (const b of boundaries) {
    const last = starts[starts.length - 1];
    if (last !== undefined && b - last < SAME_STEP) continue;
    if (b > SPIN_STEPS - SAME_STEP) continue;
    starts.push(b);
  }
  const sideAt = (i: number, step: number, front?: boolean): Side => {
    const f = facings[i];
    const p = first[i] as Piece;
    if (!f) return 'front';
    const facing = front ?? facingAt(f, (step * 360) / SPIN_STEPS);
    return facing ? 'front' : p.backface === false ? 'hidden' : 'back';
  };
  // Without such pieces, every piece shows its front all the time.
  const turning = facings.some((f) => f !== undefined);
  const allFront = first.map((): Side => 'front');
  const sidesAt = (step: number): Side[] =>
    turning ? first.map((_, i) => sideAt(i, step)) : allFront;
  const segmentSides = starts.map((start, k) =>
    sidesAt((start + (starts[k + 1] ?? SPIN_STEPS)) / 2),
  );
  // The first epoch must show what the still renderer draws at angle 0. If a
  // shape turns exactly there, its sides at angle 0 are kept for a moment.
  const still = first.map((p, i) => sideAt(i, 0, p.front));
  if (!sameSides(still, segmentSides[0] as Side[])) {
    if ((starts[1] ?? SPIN_STEPS) > FIRST_FRAME_STEPS) {
      starts.splice(1, 0, FIRST_FRAME_STEPS);
      segmentSides.unshift(still);
    } else {
      segmentSides[0] = still;
    }
  }

  const steps: { order: number[]; constraints: [number, number][]; key: string }[] = starts.map(
    (start, k) => {
      const sides = segmentSides[k] as Side[];
      // Whole steps reuse their compiled pieces; a stretch that starts where
      // a shape turns is checked in its middle, where every shape it shows
      // has some area.
      const pieces =
        start === 0
          ? first
          : compileAt(
              Number.isInteger(start) ? start : (start + (starts[k + 1] ?? SPIN_STEPS)) / 2,
            );
      return {
        ...paintConstraints(turning ? withSides(pieces, sides) : pieces),
        key: turning ? sides.join() : '',
      };
    },
  );
  const satisfies = (position: readonly number[], step: number) =>
    (steps[step] as (typeof steps)[number]).constraints.every(
      ([a, b]) => (position[a] as number) < (position[b] as number),
    );

  const epochs: Epoch[] = [];
  let order = (steps[0] as (typeof steps)[number]).order;
  let step = 0;
  const total = steps.length;
  while (step < total) {
    const here = steps[step] as (typeof steps)[number];
    // An epoch that ended only because a shape turned keeps its order.
    const kept = step > 0 && here.key !== steps[step - 1]?.key && satisfies(positions(order), step);
    if (step > 0 && !kept) {
      // Grow a window of upcoming steps while one order can satisfy them all.
      const previous = positions(order);
      const seen = new Set<number>();
      const window: [number, number][] = [];
      let best = order;
      for (let k = step; k < total; k++) {
        const added = (steps[k] as (typeof steps)[number]).constraints.filter(
          ([a, b]) => !seen.has(a * count + b),
        );
        if (added.length === 0 && k > step) continue;
        const candidate = closestOrder(count, window.concat(added), previous);
        if (!candidate) break;
        for (const [a, b] of added) {
          seen.add(a * count + b);
          window.push([a, b]);
        }
        best = candidate;
      }
      order = best;
    }
    const position = positions(order);
    let end = step + 1;
    while (end < total && steps[end]?.key === here.key && satisfies(position, end)) end++;
    epochs.push({
      start: starts[step] as number,
      end: starts[end] ?? SPIN_STEPS,
      order,
      sides: segmentSides[step] as Side[],
    });
    step = end;
  }
  return epochs;
}

/** The pieces with their culling set by `sides`, for the depth sort. */
function withSides(pieces: readonly Piece[], sides: readonly Side[]): Piece[] {
  return pieces.map((p, i) => {
    const side = sides[i];
    const culled = side === 'hidden';
    const front = side === 'front';
    if (p.backface === true || (p.culled === culled && p.front === front)) return p;
    return { ...p, culled, front };
  });
}

function sameSides(a: readonly Side[], b: readonly Side[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * A topological order of `count` items that satisfies `constraints` and,
 * among the free choices, keeps items in their `preferred` positions.
 * Undefined when the constraints form a cycle.
 */
function closestOrder(
  count: number,
  constraints: readonly (readonly [number, number])[],
  preferred: readonly number[],
): number[] | undefined {
  const after: number[][] = Array.from({ length: count }, () => []);
  const blockers = new Array<number>(count).fill(0);
  for (const [a, b] of constraints) {
    (after[a] as number[]).push(b);
    blockers[b] = (blockers[b] as number) + 1;
  }
  const placed = new Array<boolean>(count).fill(false);
  const order: number[] = [];
  const rank = (i: number) => preferred[i] ?? i;
  while (order.length < count) {
    let pick = -1;
    for (let i = 0; i < count; i++) {
      if (placed[i] || blockers[i] !== 0) continue;
      if (pick < 0 || rank(i) < rank(pick)) pick = i;
    }
    if (pick < 0) return undefined;
    placed[pick] = true;
    order.push(pick);
    for (const next of after[pick] as number[]) blockers[next] = (blockers[next] as number) - 1;
  }
  return order;
}

/** Whether a piece is a single point in 3D, which is the same at every angle. */
function isDot(g: PathGeometry): boolean {
  const s = g.start;
  return controlPoints(g).every((q) => q.x === s.x && q.y === s.y && q.z === s.z);
}

/** Placeholder for the id prefix, replaced once the content is known. */
const PREFIX = '\u0001';

function spinToSvg(s: NormalizedScene, o: ResolvedSpinOptions, epochs: readonly Epoch[]): string {
  const n = (value: number) => formatNumber(value, o.precision);
  const at = framesAt(s, o);
  const keyframes: Piece[][] = [];
  for (let k = 0; k < o.keyframes; k++) keyframes.push(at(k / o.keyframes));
  const first = keyframes[0] as Piece[];
  const timing = `dur="${formatNumber(o.duration, 3)}s" repeatCount="indefinite"`;
  /**
   * An attribute's starting value and, if it moves, its animation. `times`
   * are the fractions of the turn at which `values` apply; when omitted the
   * values are evenly spaced.
   */
  const animated = (attribute: string, values: string[], times?: readonly number[]) => {
    const start = values[0] as string;
    if (values.every((v) => v === start)) return { start, animate: '' };
    const keyTimes = times
      ? ` keyTimes="${[...times, 1].map((t) => formatNumber(t, KEY_TIME_DIGITS)).join(';')}"`
      : '';
    return {
      start,
      animate: `<animate attributeName="${attribute}" ${timing}${keyTimes} values="${[...values, start].join(';')}"/>`,
    };
  };

  // A piece that shows its back color is defined twice, with the same
  // geometry and the two colors; one that never shows is not defined.
  const shown = first.map(() => new Set<Side>());
  for (const e of epochs) {
    e.sides.forEach((side, i) => {
      shown[i]?.add(side);
    });
  }
  const ref = (i: number, side: Side) => `${PREFIX}${i}${side === 'back' ? 'b' : ''}`;
  const drawn = new Set<string>();
  const defs: string[] = [];
  const gradients = s.shading === 'soft' ? new Gradients() : undefined;
  const paint = (color: string, soft: SoftKind | undefined) =>
    escapeXml(gradients ? gradients.paint(color, soft) : color);
  /**
   * The paints a piece goes through in one turn, each with the fraction of
   * the turn at which it starts. The gradient of a round side runs across the
   * side on screen, so it turns with a side that is not upright; each one is
   * held from halfway before its keyframe to halfway after. One entry when
   * the paint never changes.
   */
  const paintSteps = (values: string[]): { time: string; paint: string }[] => {
    const count = values.length;
    const steps = [{ time: '0', paint: values[0] as string }];
    for (let k = 1; k <= count; k++) {
      const paint = values[k % count] as string;
      if (paint === steps[steps.length - 1]?.paint) continue;
      steps.push({ time: formatNumber((k - 0.5) / count, KEY_TIME_DIGITS), paint });
    }
    return steps;
  };
  first.forEach((piece, i) => {
    const sides = (['front', 'back'] as const).filter((side) => shown[i]?.has(side));
    if (sides.length === 0) return;
    if (isDot(piece.geometry)) {
      if (piece.stroke <= 0) return;
      const frames = keyframes.map((f) => (f[i] as Piece).geometry);
      const cx = animated(
        'cx',
        frames.map((g) => n(g.start.x)),
      );
      const cy = animated(
        'cy',
        frames.map((g) => n(g.start.y)),
      );
      const animate = cx.animate + cy.animate;
      for (const side of sides) {
        const color = paint(sideColor(piece, side), 'ball');
        const circle = `<circle id="${ref(i, side)}" cx="${cx.start}" cy="${cy.start}" r="${n(piece.stroke / 2)}" fill="${color}"`;
        defs.push(animate === '' ? `${circle}/>` : `${circle}>${animate}</circle>`);
        drawn.add(ref(i, side));
      }
    } else {
      // An outline that depends on the view is not a fixed 3D shape, so
      // straight-line interpolation between keyframes can bend it out of
      // shape; it gets extra keyframes where it would.
      const times = piece.viewDependent
        ? refineTimes(o.keyframes, (f) => (at(f)[i] as Piece).geometry)
        : undefined;
      const frames = times
        ? times.map((t) => (at(t)[i] as Piece).geometry)
        : keyframes.map((f) => (f[i] as Piece).geometry);
      const even = !times || times.length === o.keyframes;
      const d = animated(
        'd',
        frames.map((g) => pathData(g, n)),
        even ? undefined : times,
      );
      // WebKit does not redraw a moving shape that is reached through two
      // levels of <use>, so a piece painted as several shapes repeats its
      // geometry in each of them instead of sharing one definition.
      const moving = (attributes: string, extra = '') =>
        d.animate === '' && extra === ''
          ? `<path d="${d.start}"${attributes}/>`
          : `<path d="${d.start}"${attributes}>${d.animate}${extra}</path>`;
      // A thick line with nothing filled is a tube, painted as several
      // strokes of the same line (see `tubeLayers`).
      const tube = gradients !== undefined && !piece.fill && piece.stroke > 0 && !piece.soft;
      for (const side of sides) {
        const layers = tube ? tubeLayers(sideColor(piece, side)) : undefined;
        if (layers) {
          const strokes = layers.map((layer) => {
            const by = (-layer.shift * piece.stroke) / Math.SQRT2;
            const move = layer.shift === 0 ? '' : ` transform="translate(${n(by)} ${n(by)})"`;
            return moving(
              ` stroke="${escapeXml(layer.color)}" stroke-width="${n(layer.width * piece.stroke)}"${move}`,
            );
          });
          defs.push(
            `<g id="${ref(i, side)}" fill="none" stroke-linecap="round" stroke-linejoin="round">${strokes.join('')}</g>`,
          );
          drawn.add(ref(i, side));
          continue;
        }
        const steps = paintSteps(
          keyframes.map((f) => paint(sideColor(piece, side), (f[i] as Piece).soft)),
        );
        const outline =
          piece.stroke > 0
            ? ` stroke-width="${n(piece.stroke)}" stroke-linecap="round" stroke-linejoin="round"`
            : '';
        const painted = (color: string) =>
          ` fill="${piece.fill ? color : 'none'}"${piece.stroke > 0 ? ` stroke="${color}"` : ''}`;
        if (steps.length === 1) {
          const attributes = `${painted((steps[0] as { paint: string }).paint)}${outline}`;
          defs.push(
            d.animate === ''
              ? `<path id="${ref(i, side)}" d="${d.start}"${attributes}/>`
              : `<path id="${ref(i, side)}" d="${d.start}"${attributes}>${d.animate}</path>`,
          );
        } else {
          // A paint that points to a gradient cannot be animated, so the
          // outline is drawn once per gradient and shown one at a time.
          const shows = [...new Set(steps.map((step) => step.paint))].map((color) => {
            const values = steps.map((step) => (step.paint === color ? 'visible' : 'hidden'));
            return moving(
              `${painted(color)} visibility="${values[0]}"`,
              `<animate attributeName="visibility" ${timing} calcMode="discrete" keyTimes="${steps.map((step) => step.time).join(';')}" values="${values.join(';')}"/>`,
            );
          });
          defs.push(`<g id="${ref(i, side)}"${outline}>${shows.join('')}</g>`);
        }
        drawn.add(ref(i, side));
      }
    }
  });

  // The turn ends where it started, so a last epoch with the same order as
  // the first is the same group, shown again.
  const groups: {
    intervals: [number, number][];
    order: readonly number[];
    sides: readonly Side[];
  }[] = epochs.map((e) => ({
    intervals: [[e.start, e.end]],
    order: e.order,
    sides: e.sides,
  }));
  const head = groups[0];
  const tail = groups[groups.length - 1];
  if (
    head &&
    tail &&
    groups.length > 1 &&
    sameOrder(head.order, tail.order) &&
    sameSides(head.sides, tail.sides)
  ) {
    head.intervals.push(...tail.intervals);
    groups.pop();
  }
  // Epochs that end where a shape turns edge-on end between whole steps, and
  // their times keep one more digit (a few ten-thousandths of a degree).
  const exact = epochs.some((e) => !Number.isInteger(e.start));
  const time = (step: number) => formatNumber(step / SPIN_STEPS, exact ? 6 : 5);
  const body = groups.map(({ intervals, order, sides }) => {
    const uses = order
      .filter((i) => sides[i] !== 'hidden' && drawn.has(ref(i, sides[i] as Side)))
      .map((i) => `<use href="#${ref(i, sides[i] as Side)}"/>`)
      .join('');
    if (groups.length === 1) return `<g>${uses}</g>`;
    const keyTimes: string[] = [];
    const values: string[] = [];
    let visible = false;
    const set = (step: number, value: boolean) => {
      if (keyTimes.length > 0 && value === visible) return;
      const t = time(step);
      if (keyTimes.length > 0 && t === keyTimes[keyTimes.length - 1]) {
        // Two changes that round to the same time: the later one wins.
        keyTimes.pop();
        values.pop();
        visible = values.length > 0 ? values[values.length - 1] === 'visible' : false;
        if (keyTimes.length > 0 && value === visible) return;
      }
      keyTimes.push(t);
      values.push(value ? 'visible' : 'hidden');
      visible = value;
    };
    if ((intervals[0] as [number, number])[0] > 0) set(0, false);
    for (const [start, end] of intervals) {
      set(start, true);
      if (end < SPIN_STEPS) set(end, false);
    }
    const initial = values[0] as string;
    return (
      `<g visibility="${initial}"><animate attributeName="visibility" ${timing} calcMode="discrete" keyTimes="${keyTimes.join(';')}" values="${values.join(';')}"/>` +
      `${uses}</g>`
    );
  });

  const w = n(s.width);
  const h = n(s.height);
  const lines: string[] = [];
  const label = s.title === undefined ? '' : ` role="img" aria-label="${escapeXml(s.title)}"`;
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"${label}>`,
  );
  if (s.title !== undefined) lines.push(`<title>${escapeXml(s.title)}</title>`);
  if (s.background !== undefined) {
    lines.push(`<rect width="100%" height="100%" fill="${escapeXml(s.background)}"/>`);
  }
  lines.push('<defs>', ...(gradients?.defs() ?? []), ...defs, '</defs>', ...body, '</svg>');
  const text = `${lines.join('\n')}\n`;
  // Ids are prefixed with a hash of the content, so that different
  // animations inlined in one HTML page do not refer to each other's shapes.
  const prefix = `z${hash(text)}-`;
  return text
    .replaceAll(`id="${PREFIX}`, `id="${prefix}`)
    .replaceAll(`href="#${PREFIX}`, `href="#${prefix}`);
}

/** Digits kept in key times (fractions of the turn). */
const KEY_TIME_DIGITS = 6;

/**
 * How far, in pixels, an interpolated outline may stray from the exact one
 * before a view-dependent piece gets an extra keyframe.
 */
export const SPIN_TOLERANCE = 0.5;

/** The shortest gap between key times: a little over 0.004 degrees. */
const MIN_KEY_GAP = 10 ** -(KEY_TIME_DIGITS - 1) * 1.2;

/** Compiles the scene at a fraction of the turn, remembering every result. */
function framesAt(s: NormalizedScene, o: ResolvedSpinOptions): (fraction: number) => Piece[] {
  const sign = o.direction === 'negative' ? -1 : 1;
  const cache = new Map<number, Piece[]>();
  return (fraction) => {
    let pieces = cache.get(fraction);
    if (!pieces) {
      pieces = compilePieces(s, turned(s, o.axis, sign * fraction * 360));
      cache.set(fraction, pieces);
    }
    return pieces;
  };
}

/**
 * Key times (fractions of the turn, starting at 0) for a piece whose outline
 * depends on the view. Starts from evenly spaced keyframes and splits every
 * interval where the outline drawn by linear interpolation strays more than
 * {@link SPIN_TOLERANCE} from the exact outline, checked at a quarter, half
 * and three quarters of the interval.
 *
 * Where an outline is rebuilt from different points (when a round surface's
 * axis points straight at the viewer, its outline starts at a point that
 * jumps to the opposite side), splitting confines the jump to an interval of
 * a few thousandths of a degree.
 */
export function refineTimes(keyframes: number, at: (fraction: number) => PathGeometry): number[] {
  const times: number[] = [];
  const refine = (from: number, to: number) => {
    times.push(from);
    if (to - from >= 2 * MIN_KEY_GAP) {
      const a = at(from);
      const b = at(to % 1);
      for (const t of [0.5, 0.25, 0.75]) {
        const exact = at(from + (to - from) * t);
        if (outlineDistance(lerpGeometry(a, b, t), exact) > SPIN_TOLERANCE) {
          const middle = (from + to) / 2;
          times.pop();
          refine(from, middle);
          refine(middle, to);
          return;
        }
      }
    }
  };
  for (let k = 0; k < keyframes; k++) refine(k / keyframes, (k + 1) / keyframes);
  return times;
}

/** Linear interpolation between two outlines with the same commands. */
export function lerpGeometry(a: PathGeometry, b: PathGeometry, t: number): PathGeometry {
  return {
    start: lerp(a.start, b.start, t),
    segments: a.segments.map((s, i): Segment => {
      const e = b.segments[i] as Segment;
      if (s.kind === 'line' || e.kind === 'line') return { kind: 'line', to: lerp(s.to, e.to, t) };
      return {
        kind: 'bezier',
        c1: lerp(s.c1, e.c1, t),
        c2: lerp(s.c2, e.c2, t),
        to: lerp(s.to, e.to, t),
      };
    }),
    closed: a.closed,
  };
}

/**
 * How far apart two outlines are on screen, in pixels: the larger of the
 * distance from any point of one to the other (a Hausdorff distance over
 * points sampled along both).
 */
export function outlineDistance(a: PathGeometry, b: PathGeometry): number {
  const pa = flatten(a);
  const pb = flatten(b);
  const reach = (from: readonly Vec3[], to: readonly Vec3[], closed: boolean) => {
    let worst = 0;
    for (const p of from) {
      let best = Number.POSITIVE_INFINITY;
      const count = closed ? to.length : to.length - 1;
      for (let i = 0; i < Math.max(1, count); i++) {
        const q = to[i] as Vec3;
        const r = (to[(i + 1) % to.length] ?? q) as Vec3;
        best = Math.min(best, distanceToSegment(p, q, r));
      }
      worst = Math.max(worst, best);
    }
    return worst;
  };
  return Math.max(reach(pa, pb, b.closed), reach(pb, pa, a.closed));
}

function distanceToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function pathData(g: PathGeometry, n: (value: number) => string): string {
  let d = `M${n(g.start.x)} ${n(g.start.y)}`;
  for (const seg of g.segments) {
    d +=
      seg.kind === 'line'
        ? `L${n(seg.to.x)} ${n(seg.to.y)}`
        : `C${n(seg.c1.x)} ${n(seg.c1.y)} ${n(seg.c2.x)} ${n(seg.c2.y)} ${n(seg.to.x)} ${n(seg.to.y)}`;
  }
  return g.closed ? `${d}Z` : d;
}

/** The color a piece is drawn in when it shows `side`. */
function sideColor(p: Piece, side: Side): string {
  return side === 'back' && typeof p.backface === 'string' ? p.backface : p.color;
}

function sameOrder(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** FNV-1a, as four base-36 digits. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 36 ** 4).toString(36).padStart(4, '0');
}
