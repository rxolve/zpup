/**
 * Soft shading: balls and the round surfaces of solids are painted with a
 * gradient instead of one flat color, as if lit from the upper left.
 *
 * The gradients are sized by each shape's own bounding box, so one definition
 * serves every shape of the same kind and color, wherever it is and however
 * large. The light is fixed to the picture, not to the scene: a ball looks
 * the same from every side, which is also why a turning picture needs no
 * extra animation for it.
 */
import { parseColor } from './color.ts';
import type { Vec3 } from './math.ts';

/**
 * How a shape is shaded: `ball` for a sphere or a dome, or `side:<degrees>`
 * for the side of a cylinder or cone, where the angle is the direction on
 * screen from its lit edge to its dark edge (0 points right, 90 down).
 */
export type SoftKind = 'ball' | `side:${number}`;

/**
 * The shading of a round side whose axis points along `axis` on screen
 * (only x and y are used). The gradient runs across the side, away from the
 * light, in steps of 15 degrees: fine enough that a side turning with the
 * picture changes direction without a visible jump.
 */
export function sideKind(axis: Vec3): SoftKind {
  const size = Math.hypot(axis.x, axis.y);
  // Seen end-on, the side is a thin rim; any direction will do.
  if (size < 1e-6) return 'side:0';
  // Perpendicular to the axis, turned to point away from the upper left.
  let dx = -axis.y / size;
  let dy = axis.x / size;
  if (dx + dy < 0) {
    dx = -dx;
    dy = -dy;
  }
  const degrees = Math.round((Math.atan2(dy, dx) * 180) / Math.PI / SIDE_STEP) * SIDE_STEP;
  // Away from the upper left runs from -45 to 135; the two ends are the same line.
  return `side:${degrees === -45 ? 135 : degrees === 0 ? 0 : degrees}`;
}

/** `color` moved toward white (positive) or black (negative) by a fraction. */
function tint(c: { r: number; g: number; b: number; a: number }, amount: number): string {
  const mix = (v: number) => Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
  const hex = (v: number) => v.toString(16).padStart(2, '0');
  const out = `#${hex(mix(c.r))}${hex(mix(c.g))}${hex(mix(c.b))}`;
  return c.a < 1 ? `${out}${hex(Math.round(c.a * 255))}` : out;
}

const SIDE_STEP = 15;

/**
 * The gradient vector for a direction in degrees, in bounding-box units:
 * through the middle of the box, long enough to reach its corners.
 */
function gradientVector(degrees: number): string {
  const c = Math.cos((degrees * Math.PI) / 180);
  const s = Math.sin((degrees * Math.PI) / 180);
  const half = (Math.abs(c) + Math.abs(s)) / 2;
  const at = (v: number) => String(Math.round((0.5 + half * v) * 1000) / 1000);
  return `x1="${at(-c)}" y1="${at(-s)}" x2="${at(c)}" y2="${at(s)}"`;
}

/**
 * Collects the gradients a picture uses. `paint` returns what to write in
 * `fill` or `stroke`; `defs` returns the definitions to put in `<defs>`.
 */
export class Gradients {
  private readonly made = new Map<string, string>();

  /**
   * The paint for a shape of the given kind and color. Returns the color
   * itself when there is nothing to shade it with: no kind, or a color that
   * cannot be read as numbers (such as `currentColor`).
   */
  paint(color: string, kind: SoftKind | undefined): string {
    if (kind === undefined) return color;
    const c = parseColor(color);
    if (!c) return color;
    // The id says what the gradient is, so the same id always means the same
    // gradient, also across pictures inlined in one page.
    const base = tint(c, 0).slice(1);
    const id = `zs-${kind === 'ball' ? 'b' : `l${kind.slice(5).replace('-', 'm')}`}-${base}`;
    if (!this.made.has(id)) {
      const stop = (offset: number, amount: number) =>
        `<stop offset="${offset}" stop-color="${tint(c, amount)}"/>`;
      this.made.set(
        id,
        kind === 'ball'
          ? `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5" fx="0.34" fy="0.3">${stop(0, 0.3)}${stop(0.55, 0)}${stop(1, -0.24)}</radialGradient>`
          : `<linearGradient id="${id}" ${gradientVector(Number(kind.slice(5)))}>${stop(0, 0.1)}${stop(0.26, 0.26)}${stop(0.62, 0)}${stop(1, -0.24)}</linearGradient>`,
      );
    }
    return `url(#${id})`;
  }

  defs(): string[] {
    return [...this.made.values()];
  }
}

/** One stroke of a shaded tube: painted over the ones before it. */
export interface TubeLayer {
  readonly color: string;
  /** Stroke width as a share of the tube's. */
  readonly width: number;
  /** How far the stroke is moved toward the light (up and to the left), as a share of the tube's width. */
  readonly shift: number;
}

/**
 * A thick line shaded as a round tube. A gradient cannot follow a line that
 * bends, and a line has no bounding box to size one by, so the tube is
 * painted as several strokes of the same line instead: the full width in a
 * dark tone, then narrower, lighter ones, each moved a little toward the
 * light. The steps are small enough to read as one soft surface. Undefined when the color cannot be read as numbers.
 */
export function tubeLayers(color: string): TubeLayer[] | undefined {
  const c = parseColor(color);
  if (!c) return undefined;
  return TUBE.map(([amount, width, shift]) => ({ color: tint(c, amount), width, shift }));
}

/** Tone, width and shift of each stroke of a tube, back to front. */
const TUBE: readonly (readonly [number, number, number])[] = [
  [-0.22, 1, 0],
  [-0.14, 0.9, 0.04],
  [-0.07, 0.78, 0.08],
  [0, 0.66, 0.12],
  [0.08, 0.52, 0.16],
  [0.16, 0.38, 0.2],
  [0.24, 0.22, 0.24],
];
