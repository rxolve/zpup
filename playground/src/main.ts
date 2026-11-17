/**
 * The Zpup playground: a JSON editor on one side, the picture on the other.
 * Everything runs in the browser; the library is loaded as plain ES modules
 * through the import map in index.html.
 */
import {
  checkScene,
  checkSceneWarnings,
  renderSvg,
  type Scene,
  type ValidationIssue,
} from '@zpup/core';
import { isAllowedSvgElement, isAllowedSvgValue } from './allowlist.ts';
import { formatJson, lineColumn, locate, pathKey, type Span, scanJson } from './json.ts';
import { decodeHash, encodeHash, formatBytes, gzipSize } from './share.ts';
import type { SpinRequest, SpinResponse } from './spin-worker.ts';
import {
  applyView,
  DEGREES_PER_PIXEL,
  dragOffset,
  isNoOffset,
  NO_OFFSET,
  spinAngleAt,
  type ViewOffset,
  viewRotation,
} from './view.ts';

const SPIN_SECONDS = 8;
const SVG_NS = 'http://www.w3.org/2000/svg';

function element<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from the page`);
  return el as T;
}

const editor = element<HTMLTextAreaElement>('editor');
const exampleSelect = element<HTMLSelectElement>('example');
const problems = element<HTMLDivElement>('problems');
const stage = element<HTMLDivElement>('stage');
const stageHint = element<HTMLSpanElement>('stage-hint');
const stageStatus = element<HTMLSpanElement>('stage-status');
const resetButton = element<HTMLButtonElement>('reset');
const keepButton = element<HTMLButtonElement>('keep');
const stillSize = element<HTMLSpanElement>('still-size');
const spinSize = element<HTMLSpanElement>('spin-size');
const exportStatus = element<HTMLParagraphElement>('export-status');
const copyLinkButton = element<HTMLButtonElement>('copy-link');

/** Example name to its JSON text, written into the page at build time. */
const examples: Record<string, string> = JSON.parse(element('examples').textContent ?? '{}');
const DEFAULT_EXAMPLE = 'hello';

type View = 'drag' | 'spin';

/** The last scene that was valid; it stays on screen while the text has errors. */
let scene: Scene | undefined;
/** True while the text has errors and the picture shows an older scene. */
let stale = false;
let offset: ViewOffset = NO_OFFSET;
let view: View = 'drag';

// ---------------------------------------------------------------------------
// Showing SVG safely

/**
 * Turns `renderSvg` output into an element for the page without `innerHTML`.
 * The text is parsed as an SVG document, which never runs scripts, and every
 * element and attribute is checked against the short list that `renderSvg`
 * produces before the tree is imported. Anything else is refused.
 */
function trustedSvg(svg: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const attributes = [...el.attributes];
    const ok =
      el.namespaceURI === SVG_NS &&
      isAllowedSvgElement(
        el.localName,
        attributes.map((a) => a.name),
      ) &&
      attributes.every((a) => isAllowedSvgValue(a.name, a.value));
    if (!ok) throw new Error(`Refused to show an unexpected <${el.localName}> in the picture.`);
  }
  return document.importNode(root, true) as unknown as SVGSVGElement;
}

// ---------------------------------------------------------------------------
// Turning SVGs, built in a worker

let worker: Worker | undefined;
let workerJob: { id: number; reject: (e: Error) => void } | undefined;
let nextJobId = 1;
const settle = new Map<number, (r: SpinResponse) => void>();
let spinCache: { key: string; svg: Promise<string> } | undefined;

function startWorker(): Worker {
  const w = new Worker(new URL('./spin-worker.js', import.meta.url), { type: 'module' });
  w.addEventListener('message', (event: MessageEvent<SpinResponse>) => {
    settle.get(event.data.id)?.(event.data);
  });
  return w;
}

/** The turning SVG for a scene, from the cache or from the worker. */
function spinSvg(s: Scene): Promise<string> {
  const key = JSON.stringify(s);
  if (spinCache?.key === key) return spinCache.svg;
  // A scene still being built is out of date now: stop that work.
  if (workerJob && worker) {
    worker.terminate();
    worker = undefined;
    workerJob.reject(new Error('superseded'));
  }
  worker ??= startWorker();
  const id = nextJobId++;
  const svg = new Promise<string>((resolve, reject) => {
    workerJob = { id, reject };
    settle.set(id, (r) => {
      settle.delete(id);
      if (workerJob?.id === id) workerJob = undefined;
      if ('svg' in r) resolve(r.svg);
      else reject(new Error(r.error));
    });
    const request: SpinRequest = { id, scene: s, options: { duration: SPIN_SECONDS } };
    worker?.postMessage(request);
  });
  spinCache = { key, svg };
  svg.catch(() => {
    if (spinCache?.svg === svg) spinCache = undefined;
  });
  return svg;
}

/** The turning image on screen (or loading), with the scene it shows. */
let spinShown: { key: string; url: string; img: HTMLImageElement } | undefined;
/** When the shown turning image started playing, to pick it up at the right angle. */
let spinStartedAt: number | undefined;
let spinTimer: number | undefined;

function showSpin(s: Scene) {
  window.clearTimeout(spinTimer);
  const key = JSON.stringify(s);
  if (spinShown?.key === key && stage.contains(spinShown.img)) return;
  // Typing in the Spin view would otherwise start a build per keystroke.
  const wait = spinCache?.key === key ? 0 : 250;
  spinTimer = window.setTimeout(async () => {
    stageStatus.textContent = 'Building the turning SVG…';
    let svg: string;
    try {
      svg = await spinSvg(s);
    } catch (e) {
      if ((e as Error).message !== 'superseded') stageStatus.textContent = (e as Error).message;
      return;
    }
    if (view !== 'spin' || !scene || JSON.stringify(applyView(scene, offset)) !== key) return;
    if (spinShown?.key === key && !spinShown.img.complete) return; // already loading
    stageStatus.textContent = stale ? 'Showing the last scene without errors.' : '';
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    // An <img> never runs scripts, and shows that the file turns on its own.
    const img = document.createElement('img');
    img.alt = s.title ?? 'The scene, turning';
    img.draggable = false;
    const previous = spinShown;
    spinShown = { key, url, img };
    img.addEventListener('load', () => {
      if (view !== 'spin' || spinShown?.img !== img) {
        URL.revokeObjectURL(url);
        return;
      }
      if (previous) URL.revokeObjectURL(previous.url);
      spinStartedAt = performance.now();
      stage.replaceChildren(img);
    });
    img.src = url;
    describeSize(spinSize, svg);
  }, wait);
}

// ---------------------------------------------------------------------------
// Rendering

let frameRequested = false;
function scheduleRender() {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => {
    frameRequested = false;
    render();
  });
}

function render() {
  resetButton.disabled = isNoOffset(offset);
  keepButton.disabled = isNoOffset(offset) || stale;
  stage.classList.toggle('stale', stale);
  if (!scene) return;
  const viewed = applyView(scene, offset);
  // The first frame of a turning SVG is the still picture, so the still
  // stands in while the turning one is built.
  if (view === 'drag' || !(stage.firstElementChild instanceof HTMLImageElement)) {
    try {
      stage.replaceChildren(trustedSvg(renderSvg(viewed)));
    } catch (e) {
      stageStatus.textContent = (e as Error).message;
      return;
    }
  }
  if (view === 'spin') showSpin(viewed);
  scheduleSizes();
}

let sizeTimer: number | undefined;
function scheduleSizes() {
  window.clearTimeout(sizeTimer);
  sizeTimer = window.setTimeout(() => {
    if (!scene) return;
    describeSize(stillSize, renderSvg(applyView(scene, offset)));
    if (view === 'drag') spinSize.textContent = '';
  }, 200);
}

async function describeSize(target: HTMLElement, svg: string) {
  const bytes = new Blob([svg]).size;
  target.textContent = `(${formatBytes(bytes)})`;
  const gz = await gzipSize(svg);
  target.textContent = `(${formatBytes(bytes)}, ${formatBytes(gz)} gzipped)`;
}

// ---------------------------------------------------------------------------
// Reading the editor

interface Problem {
  readonly kind: 'error' | 'warning';
  readonly where: string;
  readonly message: string;
  /** Where to put the cursor when the problem is chosen. */
  readonly target: () => Span | undefined;
}

function issueProblem(kind: Problem['kind'], issue: ValidationIssue): Problem {
  // The path (and the node's id) are shown separately, so the message is the detail alone.
  const node = issue.nodeId === undefined ? '' : ` (in node ${JSON.stringify(issue.nodeId)})`;
  return {
    kind,
    where: `${issue.path}${node}`,
    message: issue.detail,
    target: () => locate(scanJson(editor.value), issue.pathSegments),
  };
}

function showProblems(list: readonly Problem[]) {
  problems.replaceChildren();
  for (const kind of ['error', 'warning'] as const) {
    const items = list.filter((p) => p.kind === kind);
    if (items.length === 0) continue;
    const heading = document.createElement('h2');
    const count = items.length === 1 ? `1 ${kind}` : `${items.length} ${kind}s`;
    heading.textContent = count.charAt(0).toUpperCase() + count.slice(1);
    const ul = document.createElement('ul');
    ul.className = kind;
    for (const p of items) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.title = 'Show in the editor';
      const code = document.createElement('code');
      code.textContent = p.where;
      button.append(code, ` ${p.message}`);
      button.addEventListener('click', () => {
        const span = p.target();
        if (span) select(span);
      });
      li.append(button);
      ul.append(li);
    }
    problems.append(heading, ul);
  }
}

function update() {
  const text = editor.value;
  syncExampleSelect(text);
  scheduleHash();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    const found = scanJson(text).error;
    const at = found?.offset ?? 0;
    const { line, column } = lineColumn(text, at);
    showProblems([
      {
        kind: 'error',
        where: `Line ${line}, column ${column}`,
        message: found?.message ?? (e as Error).message,
        target: () => ({ start: at, end: Math.min(at + 1, editor.value.length) }),
      },
    ]);
    setStale(true);
    return;
  }
  const issues = checkScene(value);
  if (issues.length > 0) {
    showProblems(issues.map((i) => issueProblem('error', i)));
    setStale(true);
    return;
  }
  scene = value as Scene;
  showProblems(checkSceneWarnings(scene).map((i) => issueProblem('warning', i)));
  setStale(false);
  scheduleRender();
}

function setStale(value: boolean) {
  stale = value;
  stageStatus.textContent = stale && scene ? 'Showing the last scene without errors.' : '';
  render();
}

// ---------------------------------------------------------------------------
// Editing helpers

/** Selects a range in the editor and scrolls it into view. */
function select(span: Span) {
  editor.focus();
  editor.setSelectionRange(span.start, span.end);
  const { line } = lineColumn(editor.value, span.start);
  const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 20;
  editor.scrollTop = Math.max(0, (line - 1) * lineHeight - editor.clientHeight / 3);
}

/** Replaces a range, through the browser's editing commands where possible so undo works. */
function replaceRange(start: number, end: number, text: string) {
  editor.focus();
  editor.setSelectionRange(start, end);
  // execCommand is deprecated but still the only way to keep the undo history.
  if (!document.execCommand('insertText', false, text)) {
    editor.setRangeText(text, start, end, 'end');
    update();
  }
}

/** Indents or outdents the selected lines, or inserts two spaces at the cursor. */
function indent(outdent: boolean) {
  const { selectionStart: s, selectionEnd: e, value } = editor;
  if (!outdent && s === e) {
    replaceRange(s, e, '  ');
    return;
  }
  const start = value.lastIndexOf('\n', s - 1) + 1;
  const last = e > s && value[e - 1] === '\n' ? e - 1 : e;
  const lineEnd = value.indexOf('\n', last);
  const end = lineEnd === -1 ? value.length : lineEnd;
  const lines = value.slice(start, end).split('\n');
  const changed = lines.map((l) => (outdent ? l.replace(/^ {1,2}/, '') : `  ${l}`)).join('\n');
  if (changed === value.slice(start, end)) return;
  replaceRange(start, end, changed);
  editor.setSelectionRange(start, start + changed.length);
}

let tabLeavesEditor = false;
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    tabLeavesEditor = true;
    return;
  }
  if (e.key === 'Tab' && !tabLeavesEditor && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    indent(e.shiftKey);
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    // Keep the indentation of the current line, one step deeper after { or [.
    const { selectionStart: s, selectionEnd: end, value } = editor;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const current = /^[ \t]*/.exec(value.slice(lineStart, s))?.[0] ?? '';
    const opens = /[{[]\s*$/.test(value.slice(lineStart, s));
    e.preventDefault();
    replaceRange(s, end, `\n${current}${opens ? '  ' : ''}`);
    return;
  }
  if (e.key !== 'Shift') tabLeavesEditor = false;
});
editor.addEventListener('blur', () => {
  tabLeavesEditor = false;
});
editor.addEventListener('input', update);

// ---------------------------------------------------------------------------
// Turning the view

let drag: { pointer: number; x: number; y: number; from: ViewOffset } | undefined;

/** The turning image's current angle becomes the view, so grabbing it stops it in place. */
function grabSpin() {
  if (view !== 'spin') return;
  if (stage.firstElementChild instanceof HTMLImageElement && spinStartedAt !== undefined) {
    const angle = spinAngleAt(performance.now() - spinStartedAt, SPIN_SECONDS);
    offset = dragOffset(offset, angle / DEGREES_PER_PIXEL, 0, scene?.rotate?.x ?? 0);
  }
  setView('drag');
}

stage.addEventListener('pointerdown', (e) => {
  if (!scene || e.button !== 0) return;
  grabSpin();
  drag = { pointer: e.pointerId, x: e.clientX, y: e.clientY, from: offset };
  stage.setPointerCapture(e.pointerId);
  stage.classList.add('dragging');
  e.preventDefault();
});
stage.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointer || !scene) return;
  offset = dragOffset(drag.from, e.clientX - drag.x, e.clientY - drag.y, scene.rotate?.x ?? 0);
  scheduleRender();
});
const endDrag = (e: PointerEvent) => {
  if (!drag || e.pointerId !== drag.pointer) return;
  drag = undefined;
  stage.classList.remove('dragging');
};
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

// Focusable only once this script runs, since the arrow keys need it.
stage.tabIndex = 0;
stage.addEventListener('keydown', (e) => {
  if (!scene) return;
  const step = (e.shiftKey ? 2 : 10) / DEGREES_PER_PIXEL; // 10 degrees, or 2 with Shift
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const move = moves[e.key];
  if (move) {
    e.preventDefault();
    grabSpin();
    offset = dragOffset(offset, move[0], move[1], scene.rotate?.x ?? 0);
    scheduleRender();
  } else if (e.key === 'Home') {
    e.preventDefault();
    resetView();
  }
});

function resetView() {
  offset = NO_OFFSET;
  render();
}
resetButton.addEventListener('click', resetView);

/** Writes the current angle into the scene's `rotate`, replacing only that part of the text. */
keepButton.addEventListener('click', () => {
  if (!scene || stale) return;
  const r = viewRotation(scene, offset);
  const rotate: Record<string, number> = {};
  for (const axis of ['x', 'y', 'z'] as const) {
    const v = Math.round(r[axis]);
    if (v !== 0) rotate[axis] = v;
  }
  const json = formatJson(rotate).trimEnd();
  const scan = scanJson(editor.value);
  const existing = scan.values.get(pathKey(['scene', 'rotate']));
  const root = scan.values.get(pathKey(['scene']));
  offset = NO_OFFSET;
  if (existing) {
    replaceRange(existing.start, existing.end, json);
  } else if (root) {
    const indentation = /\n([ \t]+)"/.exec(editor.value)?.[1] ?? '  ';
    replaceRange(root.start + 1, root.start + 1, `\n${indentation}"rotate": ${json},`);
  }
});

// ---------------------------------------------------------------------------
// Drag and Spin views

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function setView(next: View) {
  view = next;
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="view"]')) {
    input.checked = input.value === next;
  }
  stageHint.textContent =
    next === 'spin'
      ? 'This is the turning SVG in an <img>, with no script. Grab it to turn it by hand.'
      : 'Drag the picture, or use the arrow keys, to turn it.';
  window.clearTimeout(spinTimer);
  if (next === 'drag')
    stageStatus.textContent = stale ? 'Showing the last scene without errors.' : '';
  // Leave the turning image on screen until the still replaces it.
  if (next === 'drag' && stage.firstElementChild instanceof HTMLImageElement) {
    stage.replaceChildren();
  }
  render();
}

for (const input of document.querySelectorAll<HTMLInputElement>('input[name="view"]')) {
  input.addEventListener('change', () => {
    if (input.checked) setView(input.value as View);
  });
}

// ---------------------------------------------------------------------------
// Examples and the address

function exampleFor(text: string): string | undefined {
  return Object.keys(examples).find((name) => examples[name] === text);
}

function syncExampleSelect(text: string) {
  exampleSelect.value = exampleFor(text) ?? '';
}

exampleSelect.addEventListener('change', () => {
  const text = examples[exampleSelect.value];
  if (text === undefined) return;
  // A new history entry, so Back returns to the scene that was here.
  history.pushState(null, '', `#example=${exampleSelect.value}`);
  currentHash = location.hash;
  loadText(text);
});

