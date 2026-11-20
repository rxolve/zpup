import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { lighthouse } from '../../examples/lighthouse.ts';
import { applyChanges, parsePath } from '../src/changes.ts';
import { createServer, REFERENCE_URI } from '../src/create.ts';
import {
  type Content,
  checkSceneTool,
  getReference,
  getScene,
  INLINE_SVG_LIMIT,
  type Memory,
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
    expect(all.filter((t) => t.startsWith('View ')).map((t) => t.split('. ')[0])).toEqual([
      'View 1: x 0, y 0, z 0',
      'View 2: x -45, y 0, z 0',
      'View 3: x -60, y 30, z 0',
    ]);
    expect(all.filter((t) => t.startsWith('View ')).every((t) => t.includes('Space around'))).toBe(
      true,
    );
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

describe('mcp: framing', () => {
  const dotAt = (x: number, y: number) => ({
    width: 100,
    height: 80,
    children: [{ type: 'dot', stroke: 20, translate: { x, y } }],
  });

  it('gives the empty space on each side of the drawing', async () => {
    const result = await renderScene({ scene: dotAt(0, 0), svg: false });
    expect(texts(result.content)[0]).toContain(
      'Space around the drawing, in pixels: left 40, right 40, top 30, bottom 30.',
    );
  });

  it('says where the drawing is cut off and by how much', async () => {
    const result = await renderScene({ scene: dotAt(45, -40), svg: false });
    expect(texts(result.content)[0]).toContain(
      'left 85, right -5, top -10, bottom 70. It is cut off at the right by 5 and the top by 10.',
    );
  });

  it('counts the width of a stroke', async () => {
    const line = {
      width: 100,
      height: 80,
      children: [{ type: 'path', path: [{ x: -30 }, { x: 30 }], stroke: 10 }],
    };
    const result = await renderScene({ scene: line, svg: false });
    expect(texts(result.content)[0]).toContain('left 15, right 15, top 35, bottom 35.');
  });

  it('says so when nothing is drawn', async () => {
    const result = await renderScene({
      scene: { width: 100, height: 80, children: [] },
      svg: false,
    });
    expect(texts(result.content)[0]).toContain('Nothing is drawn.');
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

describe('mcp: changes', () => {
  it('reads the path form the errors use, with or without "scene.", and JSON Pointer', () => {
    expect(parsePath('children[2].translate.y')).toEqual(['children', 2, 'translate', 'y']);
    expect(parsePath('scene.children[0]')).toEqual(['children', 0]);
    expect(parsePath('/children/2/color')).toEqual(['children', 2, 'color']);
    expect(parsePath('scene')).toEqual([]);
    expect(() => parsePath('children[x]')).toThrow(/cannot read/);
    expect(() => parsePath('__proto__.a')).toThrow(/cannot be used/);
  });

  it('sets, removes, inserts and appends in order, on a copy', () => {
    const next = applyChanges(planet, [
      { op: 'set', path: 'children[0].color', value: '#000' },
      { op: 'set', path: 'rotate.z', value: 5 },
      { op: 'insert', path: 'children[0]', value: { type: 'dot', stroke: 2 } },
      { op: 'append', path: 'children', value: { type: 'dot', stroke: 3 } },
      { op: 'remove', path: 'children[2]' },
      { op: 'remove', path: 'children[1].stroke' },
    ]) as typeof planet;
    expect(next.rotate).toEqual({ x: -20, y: 30, z: 5 });
    expect(next.children).toEqual([
      { type: 'dot', stroke: 2 },
      { type: 'dot', color: '#000' },
      { type: 'dot', stroke: 3 },
    ]);
    expect(planet.children).toHaveLength(2);
    expect(planet.children[0]?.color).toBe('#e62');
  });

  it('starts a path at the shape that has the id', () => {
    const scene = {
      width: 10,
      height: 10,
      children: [
        { type: 'dot', id: 'sun' },
        {
          type: 'group',
          id: 'tree',
          children: [{ type: 'dot', id: 'top' }, { type: 'dot' }],
        },
      ],
    };
    expect(parsePath('#top.color', scene)).toEqual(['children', 1, 'children', 0, 'color']);
    expect(parsePath('#tree.children[1].stroke', scene)).toEqual([
      'children',
      1,
      'children',
      1,
      'stroke',
    ]);
    const next = applyChanges(scene, [
      { op: 'remove', path: '#sun' },
      { op: 'set', path: '#top.color', value: '#0a0' },
      { op: 'append', path: '#tree.children', value: { type: 'dot', id: 'new' } },
      { op: 'insert', path: '#tree', value: { type: 'dot', id: 'before' } },
    ]) as typeof scene;
    expect(next.children.map((c) => c.id)).toEqual(['before', 'tree']);
    expect(next.children[1]?.children).toEqual([
      { type: 'dot', id: 'top', color: '#0a0' },
      { type: 'dot' },
      { type: 'dot', id: 'new' },
    ]);
  });

  it('copies a shape to the end of its list, with what differs put over it', () => {
    const scene = {
      width: 10,
      height: 10,
      children: [
        {
          type: 'group',
          id: 'tree',
          translate: { x: -20, y: 5 },
          children: [{ type: 'dot', id: 'top', stroke: 4 }],
        },
        { type: 'dot' },
      ],
    };
    const next = applyChanges(scene, [
      { op: 'copy', path: '#tree', value: { id: 'tree2', translate: { x: 30 }, scale: 0.5 } },
      { op: 'copy', path: 'children[1]' },
      { op: 'set', path: '#top.stroke', value: 9 },
      { op: 'copy', path: '#tree2.children[0]', value: { color: '#0a0' } },
    ]) as { children: unknown[] };
    expect(next.children).toEqual([
      {
        type: 'group',
        id: 'tree',
        translate: { x: -20, y: 5 },
        children: [{ type: 'dot', id: 'top', stroke: 9 }],
      },
      { type: 'dot' },
      {
        type: 'group',
        id: 'tree2',
        translate: { x: 30 },
        scale: 0.5,
        children: [
          { type: 'dot', stroke: 4 },
          { type: 'dot', stroke: 4, color: '#0a0' },
        ],
      },
      { type: 'dot' },
    ]);
    expect(scene.children).toHaveLength(2);
  });

  it('says what a copy needs', () => {
    const fail = (path: string, value?: unknown) => {
      try {
        applyChanges(planet, [{ op: 'copy', path, value }]);
      } catch (e) {
        return (e as Error).message;
      }
      return 'no error';
    };
    expect(fail('rotate')).toMatch(/copy needs a shape in a list.*"rotate" is not one/);
    expect(fail('children[0].color')).toMatch(/copy needs a shape in a list/);
    expect(fail('children[4]')).toMatch(/nothing at "children\[4\]"/);
    expect(fail('children[0]', 5)).toMatch(/the value of a copy is an object/);
    expect(fail('scene')).toMatch(/Pass scene to replace it/);
  });

  it('says when no shape or more than one has the id', () => {
    const scene = {
      width: 10,
      height: 10,
      children: [
        { type: 'dot', id: 'a' },
        { type: 'group', children: [{ type: 'dot', id: 'a' }] },
      ],
    };
    const fail = (path: string) => {
      try {
        applyChanges(scene, [{ op: 'set', path, value: 1 }]);
      } catch (e) {
        return (e as Error).message;
      }
      return 'no error';
    };
    expect(fail('#roof.color')).toBe('changes[0]: no shape has the id "roof".');
    expect(fail('#a.stroke')).toBe(
      'changes[0]: 2 shapes have the id "a" (children[0], children[1].children[0]). Use one of those paths.',
    );
  });

  it('makes the list when appending to a group that has no children', () => {
    const next = applyChanges({ width: 1, height: 1, children: [{ type: 'group' }] }, [
      { op: 'append', path: 'children[0].children', value: { type: 'dot' } },
    ]);
    expect(next).toEqual({
      width: 1,
      height: 1,
      children: [{ type: 'group', children: [{ type: 'dot' }] }],
    });
  });

  it('says which change is wrong and what is there', () => {
    const fail = (op: 'set' | 'remove' | 'insert' | 'append', path: string, value?: unknown) => {
      try {
        applyChanges(planet, [
          { op: 'set', path: 'width', value: 100 },
          { op, path, value },
        ]);
      } catch (e) {
        return (e as Error).message;
      }
      return 'no error';
    };
    expect(fail('set', 'children[7].color', 'red')).toBe(
      'changes[1]: nothing at "children[7]": it has 2 items, [0] to [1].',
    );
    expect(fail('remove', 'children[0].colour')).toBe(
      'changes[1]: nothing at "children[0].colour".',
    );
    expect(fail('set', 'children.color', 'red')).toMatch(/"children" is a list/);
    expect(fail('insert', 'children[3]', {})).toMatch(/cannot insert at "children\[3\]"/);
    expect(fail('insert', 'children', {})).toMatch(/insert needs a place in a list/);
    expect(fail('append', 'children[0]', {})).toMatch(/"children\[0\]" is not a list/);
    expect(fail('set', 'children[0].color')).toBe('changes[1]: "set" needs a value.');
    expect(fail('set', 'scene', {})).toMatch(/Pass scene to replace it/);
  });
});

describe('mcp: scene memory', () => {
  it('has nothing to draw before a scene is sent', async () => {
    const memory: Memory = {};
    const result = await renderScene({}, memory);
    expect(result.isError).toBe(true);
    expect(texts(result.content)[0]).toMatch(/^scene: there is no scene yet\. Pass scene\./);
    expect(getScene(memory).isError).toBe(true);
  });

  it('draws the remembered scene again when scene is left out', async () => {
    const memory: Memory = {};
    const first = await renderScene({ scene: planet, preview_size: 64 }, memory);
    const again = await renderScene({ preview_size: 64 }, memory);
    expect(texts(again.content)[0]).toMatch(/^Used the remembered scene\. Drew 1 view/);
    expect(images(again.content)[0]?.equals(images(first.content)[0] as Buffer)).toBe(true);
    const views = await renderScene({ views: [{ x: -90 }], preview_size: 64, svg: false }, memory);
    expect(images(views.content)[0]?.equals(images(first.content)[0] as Buffer)).toBe(false);
  });

  it('applies changes to the remembered scene and keeps the result', async () => {
    const memory: Memory = {};
    const first = await renderScene({ scene: planet, preview_size: 64 }, memory);
    const changed = await renderScene(
      {
        changes: [{ op: 'set', path: 'children[0].color', value: '#06c' }],
        preview_size: 64,
      },
      memory,
    );
    expect(texts(changed.content)[0]).toMatch(/^Applied 1 change to the remembered scene\. Drew/);
    expect(texts(changed.content)[1]).toContain('#06c');
    expect(images(changed.content)[0]?.equals(images(first.content)[0] as Buffer)).toBe(false);
    expect(planet.children[0]?.color).toBe('#e62');

    const kept = JSON.parse(texts(getScene(memory).content)[0] as string);
    expect(kept.children[0].color).toBe('#06c');
    const spin = await renderSpin({ preview_frames: 1, preview_size: 64 }, memory);
    expect(texts(spin.content)[0]).toMatch(/^Used the remembered scene\. Made a turning SVG/);
    expect(texts(spin.content).at(-1)).toContain('#06c');
  });

  it('draws a copy made from the remembered scene', async () => {
    const memory: Memory = {};
    const first = await renderScene({ scene: planet, svg: false, preview_size: 64 }, memory);
    const result = await renderScene(
      {
        changes: [
          { op: 'copy', path: 'children[0]', value: { stroke: 12, translate: { x: 40, y: -40 } } },
        ],
        svg: false,
        preview_size: 64,
      },
      memory,
    );
    expect(result.isError).toBeUndefined();
    expect(memory.scene?.children).toHaveLength(3);
    expect(images(result.content)[0]?.equals(images(first.content)[0] as Buffer)).toBe(false);
  });

  it('changes nothing when the changed scene is not valid', async () => {
    const memory: Memory = {};
    await renderScene({ scene: planet, svg: false, preview_size: 64 }, memory);
    const result = await renderScene(
      {
        changes: [
          { op: 'set', path: 'children[0].color', value: '#06c' },
          { op: 'set', path: 'children[1].colour', value: 'red' },
        ],
      },
      memory,
    );
    expect(result.isError).toBe(true);
    const [message] = texts(result.content);
    expect(message).toMatch(/^With these changes the scene has 1 problem\. Nothing was changed/);
    expect(message).toContain('scene.children[1].colour');
    expect(memory.scene).toEqual(planet);
  });

  it('changes nothing when a change cannot be applied', async () => {
    const memory: Memory = {};
    await renderScene({ scene: planet, svg: false, preview_size: 64 }, memory);
    const result = await renderScene({ changes: [{ op: 'remove', path: 'children[5]' }] }, memory);
    expect(result.isError).toBe(true);
    expect(texts(result.content)[0]).toBe(
      'changes[0]: nothing at "children[5]": it has 2 items, [0] to [1].\nNothing was changed or drawn. The remembered scene is as it was.',
    );
    expect(memory.scene).toEqual(planet);
  });

  it('does not remember an invalid scene, and keeps the last valid one', async () => {
    const memory: Memory = {};
    await renderScene({ scene: planet, svg: false, preview_size: 64 }, memory);
    const bad = await renderScene({ scene: { width: 10 } }, memory);
    expect(bad.isError).toBe(true);
    expect(memory.scene).toEqual(planet);
  });

  it('applies changes to a scene sent in the same call', async () => {
    const memory: Memory = {};
    const result = await renderScene(
      {
        scene: planet,
        changes: [{ op: 'remove', path: 'children[1]' }],
        svg: false,
        preview_size: 64,
      },
      memory,
    );
    expect(texts(result.content)[0]).toMatch(/^Applied 1 change to the scene\. Drew/);
    expect(memory.scene?.children).toHaveLength(1);
  });

  it('remembers a scene that check_scene found valid', () => {
    const memory: Memory = {};
    checkSceneTool({ scene: planet }, memory);
    expect(memory.scene).toEqual(planet);
    expect(texts(checkSceneTool({}, memory).content)[0]).toMatch(
      /^Used the remembered scene\. The scene is valid\./,
    );
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

  it('lists the five tools and the reference', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'check_scene',
      'get_reference',
      'get_scene',
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

  it('keeps one scene for the connection, across tools', async () => {
    const client = await connect();
    await client.callTool({ name: 'check_scene', arguments: { scene: planet } });
    const drawn = await client.callTool({
      name: 'render_scene',
      arguments: {
        changes: [{ op: 'append', path: 'children', value: { type: 'dot', stroke: 6 } }],
        svg: false,
        preview_size: 64,
      },
    });
    expect(drawn.isError).toBeFalsy();
    expect(texts(drawn.content as Content[])[0]).toMatch(/^Applied 1 change to the remembered/);
    const kept = await client.callTool({ name: 'get_scene', arguments: {} });
    expect(JSON.parse(texts(kept.content as Content[])[0] as string).children).toHaveLength(3);

    const other = await connect();
    const empty = await other.callTool({ name: 'get_scene', arguments: {} });
    expect(empty.isError).toBe(true);
  });

  it('rejects a change with an unknown op', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'render_scene',
      arguments: { scene: planet, changes: [{ op: 'replace', path: 'width', value: 1 }] },
    });
    expect(result.isError).toBe(true);
    expect(texts(result.content as Content[])[0]).toContain('"set"');
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
