import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { lighthouse } from '../../examples/lighthouse.ts';
import { createServer, REFERENCE_URI } from '../src/create.ts';
import {
  type Content,
  checkSceneTool,
  getReference,
  INLINE_SVG_LIMIT,
  renderScene,
  renderSpin,
} from '../src/tools.ts';

const planet = {
  width: 120,
  height: 120,
  rotate: { x: -20, y: 30 },
  children: [
    { type: 'dot', stroke: 40, color: '#e62' },
    { type: 'ellipse', diameter: 70, stroke: 5, color: '#636', rotate: { x: 90 } },
  ],
};

/** A box whose six faces differ, so every quarter turn looks different. */
const box = {
  type: 'box',
  width: 50,
  height: 30,
  depth: 20,
  color: '#e62',
  frontFace: '#36c',
  leftFace: '#3a3',
};

const texts = (content: readonly Content[]) =>
  content.flatMap((c) => (c.type === 'text' ? [c.text] : []));
const images = (content: readonly Content[]) =>
  content.flatMap((c) => (c.type === 'image' ? [Buffer.from(c.data, 'base64')] : []));

/** Width and height from a PNG's header. */
function pngSize(png: Buffer): { width: number; height: number } {
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** Whether a PNG has an alpha channel, from the color type in its header. */
const hasAlpha = (png: Buffer) => png[25] === 6;

describe('mcp: render_scene', () => {
  it('returns a summary, a PNG to look at and the SVG text', async () => {
    const result = await renderScene({ scene: planet });
    expect(result.isError).toBeUndefined();
    const [summary, svg] = texts(result.content);
    expect(summary).toMatch(/^Drew 1 view of a 120x120 scene\. SVG: /);
    expect(svg).toMatch(/^<svg /);
    const [png] = images(result.content);
    expect(pngSize(png as Buffer)).toEqual({ width: 512, height: 512 });
  });

  it('accepts the scene as JSON text', async () => {
    const result = await renderScene({ scene: JSON.stringify(planet) });
    expect(result.isError).toBeUndefined();
    expect(images(result.content)).toHaveLength(1);
  });

  it('says where text that is not JSON breaks', async () => {
    const result = await renderScene({ scene: '{ "width": 120, ' });
    expect(result.isError).toBe(true);
    expect(texts(result.content)[0]).toMatch(/^scene: the text is not valid JSON/);
  });

  it('draws nothing for an invalid scene and lists every problem with its fix', async () => {
    const result = await renderScene({
      scene: { width: 120, children: [{ type: 'dot', colour: 'red' }, { type: 'sphere' }] },
    });
    expect(result.isError).toBe(true);
    expect(images(result.content)).toHaveLength(0);
    const [message] = texts(result.content);
    expect(message).toMatch(/^The scene has 3 problems\. Nothing was drawn\./);
    expect(message).toContain('scene.height');
    expect(message).toContain('scene.children[0].colour');
    expect(message).toContain('scene.children[1].type');
  });

  it('draws each view in place of the scene rotation, labelled in order', async () => {
    const views = [{ x: 0 }, { x: -45 }, { x: -60, y: 30 }];
    const result = await renderScene({ scene: planet, views, preview_size: 128 });
    const all = texts(result.content);
    expect(all[0]).toMatch(/^Drew 3 views/);
    expect(all.filter((t) => t.startsWith('View '))).toEqual([
      'View 1: x 0, y 0, z 0',
      'View 2: x -45, y 0, z 0',
      'View 3: x -60, y 30, z 0',
    ]);
    const pngs = images(result.content);
    expect(pngs).toHaveLength(3);
    expect(pngs[0]?.equals(pngs[1] as Buffer)).toBe(false);
    expect(pngSize(pngs[0] as Buffer)).toEqual({ width: 128, height: 128 });
  });

  it('fits the longer side of a tall scene to the preview size', async () => {
    const result = await renderScene({ scene: lighthouse, preview_size: 300, svg: false });
    expect(pngSize(images(result.content)[0] as Buffer)).toEqual({ width: 240, height: 300 });
    expect(texts(result.content)).toHaveLength(1);
  });

  it('paints white behind a transparent scene in the preview, and keeps a saved PNG transparent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zpup-mcp-'));
    const path = join(dir, 'planet.png');
    const result = await renderScene({ scene: planet, save_to: path, preview_size: 64 });
    expect(texts(result.content)[0]).toContain(`Saved: ${path}`);
    const preview = images(result.content)[0] as Buffer;
    const saved = readFileSync(path);
    expect(hasAlpha(saved)).toBe(true);
    expect(saved.equals(preview)).toBe(false);
  });

  it('saves one SVG per view with numbered names', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zpup-mcp-'));
    const result = await renderScene({
      scene: planet,
      views: [{ x: -10 }, { x: -60 }],
      save_to: join(dir, 'out', 'planet.svg'),
    });
    expect(result.isError).toBeUndefined();
    const first = readFileSync(join(dir, 'out', 'planet-1.svg'), 'utf8');
    const second = readFileSync(join(dir, 'out', 'planet-2.svg'), 'utf8');
    expect(first).toMatch(/^<svg /);
    expect(second).not.toBe(first);
  });

  it('refuses a path that is relative or has another extension', async () => {
    const relative = await renderScene({ scene: planet, save_to: 'planet.svg' });
    expect(relative.isError).toBe(true);
    expect(texts(relative.content)[0]).toMatch(/^save_to: expected an absolute path/);
    const gif = await renderScene({ scene: planet, save_to: '/tmp/planet.gif' });
    expect(gif.isError).toBe(true);
    expect(texts(gif.content)[0]).toMatch(/^save_to: expected a path ending in \.svg or \.png/);
  });

  it('reports warnings with the picture', async () => {
    const result = await renderScene({
      scene: { ...planet, children: [{ type: 'dot', stroke: 10, translate: { x: 500 } }] },
    });
    expect(result.isError).toBeUndefined();
    expect(texts(result.content)[0]).toMatch(/1 warning \(the scene is valid/);
  });
});

