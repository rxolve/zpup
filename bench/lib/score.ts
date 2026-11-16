/**
 * Checks a model's reply for each condition. The rules are the benchmark's
 * definition of "valid"; see bench/README.md. Validity says nothing about how
 * good the picture is.
 */
import { SaxesParser } from 'saxes';
import {
  checkScene,
  checkSceneWarnings,
  compileScene,
  frameToSvg,
  renderSvg,
  type Scene,
  type ValidationIssue,
} from '../../src/index.ts';
import type { Condition, Score } from './types.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Elements that paint something when they appear in the rendered tree. */
const DRAWABLE = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'image',
  'use',
  'foreignObject',
]);

/** Containers whose contents are not painted where they appear. */
const NOT_RENDERED = new Set([
  'defs',
  'symbol',
  'clipPath',
  'mask',
  'pattern',
  'marker',
  'linearGradient',
  'radialGradient',
  'filter',
  'metadata',
  'title',
  'desc',
  'style',
  'script',
]);

const MAX_PARSE_ERRORS = 5;

export interface Extracted {
  text: string;
  fenced: boolean;
}

/**
 * Takes the document out of a reply. Both conditions get the same treatment:
 * surrounding whitespace is dropped and, if the reply contains a Markdown code
 * fence, the first fenced block is used.
 */
