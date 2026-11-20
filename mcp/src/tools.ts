/**
 * The work behind each tool, kept apart from the protocol so it can be called
 * and tested directly. Every function takes the tool's arguments and returns
 * what the tool answers: text and pictures, or an error the model can act on.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute } from 'node:path';
import {
  checkScene,
  checkSceneWarnings,
  compileScene,
  renderSpinSvg,
  renderSvg,
  type Scene,
  type SpinOptions,
  type ValidationIssue,
  ZpupValidationError,
} from '@zpup/core';
import { applyChanges, type Change, ChangeError } from './changes.ts';
import { svgToPng } from './png.ts';
import { readReference } from './reference.ts';

export type Content =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: 'image/png' };

export interface ToolResult {
  [key: string]: unknown;
  content: Content[];
  isError?: boolean;
}

/** A view angle in degrees, used in place of the scene's own `rotate`. */
export interface View {
  x?: number | undefined;
  y?: number | undefined;
  z?: number | undefined;
}

/**
 * What the server keeps between calls: the last scene that was valid, so the
 * next call can leave the scene out or send only what changes.
 */
export interface Memory {
  scene?: Scene | undefined;
}

export interface RenderSceneArgs {
  scene?: unknown;
  changes?: Change[] | undefined;
  views?: View[] | undefined;
  svg?: boolean | undefined;
  preview_size?: number | undefined;
  save_to?: string | undefined;
}

export interface RenderSpinArgs {
  scene?: unknown;
  changes?: Change[] | undefined;
  axis?: 'x' | 'y' | 'z' | undefined;
  duration?: number | undefined;
  keyframes?: number | undefined;
  direction?: 'positive' | 'negative' | undefined;
  preview_frames?: number | undefined;
  preview_size?: number | undefined;
  save_to?: string | undefined;
}

/** SVG text longer than this is not sent back inline; it has to be saved to a file. */
export const INLINE_SVG_LIMIT = 30_000;

const DEFAULT_PREVIEW = 512;
/** Pictures along a turn are smaller by default, since several come back at once. */
const DEFAULT_TURN_PREVIEW = 256;
const DEFAULT_TURN_FRAMES = 4;

const text = (t: string): Content => ({ type: 'text', text: t });
const failure = (t: string): ToolResult => ({ content: [text(t)], isError: true });

/** Accepts the scene as an object or as JSON text, which is how some models send it. */
function readScene(input: unknown): { scene: unknown } | { error: string } {
  if (typeof input !== 'string') return { scene: input };
  try {
    return { scene: JSON.parse(input) };
  } catch (e) {
    return { error: `scene: the text is not valid JSON (${(e as Error).message}).` };
  }
}

function list(issues: readonly ValidationIssue[]): string {
  return issues.map((i) => `- ${i.message}`).join('\n');
}

/** The scene's problems as an error result, or nothing when it is valid. */
function invalid(scene: unknown, changed: boolean): ToolResult | undefined {
  const issues = checkScene(scene);
  if (issues.length === 0) return undefined;
  const n = issues.length === 1 ? '1 problem' : `${issues.length} problems`;
  const what = changed
    ? `With these changes the scene has ${n}. Nothing was changed or drawn: the remembered scene is as it was. Fix the changes and send all of them again.`
    : `The scene has ${n}. Nothing was drawn. Fix them and call again.`;
  return failure(`${what}\n\n${list(issues)}`);
}

const NO_SCENE =
  'scene: there is no scene yet. Pass scene. Once a scene is valid the server remembers it, and later calls can leave scene out or pass changes.';

/**
 * The scene a call is about: the one it sends, or the remembered one, with the
 * call's changes applied. A valid result is remembered; an invalid one leaves
 * the memory as it was.
 */
function resolve(
  args: { scene?: unknown; changes?: Change[] | undefined },
  memory: Memory,
): { scene: Scene; note: string } | { error: ToolResult } {
  let base: unknown;
  const sent = args.scene !== undefined;
  if (sent) {
    const read = readScene(args.scene);
    if ('error' in read) return { error: failure(read.error) };
    base = read.scene;
  } else if (memory.scene === undefined) {
    return { error: failure(NO_SCENE) };
  } else {
    base = memory.scene;
  }

  const changes = args.changes ?? [];
  if (changes.length > 0) {
    try {
      base = applyChanges(base, changes);
    } catch (e) {
      if (!(e instanceof ChangeError)) throw e;
      const kept = sent ? '' : ' The remembered scene is as it was.';
      return { error: failure(`${e.message}\nNothing was changed or drawn.${kept}`) };
    }
  }
  const bad = invalid(base, changes.length > 0);
  if (bad) return { error: bad };

  memory.scene = base as Scene;
  const n = changes.length === 1 ? '1 change' : `${changes.length} changes`;
  const note =
    changes.length > 0
      ? `Applied ${n} to the ${sent ? 'scene' : 'remembered scene'}. `
      : sent
        ? ''
        : 'Used the remembered scene. ';
  return { scene: base as Scene, note };
}