function loadText(text: string) {
  editor.value = text;
  editor.scrollTop = 0;
  offset = NO_OFFSET;
  if (view === 'spin') stage.replaceChildren();
  update();
}

let currentHash = '';
let hashTimer: number | undefined;
let pendingHash: Promise<void> = Promise.resolve();

function scheduleHash() {
  window.clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => {
    pendingHash = writeHash();
  }, 400);
}

async function writeHash() {
  const text = editor.value;
  const encoded = await encodeHash(text, exampleFor(text));
  if (editor.value !== text) return;
  if (encoded.ok) {
    copyLinkButton.disabled = false;
    copyLinkButton.title = '';
    if (encoded.hash !== location.hash) {
      history.replaceState(null, '', `${location.pathname}${location.search}${encoded.hash}`);
    }
    currentHash = encoded.hash;
  } else {
    copyLinkButton.disabled = true;
    copyLinkButton.title = encoded.reason;
    exportStatus.textContent = encoded.reason;
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    currentHash = '';
  }
}

async function loadFromHash() {
  if (location.hash === currentHash) return;
  currentHash = location.hash;
  const content = await decodeHash(location.hash);
  if (content.kind === 'example') {
    const text = examples[content.name];
    if (text !== undefined) loadText(text);
    else exportStatus.textContent = `There is no example called "${content.name}".`;
  } else if (content.kind === 'text') {
    loadText(content.text);
  } else if (content.kind === 'invalid') {
    exportStatus.textContent = content.reason;
  }
}
window.addEventListener('hashchange', loadFromHash);
window.addEventListener('popstate', loadFromHash);

