import { describe, expect, it } from 'vitest';
import { hello } from '../examples/hello.ts';
import { pup } from '../examples/pup.ts';
import { isAllowedSvgElement, isAllowedSvgValue } from '../playground/src/allowlist.ts';
import { formatJson, lineColumn, locate, scanJson } from '../playground/src/json.ts';
import {
  decodeHash,
  encodeHash,
  formatBytes,
  fromBase64Url,
  MAX_HASH_LENGTH,
  toBase64Url,
} from '../playground/src/share.ts';
import {
  applyView,
  dragOffset,
  NO_OFFSET,
  spinAngleAt,
  viewRotation,
  wrapDegrees,
} from '../playground/src/view.ts';
import { checkScene, renderSvg } from '../src/index.ts';

describe('playground: link sharing', () => {
  it('round-trips bytes through base64url', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = toBase64Url(bytes);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fromBase64Url(text)).toEqual(bytes);
  });

  it('rejects characters outside base64url', () => {
    expect(() => fromBase64Url('a+b/')).toThrow();
  });

  it('round-trips editor text, including non-ASCII and formatting', async () => {
    const text = '{\n  "title": "강아지 🐶",\n\t"width": 10 }';
    const encoded = await encodeHash(text);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(encoded.hash.startsWith('#s=')).toBe(true);
    expect(await decodeHash(encoded.hash)).toEqual({ kind: 'text', text });
  });

  it('writes an unchanged example by name', async () => {
    expect(await encodeHash('anything', 'pup')).toEqual({ ok: true, hash: '#example=pup' });
    expect(await decodeHash('#example=pup')).toEqual({ kind: 'example', name: 'pup' });
  });

  it('compresses a real scene well below the limit', async () => {
    const encoded = await encodeHash(formatJson(pup));
    expect(encoded.ok && encoded.hash.length < 2000).toBe(true);
  });

  it('refuses text that does not fit, with a reason', async () => {
    // Random-looking text barely compresses.
    let text = '';
    let seed = 1;
    while (text.length < MAX_HASH_LENGTH * 2) {
      seed = (seed * 48271) % 2147483647;
      text += seed.toString(36);
    }
    const encoded = await encodeHash(text);
    expect(encoded.ok).toBe(false);
    if (encoded.ok) return;
    expect(encoded.length).toBeGreaterThan(MAX_HASH_LENGTH);
    expect(encoded.reason).toContain('too large');
  });

  it('reports an empty or unreadable hash without throwing', async () => {
    expect(await decodeHash('')).toEqual({ kind: 'none' });
    expect(await decodeHash('#other=1')).toEqual({ kind: 'none' });
    expect((await decodeHash('#s=not*base64')).kind).toBe('invalid');
    expect((await decodeHash('#s=AAAA')).kind).toBe('invalid');
  });

  it('formats byte counts', () => {
    expect(formatBytes(812)).toBe('812 B');
    expect(formatBytes(54308)).toBe('54.3 KB');
  });
});

describe('playground: view rotation', () => {
  it('wraps angles into [-180, 180)', () => {
    expect(wrapDegrees(0)).toBe(0);
    expect(wrapDegrees(180)).toBe(-180);
    expect(wrapDegrees(190)).toBe(-170);
    expect(wrapDegrees(-190)).toBe(170);
    expect(wrapDegrees(720)).toBe(0);
    expect(Object.is(wrapDegrees(-360), -0)).toBe(false);
  });

  it('turns right and tips toward the viewer when dragged right and down', () => {
    const o = dragOffset(NO_OFFSET, 20, 10);
    expect(o).toEqual({ x: -5, y: 10 });
  });

  it('accumulates drags from the offset where the drag started', () => {
    const o = dragOffset({ x: -5, y: 10 }, -40, 0);
    expect(o).toEqual({ x: -5, y: -10 });
  });

  it('keeps the total tilt within [-90, 90]', () => {
    expect(dragOffset(NO_OFFSET, 0, 1000, -20)).toEqual({ x: -70, y: 0 });
    expect(dragOffset(NO_OFFSET, 0, -1000, -20)).toEqual({ x: 110, y: 0 });
    // A scene already tilted further out is not pulled back by a small drag.
    expect(dragOffset(NO_OFFSET, 0, 0, 120)).toEqual({ x: 0, y: 0 });
  });

  it('adds the offset to the scene rotation without changing the scene', () => {
    const scene = { width: 10, height: 10, rotate: { x: -20, y: 170, z: 5 }, children: [] };
    const viewed = applyView(scene, { x: 10, y: 20 });
    expect(viewed.rotate).toEqual({ x: -10, y: -170, z: 5 });
    expect(scene.rotate).toEqual({ x: -20, y: 170, z: 5 });
    expect(viewRotation({ width: 1, height: 1, children: [] }, { x: 1, y: 2 })).toEqual({
      x: 1,
      y: 2,
      z: 0,
    });
  });

  it('returns the scene itself when there is no offset', () => {
    expect(applyView(hello, NO_OFFSET)).toBe(hello);
  });

  it('gives a turning picture the angle of the matching still', () => {
    expect(spinAngleAt(0, 8)).toBe(0);
    expect(spinAngleAt(2000, 8)).toBe(90);
    expect(spinAngleAt(10000, 8)).toBe(90);
  });
});

