import { compileScene, type DrawItem, type Frame, type PathCommand } from './compile.ts';
import type { Scene } from './types.ts';

/** Options for {@link renderSvg}. */
export interface SvgOptions {
  /**
   * Digits kept after the decimal point in coordinates. Lower values give
   * smaller files. Default 2.
   */
  precision?: number;
}

/**
 * Renders a scene to a standalone SVG document string. This is a pure
 * function: it needs no DOM, works on a server, and returns the same string
 * for the same input.
 * @throws {ZpupValidationError} when the scene is invalid.
 */
export function renderSvg(scene: Scene, options: SvgOptions = {}): string {
  return frameToSvg(compileScene(scene), options);
}

/** Renders an already compiled {@link Frame} to an SVG document string. */
export function frameToSvg(frame: Frame, options: SvgOptions = {}): string {
  const precision = options.precision ?? 2;
  if (!Number.isInteger(precision) || precision < 0 || precision > 10) {
    throw new RangeError(
      `precision: expected an integer from 0 to 10, received ${String(precision)}.`,
    );
  }
  const n = (value: number) => formatNumber(value, precision);
  const w = n(frame.width);
  const h = n(frame.height);
  const lines: string[] = [];
  const label =
    frame.title === undefined ? '' : ` role="img" aria-label="${escapeXml(frame.title)}"`;
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"${label}>`,
  );
  if (frame.title !== undefined) lines.push(`<title>${escapeXml(frame.title)}</title>`);
  if (frame.background !== undefined) {
    lines.push(`<rect width="100%" height="100%" fill="${escapeXml(frame.background)}"/>`);
  }
  for (const item of frame.items) lines.push(itemToSvg(item, n));
  lines.push('</svg>');
  return `${lines.join('\n')}\n`;
}

function itemToSvg(item: DrawItem, n: (value: number) => string): string {
  const color = escapeXml(item.color);
  if (item.kind === 'dot') {
    return `<circle cx="${n(item.x)}" cy="${n(item.y)}" r="${n(item.radius)}" fill="${color}"/>`;
  }
  const d = item.commands.map((c) => commandToSvg(c, n)).join('');
  const fill = item.fill ? color : 'none';
  const stroke =
    item.stroke > 0
      ? ` stroke="${color}" stroke-width="${n(item.stroke)}" stroke-linecap="round" stroke-linejoin="round"`
      : '';
  return `<path d="${d}" fill="${fill}"${stroke}/>`;
}

function commandToSvg(c: PathCommand, n: (value: number) => string): string {
  switch (c.op) {
    case 'M':
    case 'L':
      return `${c.op}${n(c.x)} ${n(c.y)}`;
    case 'C':
      return `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`;
    case 'Z':
      return 'Z';
  }
}

/** Formats a number with at most `precision` decimals, no trailing zeros and no negative zero. */
export function formatNumber(value: number, precision = 2): string {
  const factor = 10 ** precision;
  const rounded = Math.round(value * factor) / factor;
  if (Object.is(rounded, -0) || rounded === 0) return '0';
  return String(rounded);
}

/** Escapes text for use in XML content and attribute values. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
