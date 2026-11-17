import { compileScene, type DrawItem, type Frame, type PathCommand } from './compile.ts';
import {
  closest,
  describe,
  makeIssue,
  type ValidationIssue,
  ZpupValidationError,
} from './errors.ts';
import { Gradients, tubeLayers } from './shading.ts';
import type { Scene } from './types.ts';
import { checkScene } from './validate.ts';

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
 * @throws {ZpupValidationError} when the scene or the options are invalid.
 */
export function renderSvg(scene: Scene, options: SvgOptions = {}): string {
  const issues = svgOptionIssues(options);
  if (issues.length > 0) {
    const sceneIssues = checkScene(scene);
    throw new ZpupValidationError(
      [...sceneIssues, ...issues],
      sceneIssues.length === 0 ? 'SVG options' : 'Zpup scene and SVG options',
    );
  }
  return frameToSvg(compileScene(scene), options);
}

/**
 * Renders an already compiled {@link Frame} to an SVG document string.
 * @throws {ZpupValidationError} when the options are invalid.
 */
export function frameToSvg(frame: Frame, options: SvgOptions = {}): string {
  const issues = svgOptionIssues(options);
  if (issues.length > 0) throw new ZpupValidationError(issues, 'SVG options');
  const precision = options.precision ?? 2;
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
  const gradients = frame.shading === 'soft' ? new Gradients() : undefined;
  const items = frame.items.map((item) => itemToSvg(item, n, gradients));
  const defs = gradients?.defs() ?? [];
  if (defs.length > 0) lines.push('<defs>', ...defs, '</defs>');
  lines.push(...items, '</svg>');
  return `${lines.join('\n')}\n`;
}

const SVG_OPTION_KEYS = ['precision'] as const;

/** Problems with SVG options, in the same form as scene issues (paths such as `options.precision`). */
function svgOptionIssues(options: unknown): ValidationIssue[] {
  if (options === undefined) return [];
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    const expected = 'an options object such as { "precision": 2 }';
    const received = describe(options);
    return [
      makeIssue({
        pathSegments: ['options'],
        expected,
        received,
        detail: `expected ${expected}, received ${received}.`,
      }),
    ];
  }
  const issues: ValidationIssue[] = [];
  const o = options as Record<string, unknown>;
  const allowed = SVG_OPTION_KEYS.map((k) => `"${k}"`).join(', ');
  for (const key of Object.keys(o)) {
    if ((SVG_OPTION_KEYS as readonly string[]).includes(key)) continue;
    const guess = closest(key, SVG_OPTION_KEYS);
    const hint = guess ? `Did you mean "${guess}"?` : 'Remove this option.';
    issues.push(
      makeIssue({
        pathSegments: ['options', key],
        expected: `${allowed} (SVG options)`,
        received: `unknown option "${key}"`,
        hint,
        detail: `unknown option "${key}". ${hint} Allowed: ${allowed}.`,
      }),
    );
  }
  const precision = o.precision;
  if (
    precision !== undefined &&
    !(
      typeof precision === 'number' &&
      Number.isInteger(precision) &&
      precision >= 0 &&
      precision <= 10
    )
  ) {
    const expected = 'an integer from 0 to 10';
    const received = describe(precision);
    const hint =
      typeof precision === 'number' && Number.isFinite(precision) && !Number.isInteger(precision)
        ? `Use a whole number such as ${Math.min(10, Math.max(0, Math.round(precision)))}.`
        : typeof precision === 'string'
          ? 'Use a plain number, e.g. 2.'
          : undefined;
    issues.push(
      makeIssue({
        pathSegments: ['options', 'precision'],
        expected,
        received,
        hint,
        detail: `expected ${expected}, received ${received}.${hint ? ` ${hint}` : ''}`,
      }),
    );
  }
  return issues;
}

function itemToSvg(
  item: DrawItem,
  n: (value: number) => string,
  gradients: Gradients | undefined,
): string {
  const color = escapeXml(gradients ? gradients.paint(item.color, item.soft) : item.color);
  if (item.kind === 'dot') {
    return `<circle cx="${n(item.x)}" cy="${n(item.y)}" r="${n(item.radius)}" fill="${color}"/>`;
  }
  const d = item.commands.map((c) => commandToSvg(c, n)).join('');
  // A thick line with nothing filled is a tube.
  const layers =
    gradients && !item.fill && item.stroke > 0 && item.soft === undefined
      ? tubeLayers(item.color)
      : undefined;
  if (layers) {
    const strokes = layers.map((layer) => {
      const by = (-layer.shift * item.stroke) / Math.SQRT2;
      const move = layer.shift === 0 ? '' : ` transform="translate(${n(by)} ${n(by)})"`;
      return `<path d="${d}" stroke="${escapeXml(layer.color)}" stroke-width="${n(layer.width * item.stroke)}"${move}/>`;
    });
    return `<g fill="none" stroke-linecap="round" stroke-linejoin="round">${strokes.join('')}</g>`;
  }
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