export function extractDocument(reply: string): Extracted {
  const fence = /```[^\n`]*\n([\s\S]*?)\n?```/.exec(reply);
  if (fence?.[1] !== undefined) return { text: fence[1].trim(), fenced: true };
  return { text: reply.trim(), fenced: false };
}

export function scoreReply(
  condition: Condition,
  reply: string,
  options: { canvas: { width: number; height: number }; rotationOffsetsDeg: number[] },
): Score {
  const { text, fenced } = extractDocument(reply);
  const score = condition === 'svg' ? scoreSvg(text, options.canvas) : scoreZpup(text, options);
  if (fenced) score.warnings.unshift('The reply was wrapped in a Markdown code fence.');
  return score;
}

export function scoreSvg(text: string, canvas: { width: number; height: number }): Score {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (text === '') {
    return { valid: false, problems: ['The reply is empty.'], warnings };
  }

  const parser = new SaxesParser({ xmlns: true, position: true });
  let root: { local: string; uri: string; attributes: Record<string, string> } | undefined;
  const stack: string[] = [];
  let hidden = 0;
  let drawable = 0;
  let parseErrors = 0;

  parser.on('error', (error) => {
    parseErrors++;
    if (parseErrors <= MAX_PARSE_ERRORS) problems.push(`XML parse error: ${error.message}`);
  });
  parser.on('opentag', (tag) => {
    if (stack.length === 0 && root === undefined) {
      const attributes: Record<string, string> = {};
      for (const [name, attr] of Object.entries(tag.attributes)) attributes[name] = attr.value;
      root = { local: tag.local, uri: tag.uri, attributes };
    }
    if (NOT_RENDERED.has(tag.local)) hidden++;
    else if (hidden === 0 && DRAWABLE.has(tag.local)) drawable++;
    stack.push(tag.local);
  });
  parser.on('closetag', (tag) => {
    stack.pop();
    if (NOT_RENDERED.has(tag.local)) hidden--;
  });

  try {
    parser.write(text).close();
  } catch (error) {
    // saxes reports through the error handler; this catches anything it throws anyway.
    problems.push(`XML parse error: ${(error as Error).message}`);
    parseErrors++;
  }
  if (parseErrors > MAX_PARSE_ERRORS) {
    problems.push(`(${parseErrors - MAX_PARSE_ERRORS} more XML parse errors not shown)`);
  }

  if (root === undefined) {
    if (parseErrors === 0) problems.push('The document has no root element; expected <svg>.');
  } else if (root.local !== 'svg') {
    problems.push(`The root element is <${root.local}>; expected <svg>.`);
  } else {
    if (root.uri !== SVG_NS) {
      warnings.push(
        `The root <svg> is not in the SVG namespace (xmlns="${SVG_NS}"), so browsers will not show it as an image file.`,
      );
    }
    const size = svgSize(root.attributes);
    if (size && (size.width !== canvas.width || size.height !== canvas.height)) {
      warnings.push(
        `The size is ${size.width}x${size.height}, not the requested ${canvas.width}x${canvas.height}.`,
      );
    }
  }
  if (parseErrors === 0 && root?.local === 'svg' && drawable === 0) {
    problems.push(
      `The SVG draws nothing: it has no ${[...DRAWABLE].join(', ')} element outside <defs> and similar containers.`,
    );
  }

  const valid = problems.length === 0;
  return valid ? { valid, problems, warnings, svg: text } : { valid, problems, warnings };
}

function svgSize(
  attributes: Record<string, string>,
): { width: number; height: number } | undefined {
  const width = Number.parseFloat(attributes.width ?? '');
  const height = Number.parseFloat(attributes.height ?? '');
  if (Number.isFinite(width) && Number.isFinite(height)) return { width, height };
  const box = (attributes.viewBox ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box.length === 4 && box.every(Number.isFinite)) {
    return { width: box[2] as number, height: box[3] as number };
  }
  return undefined;
}

export function scoreZpup(
  text: string,
  options: { canvas: { width: number; height: number }; rotationOffsetsDeg: number[] },
): Score {
  const warnings: string[] = [];
  if (text === '') return { valid: false, problems: ['The reply is empty.'], warnings };

  let scene: unknown;
  try {
    scene = JSON.parse(text);
  } catch (error) {
    return { valid: false, problems: [`JSON parse error: ${(error as Error).message}`], warnings };
  }

  const issues = checkScene(scene);
  if (issues.length > 0) {
    return { valid: false, problems: issues.map((i) => i.message), warnings };
  }

  const valid = scene as Scene;
  let svg: string;
  let items: number;
  try {
    const frame = compileScene(valid);
    items = frame.items.length;
    svg = frameToSvg(frame);
  } catch (error) {
    return { valid: false, problems: [`Rendering failed: ${(error as Error).message}`], warnings };
  }
  // The same rule as for SVG: a document that draws nothing is not a drawing.
  if (items === 0) {
    return {
      valid: false,
      problems: ['The scene draws nothing: it has no visible shape.'],
      warnings,
    };
  }
  if (valid.width !== options.canvas.width || valid.height !== options.canvas.height) {
    warnings.push(
      `The size is ${valid.width}x${valid.height}, not the requested ${options.canvas.width}x${options.canvas.height}.`,
    );
  }

  const rotations = options.rotationOffsetsDeg.map((offsetDeg) => {
    const turned = structuredClone(valid);
    turned.rotate = { ...turned.rotate, y: (turned.rotate?.y ?? 0) + offsetDeg };
    try {
      return { offsetDeg, svg: renderSvg(turned) };
    } catch (error) {
      return { offsetDeg, error: (error as Error).message };
    }
  });
  const sceneWarnings = checkSceneWarnings(valid).map((issue) => ({
    kind: warningKind(issue),
    message: issue.message,
  }));
  return { valid: true, problems: [], warnings, sceneWarnings, svg, rotations };
}

/** A short name for each kind of warning `checkSceneWarnings` gives, for counting. */
export function warningKind(issue: ValidationIssue): string {
  if (issue.expected.startsWith('an angle in degrees')) return 'angles look like radians';
  if (issue.expected.startsWith('a shape at least partly inside')) return 'shape off screen';
  if (issue.expected.startsWith('at least one visible shape')) return 'nothing drawn';
  if (issue.expected.startsWith('a color that can be shaded')) return 'solid cannot be shaded';
  return issue.expected.replace(/\d+(\.\d+)?/g, 'N').slice(0, 80);
}