describe('mcp: check_scene', () => {
  it('passes a clean scene', () => {
    const result = checkSceneTool({ scene: planet });
    expect(texts(result.content)).toEqual(['The scene is valid. No warnings.']);
  });

  it('returns errors as an error result', () => {
    const result = checkSceneTool({ scene: { ...planet, width: -1 } });
    expect(result.isError).toBe(true);
    expect(texts(result.content)[0]).toContain('scene.width');
  });
});

describe('mcp: render_spin', () => {
  it('sends a small turning SVG back with one picture when asked for one', async () => {
    const result = await renderSpin({ scene: planet, keyframes: 8, preview_frames: 1 });
    const [summary, svg] = texts(result.content);
    expect(summary).toMatch(/^Made a turning SVG of a 120x120 scene/);
    expect(summary).toContain('The picture below is its first frame.');
    expect(svg).toContain('<animate');
    expect((svg as string).length).toBeLessThanOrEqual(INLINE_SVG_LIMIT);
    const pngs = images(result.content);
    expect(pngs).toHaveLength(1);
    expect(pngSize(pngs[0] as Buffer)).toEqual({ width: 512, height: 512 });
  });

  it('shows four stills along the turn by default, each the scene at that angle', async () => {
    const tilted = { ...planet, rotate: { x: -20, y: 30 }, children: [box] };
    const result = await renderSpin({ scene: tilted, keyframes: 8 });
    const all = texts(result.content);
    expect(all[0]).toContain('The 4 pictures below are stills at even steps of the turn.');
    expect(all.filter((t) => t.endsWith('into the turn'))).toEqual([
      '0 degrees into the turn',
      '90 degrees into the turn',
      '180 degrees into the turn',
      '270 degrees into the turn',
    ]);
    const pngs = images(result.content);
    expect(pngs).toHaveLength(4);
    expect(pngSize(pngs[0] as Buffer)).toEqual({ width: 256, height: 256 });

    // The second still is the scene turned a quarter about y, as a plain render draws it.
    const quarter = await renderScene({
      scene: tilted,
      views: [{ x: -20, y: 120 }],
      preview_size: 256,
      svg: false,
    });
    expect(pngs[1]?.equals(images(quarter.content)[0] as Buffer)).toBe(true);
    expect(pngs[1]?.equals(pngs[0] as Buffer)).toBe(false);
  });

  it('steps the stills the other way for a negative turn, about the chosen axis', async () => {
    const tilted = { ...planet, rotate: { x: -20, y: 30 }, children: [box] };
    const result = await renderSpin({
      scene: tilted,
      keyframes: 8,
      axis: 'x',
      direction: 'negative',
      preview_frames: 2,
    });
    const pngs = images(result.content);
    expect(pngs).toHaveLength(2);
    const half = await renderScene({
      scene: tilted,
      views: [{ x: -200, y: 30 }],
      preview_size: 256,
      svg: false,
    });
    expect(pngs[1]?.equals(images(half.content)[0] as Buffer)).toBe(true);
  });

  it('keeps a large one out of the reply and says how to get it', async () => {
    const result = await renderSpin({ scene: lighthouse });
    expect(result.isError).toBeUndefined();
    const all = texts(result.content);
    expect(all.some((t) => t.startsWith('<svg'))).toBe(false);
    expect(all[0]).toContain('Call again with save_to');
    expect(images(result.content)).toHaveLength(4);
  });

  it('writes the file when given a path, and does not send the text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zpup-mcp-'));
    const path = join(dir, 'planet-spin.svg');
    const result = await renderSpin({ scene: planet, keyframes: 8, save_to: path });
    expect(texts(result.content).some((t) => t.startsWith('<svg'))).toBe(false);
    expect(readFileSync(path, 'utf8')).toContain('<animate');
  });

  it('returns a bad option as an error the model can fix', async () => {
    const result = await renderSpin({ scene: planet, keyframes: 2 });
    expect(result.isError).toBe(true);
    expect(texts(result.content)[0]).toContain('keyframes');
  });

  it('refuses to save a turning picture as a PNG', async () => {
    const result = await renderSpin({ scene: planet, save_to: '/tmp/planet.png' });
    expect(result.isError).toBe(true);
    expect(texts(result.content)[0]).toMatch(/^save_to: expected a path ending in \.svg/);
  });
});

describe('mcp: reference', () => {
  it('is the llms.txt that ships with the library', () => {
    const [reference] = texts(getReference().content);
    expect(reference).toBe(readFileSync(new URL('../../llms.txt', import.meta.url), 'utf8'));
  });
});

describe('mcp: over the protocol', () => {
  async function connect() {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    return client;
  }

  it('lists the four tools and the reference', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'check_scene',
      'get_reference',
      'render_scene',
      'render_spin',
    ]);
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual([REFERENCE_URI]);
    const read = await client.readResource({ uri: REFERENCE_URI });
    expect((read.contents[0] as { text: string }).text).toMatch(/^# Zpup/);
  });

  it('draws a scene called through a client', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'render_scene',
      arguments: { scene: planet, views: [{ x: -20, y: 30 }] },
    });
    const content = result.content as Content[];
    expect(result.isError).toBeFalsy();
    expect(images(content)).toHaveLength(1);
  });

  it('rejects arguments that do not fit the schema', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'render_scene',
      arguments: { scene: planet, views: [{ w: 1 }] },
    });
    expect(result.isError).toBe(true);
  });
});