// ---------------------------------------------------------------------------
// Exports

function fileBase(): string {
  const name = exampleFor(editor.value);
  return name ? `zpup-${name}` : 'zpup-scene';
}

function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copy(text: string, what: string) {
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    copied = copyWithSelection(text);
  }
  exportStatus.textContent = copied
    ? `Copied ${what}.`
    : `Could not copy ${what}: the browser did not allow it.`;
}

/** The older way to copy, for browsers or frames where the Clipboard API is refused. */
function copyWithSelection(text: string): boolean {
  const focused = document.activeElement;
  const area = document.createElement('textarea');
  area.value = text;
  area.readOnly = true;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (focused instanceof HTMLElement) focused.focus();
  return ok;
}

/** Builds the turning SVG for an export, saying so while it takes time. */
async function exportedSpin(s: Scene): Promise<string | undefined> {
  exportStatus.textContent = 'Building the turning SVG…';
  try {
    const svg = await spinSvg(s);
    exportStatus.textContent = '';
    return svg;
  } catch (e) {
    exportStatus.textContent = (e as Error).message;
    return undefined;
  }
}

const actions: Record<string, (s: Scene) => Promise<void> | void> = {
  'download-still': (s) => download(renderSvg(s), `${fileBase()}.svg`),
  'copy-still': (s) => copy(renderSvg(s), 'the still SVG'),
  'download-spin': async (s) => {
    const svg = await exportedSpin(s);
    if (svg) download(svg, `${fileBase()}-spin.svg`);
  },
  'copy-spin': async (s) => {
    const svg = await exportedSpin(s);
    if (svg) await copy(svg, 'the turning SVG');
  },
  'copy-markdown': (s) => {
    const alt = (s.title ?? 'A Zpup illustration').replace(/[[\]\\]/g, '');
    return copy(`![${alt}](${fileBase()}-spin.svg)`, 'the Markdown line');
  },
  'copy-link': async () => {
    window.clearTimeout(hashTimer);
    await pendingHash;
    await writeHash();
    if (!copyLinkButton.disabled) await copy(location.href, 'the link');
  },
};

for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-action]')) {
  button.addEventListener('click', async () => {
    const action = actions[button.dataset.action ?? ''];
    if (!action || !scene) return;
    await action(applyView(scene, offset));
    if (stale && button.dataset.action !== 'copy-link') {
      exportStatus.textContent += ' The text has errors, so this is the last scene without them.';
    }
  });
}

// ---------------------------------------------------------------------------
// Start

async function start() {
  if (location.hash) await loadFromHash();
  if (editor.value.trim() === '' && examples[DEFAULT_EXAMPLE] !== undefined) {
    editor.value = examples[DEFAULT_EXAMPLE];
  }
  // Open turning, unless the reader asked for less motion.
  setView(reduceMotion.matches ? 'drag' : 'spin');
  update();
}

start();