describe('playground: JSON', () => {
  it('keeps short objects on one line and breaks long ones', () => {
    const text = formatJson({ width: 10, children: [{ type: 'path', path: [{ x: 1 }, {}] }] });
    expect(text).toBe(
      '{ "width": 10, "children": [{ "type": "path", "path": [{ "x": 1 }, {}] }] }\n',
    );
    const long = formatJson({ a: 'x'.repeat(40), b: { c: 'y'.repeat(40) } });
    expect(long).toBe(`{\n  "a": "${'x'.repeat(40)}",\n  "b": { "c": "${'y'.repeat(40)}" }\n}\n`);
  });

  it('formats a scene that parses back to the same value', () => {
    const text = formatJson(pup);
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(pup)));
    expect(Math.max(...text.split('\n').map((l) => l.length))).toBeLessThanOrEqual(80);
  });

  it('finds the text for an issue path', () => {
    const text =
      '{\n  "width": 10,\n  "children": [\n    { "type": "path", "colour": "red" }\n  ]\n}';
    const scan = scanJson(text);
    expect(scan.error).toBeUndefined();
    const span = locate(scan, ['scene', 'children', 0, 'colour']);
    expect(span && text.slice(span.start, span.end)).toBe('"colour": "red"');
    // A missing option points at the node that lacks it.
    const node = locate(scan, ['scene', 'children', 0, 'path']);
    expect(node && text.slice(node.start, node.end)).toBe('{ "type": "path", "colour": "red" }');
  });

  it('locates every issue zpup reports for a broken scene', () => {
    const text = formatJson({
      width: 100,
      height: 100,
      children: [{ type: 'path', colour: 'red', path: [{ x: 'a' }] }, { type: 'circle' }],
    });
    const scan = scanJson(text);
    const issues = checkScene(JSON.parse(text));
    expect(issues.length).toBeGreaterThan(1);
    for (const issue of issues) expect(locate(scan, issue.pathSegments)).toBeDefined();
  });

  it('locates keys that contain dots or brackets exactly', () => {
    const text = formatJson({
      width: 100,
      height: 100,
      children: [{ type: 'path', path: [{}], 'a.b[0]': 1 }],
    });
    const issue = checkScene(JSON.parse(text)).find((i) => i.path.endsWith('a.b[0]'));
    expect(issue?.pathSegments).toEqual(['scene', 'children', 0, 'a.b[0]']);
    const span = locate(scanJson(text), issue?.pathSegments ?? []);
    expect(span && text.slice(span.start, span.end)).toBe('"a.b[0]": 1');
  });

  it('points at syntax errors', () => {
    const cases: [string, string, number][] = [
      ['{ "a": 1, }', 'comma before "}"', 10],
      ['{ "a": 1 "b": 2 }', 'Expected "," or "}"', 9],
      ["{ 'a': 1 }", 'property name', 2],
      ['[1, 2', 'Expected "," or "]"', 5],
      ['{ "a": tru }', 'Expected a value', 7],
      ['{ "a": 1 } x', 'after the end', 11],
      ['', 'end of the text', 0],
    ];
    for (const [text, message, offset] of cases) {
      const error = scanJson(text).error;
      expect(error?.message).toContain(message);
      expect(error?.offset).toBe(offset);
    }
  });

  it('agrees with JSON.parse on valid text', () => {
    for (const text of ['{}', '[]', '{"a":[1,-2.5e3,true,null,"\\u00e9\\n"]}', ' 0 ']) {
      expect(scanJson(text).error).toBeUndefined();
      expect(() => JSON.parse(text)).not.toThrow();
    }
  });

  it('gives 1-based lines and columns', () => {
    expect(lineColumn('ab\ncd', 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumn('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
  });
});

describe('playground: SVG allowlist', () => {
  it('accepts everything renderSvg writes for the examples', () => {
    for (const scene of [hello, pup]) {
      const svg = renderSvg(scene);
      for (const match of svg.matchAll(/<([a-z]+)((?:\s+[\w:-]+="[^"]*")*)\s*\/?>/g)) {
        const name = match[1] as string;
        const attributes = [...(match[2] ?? '').matchAll(/([\w:-]+)="([^"]*)"/g)];
        expect(
          isAllowedSvgElement(
            name,
            attributes.map((a) => a[1] as string),
          ),
        ).toBe(true);
        for (const a of attributes)
          expect(isAllowedSvgValue(a[1] as string, a[2] as string)).toBe(true);
      }
    }
  });

  it('refuses scripts, links, foreign objects and event handlers', () => {
    expect(isAllowedSvgElement('script', [])).toBe(false);
    expect(isAllowedSvgElement('a', ['href'])).toBe(false);
    expect(isAllowedSvgElement('foreignObject', [])).toBe(false);
    expect(isAllowedSvgElement('circle', ['onload'])).toBe(false);
    expect(isAllowedSvgElement('constructor', [])).toBe(false);
    expect(isAllowedSvgValue('fill', 'url(https://example.com/x.svg#a)')).toBe(false);
    expect(isAllowedSvgValue('fill', '#e62')).toBe(true);
  });
});