function warningsOf(scenes: readonly Scene[]): string[] {
  const seen = new Set<string>();
  for (const s of scenes) for (const w of checkSceneWarnings(s)) seen.add(w.message);
  return [...seen];
}

function warningText(warnings: readonly string[]): string {
  if (warnings.length === 0) return '';
  const n = warnings.length === 1 ? '1 warning' : `${warnings.length} warnings`;
  return `\n\n${n} (the scene is valid, but these are probably not intended):\n${warnings.map((w) => `- ${w}`).join('\n')}`;
}

function kb(chars: number): string {
  return chars < 1000 ? `${chars} B` : `${(chars / 1000).toFixed(1)} KB`;
}

/**
 * How much empty space is left around what a scene draws, and where it is cut
 * off, so a model can center the picture without guessing. Curves are measured
 * by their control points, which is at most a little generous.
 */
export function framing(scene: Scene): string {
  const frame = compileScene(scene);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const reach = (x: number, y: number, r: number) => {
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  };
  for (const item of frame.items) {
    if (item.kind === 'dot') {
      reach(item.x, item.y, item.radius);
      continue;
    }
    const r = item.stroke / 2;
    for (const c of item.commands) {
      if (c.op === 'Z') continue;
      if (c.op === 'C') {
        reach(c.x1, c.y1, r);
        reach(c.x2, c.y2, r);
      }
      reach(c.x, c.y, r);
    }
  }
  if (minX > maxX) return 'Nothing is drawn.';
  const sides = [
    ['left', minX],
    ['right', frame.width - maxX],
    ['top', minY],
    ['bottom', frame.height - maxY],
  ] as const;
  const margins = sides.map(([name, space]) => `${name} ${Math.round(space)}`).join(', ');
  const cut = sides.filter(([, space]) => space < -0.5);
  const cutText =
    cut.length === 0
      ? ''
      : ` It is cut off at the ${cut.map(([name, space]) => `${name} by ${Math.round(-space)}`).join(' and the ')}.`;
  return `Space around the drawing, in pixels: ${margins}.${cutText}`;
}

function viewLabel(v: View): string {
  return `x ${v.x ?? 0}, y ${v.y ?? 0}, z ${v.z ?? 0}`;
}

/** Checks a path to save to. Returns what is wrong with it, or nothing. */
function badPath(path: string, allowed: readonly string[]): string | undefined {
  if (!isAbsolute(path)) return `save_to: expected an absolute path, received "${path}".`;
  const ext = extname(path).toLowerCase();
  if (!allowed.includes(ext)) {
    return `save_to: expected a path ending in ${allowed.join(' or ')}, received "${path}".`;
  }
  return undefined;
}

function numbered(path: string, index: number, count: number): string {
  if (count === 1) return path;
  const ext = extname(path);
  return `${path.slice(0, path.length - ext.length)}-${index + 1}${ext}`;
}

async function save(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

function previewSize(value: number | undefined, fallback = DEFAULT_PREVIEW): number {
  return Math.round(value ?? fallback);
}

/** Runs a tool body and turns a Zpup validation error into an error result. */
async function guarded(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ZpupValidationError) return failure(e.message);
    throw e;
  }
}

/** `check_scene`: every error and warning, without drawing. */
export function checkSceneTool(args: { scene?: unknown }, memory: Memory = {}): ToolResult {
  const found = resolve(args, memory);
  if ('error' in found) return found.error;
  const warnings = warningsOf([found.scene]);
  return {
    content: [text(`${found.note}The scene is valid.${warningText(warnings) || ' No warnings.'}`)],
  };
}

/** `get_scene`: the remembered scene as JSON, with the edits made so far. */
export function getScene(memory: Memory): ToolResult {
  if (memory.scene === undefined) return failure(NO_SCENE);
  return { content: [text(JSON.stringify(memory.scene, null, 2))] };
}

