/**
 * The work behind each tool, kept apart from the protocol so it can be called
 * and tested directly. Every function takes the tool's arguments and returns
 * what the tool answers: text and pictures, or an error the model can act on.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute } from 'node:path';
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
import { svgToExactPng, svgToPng } from './png.ts';
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
  pose?: Change[] | undefined;
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

export interface RenderSpritesArgs {
  scene?: unknown;
  changes?: Change[] | undefined;
  directions?: number | undefined;
  cell_size?: number | undefined;
  columns?: number | undefined;
  poses?: Change[][] | undefined;
  fit?: boolean | undefined;
  preview_direction?: number | undefined;
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
  const box = bounds(scene);
  if (!box) return 'Nothing is drawn.';
  const { minX, maxX, minY, maxY } = box;
  const sides = [
    ['left', minX],
    ['right', scene.width - maxX],
    ['top', minY],
    ['bottom', scene.height - maxY],
  ] as const;
  const margins = sides.map(([name, space]) => `${name} ${Math.round(space)}`).join(', ');
  const cut = sides.filter(([, space]) => space < -0.5);
  const cutText =
    cut.length === 0
      ? ''
      : ` It is cut off at the ${cut.map(([name, space]) => `${name} by ${Math.round(-space)}`).join(' and the ')}.`;
  return `Space around the drawing, in pixels: ${margins}.${cutText}`;
}

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The part of the image a scene draws on, strokes included, or nothing when it draws nothing. */
function bounds(scene: Scene): Box | undefined {
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
  return minX > maxX ? undefined : { minX, maxX, minY, maxY };
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

    const pose = args.pose ?? [];
    const inPose =
      pose.length > 0 ? posed(found.scene, [pose], () => 'pose') : { scenes: [found.scene] };
    if ('error' in inPose) return inPose.error;
    const base = inPose.scenes[0] as Scene;
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
    if (pose.length > 0) {
      summary += `\nDrawn in a pose of ${pose.length === 1 ? '1 change' : `${pose.length} changes`}, which was not remembered: the remembered scene is the scene without it.`;
    }
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

const DEFAULT_DIRECTIONS = 8;
const DEFAULT_CELL = 128;
/** The longer side of the sheet as sent back to look at. */
const SHEET_PREVIEW = 1024;

/** The most poses one sheet takes, and the most cells in all. */
export const MAX_POSES = 16;
export const MAX_SPRITE_CELLS = 128;

/** One sprite's place in the sheet, in pixels. */
interface Cell {
  name: string;
  turn: number;
  /** Which pose, counted from 0. Always 0 when the call has no poses. */
  pose: number;
  /** Which direction, counted from 0. */
  direction: number;
  x: number;
  y: number;
}

function turned(scene: Scene, turn: number): Scene {
  const rotate = scene.rotate ?? {};
  return { ...scene, rotate: { ...rotate, y: (rotate.y ?? 0) + turn } };
}

/** A scene's SVG as a panel of a larger one: placed, sized, and showing `viewBox` of it when given. */
function panel(svg: string, x: number, y: number, w: number, h: number, viewBox?: string): string {
  const placed = svg.replace(
    /^<svg ([^>]*?)width="[^"]*" height="[^"]*"/,
    `<svg x="${x}" y="${y}" $1width="${w}" height="${h}"`,
  );
  return viewBox === undefined
    ? placed
    : placed.replace(/ viewBox="[^"]*"/, ` viewBox="${viewBox}"`);
}

/** How much of the cell a fitted drawing is given: the rest is a margin on each side. */
const FIT_FILL = 0.94;

/**
 * The part of the scene that holds the drawing in every cell, with the
 * proportions of the scene, so that one frame fits all of them.
 */
function fitBox(scenes: readonly Scene[], cells: readonly Cell[], base: Scene): Box | undefined {
  let all: Box | undefined;
  for (const cell of cells) {
    const box = bounds(turned(scenes[cell.pose] as Scene, cell.turn));
    if (!box) continue;
    all = all
      ? {
          minX: Math.min(all.minX, box.minX),
          maxX: Math.max(all.maxX, box.maxX),
          minY: Math.min(all.minY, box.minY),
          maxY: Math.max(all.maxY, box.maxY),
        }
      : box;
  }
  if (!all) return undefined;
  const aspect = base.width / base.height;
  const wide = (all.maxX - all.minX) / FIT_FILL;
  const tall = (all.maxY - all.minY) / FIT_FILL;
  const width = Math.max(wide, tall * aspect, 1e-6);
  const height = width / aspect;
  const cx = (all.minX + all.maxX) / 2;
  const cy = (all.minY + all.maxY) / 2;
  return {
    minX: cx - width / 2,
    maxX: cx + width / 2,
    minY: cy - height / 2,
    maxY: cy + height / 2,
  };
}

const two = (v: number): number => Math.round(v * 100) / 100;

/** The longer side of one cell of the strip a preview_direction asks for, and of the strip. */
const STRIP_CELL = 384;
const STRIP_MAX = 1536;

/**
 * Every cell's scene drawn at its angle, laid out in a grid of cells of `w`
 * by `h` pixels. `scenes` has one scene per pose.
 */
function sheetSvg(
  scenes: readonly Scene[],
  cells: readonly Cell[],
  w: number,
  h: number,
  width: number,
  height: number,
  viewBox?: string,
): string {
  const plain = scenes.map(({ title: _title, background: _background, ...rest }) => rest as Scene);
  const panels = cells.map((cell) =>
    panel(renderSvg(turned(plain[cell.pose] as Scene, cell.turn)), cell.x, cell.y, w, h, viewBox),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${panels.join('\n')}\n</svg>\n`;
}

/**
 * The scene in each pose: the scene with that pose's changes applied. Poses
 * do not build on each other and are not remembered.
 */
function posed(
  base: Scene,
  poses: readonly Change[][],
  label: (i: number) => string = (i) => `poses[${i}]`,
): { scenes: Scene[] } | { error: ToolResult } {
  const scenes: Scene[] = [];
  for (const [i, changes] of poses.entries()) {
    if (changes.length === 0) {
      scenes.push(base);
      continue;
    }
    let scene: unknown;
    try {
      scene = applyChanges(base, changes);
    } catch (e) {
      if (!(e instanceof ChangeError)) throw e;
      return {
        error: failure(
          `${label(i)}: ${e.message}\nNothing was drawn. The remembered scene is as it was, without the pose.`,
        ),
      };
    }
    const issues = checkScene(scene);
    if (issues.length > 0) {
      const n = issues.length === 1 ? '1 problem' : `${issues.length} problems`;
      return {
        error: failure(
          `${label(i)}: with this pose's changes the scene has ${n}. Nothing was drawn. The remembered scene is as it was, without the pose.\n\n${list(issues)}`,
        ),
      };
    }
    scenes.push(scene as Scene);
  }
  return { scenes };
}

