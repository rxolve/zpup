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
 * light, in steps of 45 degrees.
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
  const degrees = Math.round((Math.atan2(dy, dx) * 180) / Math.PI / 45) * 45;
  return `side:${degrees === 0 ? 0 : degrees}`;
}

/** `color` moved toward white (positive) or black (negative) by a fraction. */
function tint(c: { r: number; g: number; b: number; a: number }, amount: number): string {
  const mix = (v: number) => Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
  const hex = (v: number) => v.toString(16).padStart(2, '0');
  const out = `#${hex(mix(c.r))}${hex(mix(c.g))}${hex(mix(c.b))}`;
  return c.a < 1 ? `${out}${hex(Math.round(c.a * 255))}` : out;
}

/** Gradient vectors in bounding-box units, by angle. */
const VECTORS: Readonly<Record<string, string>> = {
  '-45': 'x1="0" y1="1" x2="1" y2="0"',
  '0': 'x1="0" y1="0" x2="1" y2="0"',
  '45': 'x1="0" y1="0" x2="1" y2="1"',
  '90': 'x1="0" y1="0" x2="0" y2="1"',
  '135': 'x1="1" y1="0" x2="0" y2="1"',
};

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
          : `<linearGradient id="${id}" ${VECTORS[kind.slice(5)] ?? VECTORS['0']}>${stop(0, 0.1)}${stop(0.26, 0.26)}${stop(0.62, 0)}${stop(1, -0.24)}</linearGradient>`,
      );
    }
    return `url(#${id})`;
  }

  defs(): string[] {
    return [...this.made.values()];
  }
}