/** `render_scene`: a still picture from one or more angles. */
export function renderScene(args: RenderSceneArgs, memory: Memory = {}): Promise<ToolResult> {
  return guarded(async () => {
    if (args.save_to !== undefined) {
      const wrong = badPath(args.save_to, ['.svg', '.png']);
      if (wrong) return failure(wrong);
    }
    const found = resolve(args, memory);
    if ('error' in found) return found.error;

    const base = found.scene;
    const views = args.views;
    const scenes: Scene[] = views
      ? views.map((v) => ({ ...base, rotate: { x: v.x ?? 0, y: v.y ?? 0, z: v.z ?? 0 } }))
      : [base];
    const size = previewSize(args.preview_size);
    const opaque = base.background !== undefined;

    const svgs = scenes.map((s) => renderSvg(s));
    const previews = svgs.map((s) => svgToPng(s, { size, backdrop: !opaque }));

    const saved: string[] = [];
    if (args.save_to !== undefined) {
      const png = extname(args.save_to).toLowerCase() === '.png';
      for (const [i, svg] of svgs.entries()) {
        const path = numbered(args.save_to, i, svgs.length);
        await save(path, png ? svgToPng(svg, { size, backdrop: false }) : svg);
        saved.push(path);
      }
    }

    const total = svgs.reduce((n, s) => n + s.length, 0);
    const wantSvg = args.svg ?? true;
    const inline = wantSvg && total <= INLINE_SVG_LIMIT;

    const count = svgs.length === 1 ? '1 view' : `${svgs.length} views`;
    let summary = `${found.note}Drew ${count} of a ${base.width}x${base.height} scene. SVG: ${kb(total)} in all.`;
    if (saved.length > 0) summary += `\nSaved: ${saved.join(', ')}`;
    if (wantSvg && !inline) {
      summary += `\nThe SVG is too long to send back here (over ${kb(INLINE_SVG_LIMIT)}). Pass save_to to write it to a file.`;
    }
    if (!views) summary += `\n${framing(base)}`;
    summary += warningText(warningsOf(scenes));

    const content: Content[] = [text(summary)];
    for (const [i, png] of previews.entries()) {
      if (views) {
        content.push(
          text(`View ${i + 1}: ${viewLabel(views[i] as View)}. ${framing(scenes[i] as Scene)}`),
        );
      }
      content.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' });
      if (inline) content.push(text(svgs[i] as string));
    }
    return { content };
  });
}

/** `render_spin`: an SVG that turns the scene forever, with stills along the turn to look at. */
export function renderSpin(args: RenderSpinArgs, memory: Memory = {}): Promise<ToolResult> {
  return guarded(async () => {
    if (args.save_to !== undefined) {
      const wrong = badPath(args.save_to, ['.svg']);
      if (wrong) return failure(wrong);
    }
    const found = resolve(args, memory);
    if ('error' in found) return found.error;

    const scene = found.scene;
    const options: SpinOptions = {};
    if (args.axis !== undefined) options.axis = args.axis;
    if (args.duration !== undefined) options.duration = args.duration;
    if (args.keyframes !== undefined) options.keyframes = args.keyframes;
    if (args.direction !== undefined) options.direction = args.direction;

    const svg = renderSpinSvg(scene, options);

    // Stills at even steps of the turn, so the model sees what the animation
    // shows without being able to play it.
    const frames = Math.round(args.preview_frames ?? DEFAULT_TURN_FRAMES);
    const size = previewSize(
      args.preview_size,
      frames > 1 ? DEFAULT_TURN_PREVIEW : DEFAULT_PREVIEW,
    );
    const axis = args.axis ?? 'y';
    const sign = args.direction === 'negative' ? -1 : 1;
    const start = { x: 0, y: 0, z: 0, ...scene.rotate };
    const turns = Array.from({ length: frames }, (_, i) => (360 / frames) * i);
    const previews = turns.map((turn) =>
      svgToPng(renderSvg({ ...scene, rotate: { ...start, [axis]: start[axis] + sign * turn } }), {
        size,
        backdrop: scene.background === undefined,
      }),
    );

    const shown =
      frames === 1
        ? 'The picture below is its first frame.'
        : `The ${frames} pictures below are stills at even steps of the turn.`;
    let summary = `${found.note}Made a turning SVG of a ${scene.width}x${scene.height} scene: ${kb(svg.length)}. ${shown}`;
    const inline = args.save_to === undefined && svg.length <= INLINE_SVG_LIMIT;
    if (args.save_to !== undefined) {
      await save(args.save_to, svg);
      summary += `\nSaved: ${args.save_to}`;
    } else if (!inline) {
      summary += `\nThe SVG is too long to send back here (over ${kb(INLINE_SVG_LIMIT)}) and was not saved. Call again with save_to to write it to a file.`;
    }
    summary += warningText(warningsOf([scene]));

    const content: Content[] = [text(summary)];
    for (const [i, png] of previews.entries()) {
      if (frames > 1) content.push(text(`${Math.round(turns[i] as number)} degrees into the turn`));
      content.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' });
    }
    if (inline) content.push(text(svg));
    return { content };
  });
}

/** `get_reference`: how to write a scene. */
export function getReference(): ToolResult {
  return { content: [text(readReference())] };
}