/**
 * `render_sprites`: one scene as a sprite sheet, the same thing seen from
 * every side, and in every pose when the call has poses, with the frame list
 * game engines read.
 */
export function renderSprites(args: RenderSpritesArgs, memory: Memory = {}): Promise<ToolResult> {
  return guarded(async () => {
    if (args.save_to !== undefined) {
      const wrong = badPath(args.save_to, ['.png']);
      if (wrong) return failure(wrong);
    }
    const count = Math.round(args.directions ?? DEFAULT_DIRECTIONS);
    const poses = args.poses ?? [];
    const hasPoses = poses.length > 0;
    const poseCount = hasPoses ? poses.length : 1;
    if (poseCount > MAX_POSES) {
      return failure(`poses: at most ${MAX_POSES} poses, received ${poseCount}.`);
    }
    if (count * poseCount > MAX_SPRITE_CELLS) {
      return failure(
        `poses: ${count} directions of ${poseCount} poses is ${count * poseCount} cells, and a sheet takes at most ${MAX_SPRITE_CELLS}. Use fewer directions or fewer poses.`,
      );
    }
    const found = resolve(args, memory);
    if ('error' in found) return found.error;
    const base = found.scene;
    const inPose = hasPoses ? posed(base, poses) : { scenes: [base] };
    if ('error' in inPose) return inPose.error;
    const scenes = inPose.scenes;

    // With poses, a row is one direction and a column is one pose, the layout
    // a walk cycle is read in. Without, the directions fill the rows in turn.
    const columns = hasPoses
      ? poseCount
      : Math.min(count, Math.round(args.columns ?? Math.min(count, 8)));
    const rows = hasPoses ? count : Math.ceil(count / columns);
    const scale = Math.round(args.cell_size ?? DEFAULT_CELL) / Math.max(base.width, base.height);
    const w = Math.max(1, Math.round(base.width * scale));
    const h = Math.max(1, Math.round(base.height * scale));
    const stem = args.save_to === undefined ? 'sprite' : basename(args.save_to, '.png');
    const digits = String(count - 1).length;
    const poseDigits = String(poseCount - 1).length;
    const cells: Cell[] = [];
    for (let d = 0; d < count; d++) {
      const row = `${stem}-${String(d).padStart(digits, '0')}`;
      for (let p = 0; p < poseCount; p++) {
        const i = hasPoses ? d * poseCount + p : d;
        cells.push({
          name: hasPoses ? `${row}-${String(p).padStart(poseDigits, '0')}` : row,
          turn: (360 * d) / count,
          pose: p,
          direction: d,
          x: (i % columns) * w,
          y: Math.floor(i / columns) * h,
        });
      }
    }
    const width = w * columns;
    const height = h * rows;
    const look =
      args.preview_direction === undefined ? undefined : Math.round(args.preview_direction);
    if (look !== undefined && (look < 0 || look >= count)) {
      return failure(
        `preview_direction: expected a direction from 0 to ${count - 1}, received ${args.preview_direction}.`,
      );
    }
    const fitted = args.fit === true ? fitBox(scenes, cells, base) : undefined;
    const viewBox = fitted
      ? [fitted.minX, fitted.minY, fitted.maxX - fitted.minX, fitted.maxY - fitted.minY]
          .map(two)
          .join(' ')
      : undefined;
    // Where the middle of the scene, its origin, is in a cell, in pixels.
    const zoomed = fitted ? base.width / (fitted.maxX - fitted.minX) : 1;
    const origin = fitted
      ? {
          x: two((base.width / 2 - fitted.minX) * zoomed * (w / base.width)),
          y: two((base.height / 2 - fitted.minY) * zoomed * (h / base.height)),
        }
      : { x: w / 2, y: h / 2 };
    const svg = sheetSvg(scenes, cells, w, h, width, height, viewBox);

    const saved: string[] = [];
    if (args.save_to !== undefined) {
      const image = basename(args.save_to);
      // The frame list TexturePacker writes as "JSON (Hash)", which Phaser,
      // PixiJS and most importers read. "turn" is extra: the angle in degrees.
      // With poses each frame also has "pose", and "animations" lists the
      // frames of each direction in order, which is where PixiJS looks.
      const frames = Object.fromEntries(
        cells.map((cell) => [
          `${cell.name}.png`,
          {
            frame: { x: cell.x, y: cell.y, w, h },
            rotated: false,
            trimmed: false,
            spriteSourceSize: { x: 0, y: 0, w, h },
            sourceSize: { w, h },
            turn: cell.turn,
            ...(hasPoses ? { pose: cell.pose } : {}),
          },
        ]),
      );
      const animations = hasPoses
        ? Object.fromEntries(
            Array.from({ length: count }, (_, d) => [
              `${stem}-${String(d).padStart(digits, '0')}`,
              cells.filter((cell) => cell.direction === d).map((cell) => `${cell.name}.png`),
            ]),
          )
        : undefined;
      const meta = {
        app: 'https://github.com/rxolve/zpup',
        image,
        format: 'RGBA8888',
        size: { w: width, h: height },
        scale: '1',
        origin,
      };
      const json = `${args.save_to.slice(0, -4)}.json`;
      await save(args.save_to, svgToExactPng(svg));
      await save(
        json,
        `${JSON.stringify(animations ? { frames, animations, meta } : { frames, meta }, null, 2)}\n`,
      );
      saved.push(args.save_to, json);
    }

    const each = `each turned ${formatTurn(360 / count)} degrees further about the vertical axis`;
    let summary = hasPoses
      ? `${found.note}Drew ${count} directions of a ${base.width}x${base.height} scene in ${poseCount} poses, ${each}, as a sheet of ${columns} by ${rows} cells of ${w}x${h} pixels (${width}x${height} in all). Each row is one direction, starting with the scene as written, and each column is one pose, in the order of poses. The poses were not remembered: the remembered scene is the scene without them.`
      : `${found.note}Drew ${count} directions of a ${base.width}x${base.height} scene, ${each}, as a sheet of ${columns} by ${rows} cells of ${w}x${h} pixels (${width}x${height} in all). Cells run left to right, top to bottom, starting with the scene as written.`;
    if (saved.length > 0) summary += `\nSaved: ${saved.join(', ')}`;
    else summary += '\nNothing was saved. Pass save_to to write the sheet and its frame list.';
    if (base.background !== undefined) {
      summary +=
        '\nThe scene has a background, which is left out of the sheet so that the sprites are transparent.';
    }
    if (fitted) {
      summary += `\nFitted: every cell shows the same part of the scene, ${formatTurn(zoomed)} times its size, so that the drawing fills the cell where it reaches furthest. The middle of the scene is at ${origin.x}, ${origin.y} in each cell (meta.origin in the frame list).`;
    }
    const where = (cell: Cell): string =>
      hasPoses ? `Direction ${cell.direction}, pose ${cell.pose}` : `Cell ${cell.direction}`;
    const cut = fitted
      ? []
      : cells
          .map((cell) => ({ cell, note: framing(turned(scenes[cell.pose] as Scene, cell.turn)) }))
          .filter((c) => c.note.includes('cut off'));
    if (cut.length > 0) {
      summary += `\nCut off in ${cut.length} of ${cells.length} cells, which share one frame so that the sprite does not jump between ${hasPoses ? 'directions or poses' : 'directions'}. Pass fit: true to have the frame set for you, or make the scene larger (width and height) or the drawing smaller (zoom). ${cut
        .slice(0, 3)
        .map((c) => `${where(c.cell)}: ${c.note}`)
        .join(' ')}`;
    }
    summary += warningText(warningsOf(scenes));

    const preview = svgToPng(svg, {
      size: Math.min(SHEET_PREVIEW, Math.max(width, height)),
      backdrop: true,
    });
    const content: Content[] = [
      text(summary),
      { type: 'image', data: preview.toString('base64'), mimeType: 'image/png' },
    ];
    if (look !== undefined) {
      // One direction on its own, larger, to judge the motion from pose to pose.
      const row = cells.filter((cell) => cell.direction === look);
      const side = Math.min(STRIP_CELL, Math.floor(STRIP_MAX / row.length));
      const ratio = side / Math.max(base.width, base.height);
      const sw = Math.max(1, Math.round(base.width * ratio));
      const sh = Math.max(1, Math.round(base.height * ratio));
      const strip = sheetSvg(
        scenes,
        row.map((cell, i) => ({ ...cell, x: i * sw, y: 0 })),
        sw,
        sh,
        sw * row.length,
        sh,
        viewBox,
      );
      content.push(
        text(
          `Direction ${look}, turned ${formatTurn((360 * look) / count)} degrees, ${hasPoses ? `its ${row.length} poses from left to right` : 'on its own'}, at ${sw}x${sh} pixels each:`,
        ),
        {
          type: 'image',
          data: svgToPng(strip, { size: Math.max(sw * row.length, sh), backdrop: true }).toString(
            'base64',
          ),
          mimeType: 'image/png',
        },
      );
    }
    return { content };
  });
}

function formatTurn(degrees: number): string {
  return String(Math.round(degrees * 100) / 100);
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
