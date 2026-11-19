import { describe, expect, it } from 'vitest';
import {
  box,
  checkScene,
  checkSceneWarnings,
  compileScene,
  type Node,
  type PathItem,
  pyramid,
  renderSvg,
  type Scene,
} from '../src/index.ts';
import { compilePieces } from '../src/pieces.ts';
import { normalizeScene } from '../src/validate.ts';

const one = (node: Node, rotate = { x: -20, y: 30 }): Scene => ({
  width: 200,
  height: 200,
  rotate,
  children: [node],
});

/** Every face of a node, with the corners of its outline in screen space. */
const faces = (node: Node, rotate = { x: 0, y: 0, z: 0 }) =>
  compilePieces(normalizeScene(one(node)), rotate).map((p) => [
    p.geometry.start,
    ...p.geometry.segments.map((s) => s.to),
  ]);

const paths = (scene: Scene) =>
  compileScene(scene).items.filter((i): i is PathItem => i.kind === 'path');

describe('pyramid', () => {
  it('has a four-sided base and four triangles when it comes to a point', () => {
    const corners = faces(pyramid({ width: 60, height: 40, depth: 50 })).map((f) => f.length);
    expect(corners.sort()).toEqual([3, 3, 3, 3, 4]);
  });

  it('has two four-sided slopes and two triangles when it has a ridge', () => {
    const corners = faces(pyramid({ width: 60, height: 40, depth: 50, ridge: 20 })).map(
      (f) => f.length,
    );
    expect(corners.sort()).toEqual([3, 3, 4, 4, 4]);
  });

  it('stands on its base at the node origin with its top straight above', () => {
    const all = faces(pyramid({ width: 60, height: 40, depth: 50, translate: { y: 10 } })).flat();
    // Screen y: the scene is 200 tall, so y = 0 is at 100.
    expect(Math.max(...all.map((p) => p.y))).toBe(110);
    expect(Math.min(...all.map((p) => p.y))).toBe(70);
    const top = all.filter((p) => p.y === 70);
    expect(top.every((p) => p.x === 100)).toBe(true);
    expect(Math.min(...all.map((p) => p.x))).toBe(70);
    expect(Math.max(...all.map((p) => p.x))).toBe(130);
  });

  it('ends in upright triangles when the ridge is as long as the width', () => {
    const gable = pyramid({ width: 60, height: 40, depth: 50, ridge: 60 });
    const triangles = faces(gable).filter((f) => f.length === 3);
    expect(triangles).toHaveLength(2);
    for (const t of triangles) expect(new Set(t.map((p) => p.x)).size).toBe(1);
    // Seen from the front, a gable roof is a rectangle: only the front slope shows.
    expect(paths(one(gable, { x: 0, y: 0 }))).toHaveLength(1);
  });

  it('shows two slopes from a corner and only the base from below', () => {
    const p = pyramid({ width: 60, height: 40, depth: 50 });
    expect(paths(one(p))).toHaveLength(2);
    expect(paths(one(p, { x: 90, y: 0 }))).toHaveLength(1);
    // From straight above, all four slopes show and the base does not.
    expect(paths(one(p, { x: -90, y: 0 }))).toHaveLength(4);
  });

  it('shades the slopes lighter than upright walls of the same color, and all four differently', () => {
    const p = pyramid({ width: 60, height: 40, depth: 50, color: '#888888' });
    const colors = new Set<string>();
    for (const y of [20, 110, 200, 290]) {
      for (const item of paths(one(p, { x: -20, y }))) colors.add(item.color);
    }
    // Left and right differ; front and rear share a shade, as on a box.
    expect(colors.size).toBe(3);
    for (const c of colors) expect(Number.parseInt(c.slice(1, 3), 16)).toBeGreaterThan(0x88);
  });

  it('takes a color for each face', () => {
    const p = pyramid({
      width: 60,
      height: 40,
      depth: 50,
      color: '#888',
      frontFace: '#f00',
      leftFace: '#0f0',
    });
    expect(
      paths(one(p))
        .map((i) => i.color)
        .sort(),
    ).toEqual(['#0f0', '#f00']);
  });

  it('paints a roof after the walls it overhangs, from every side', () => {
    const hut = (y: number): Scene => ({
      width: 200,
      height: 200,
      rotate: { x: -20, y },
      children: [
        box({ width: 60, height: 40, depth: 44, color: '#111111', shade: false }),
        pyramid({
          width: 70,
          height: 30,
          depth: 54,
          ridge: 30,
          color: '#eeeeee',
          shade: false,
          translate: { y: -20 },
        }),
      ],
    });
    for (let y = 0; y < 360; y += 15) {
      const order = paths(hut(y)).map((i) => i.color);
      expect(order.lastIndexOf('#111111'), `at ${y} degrees`).toBeLessThan(
        order.indexOf('#eeeeee'),
      );
      expect(checkSceneWarnings(hut(y))).toEqual([]);
    }
  });

  it('draws the same picture for the same scene', () => {
    const scene = one(pyramid({ width: 60, height: 40, depth: 50, ridge: 20, color: '#a63' }));
    expect(renderSvg(scene)).toBe(renderSvg(JSON.parse(JSON.stringify(scene))));
    expect(renderSvg(scene)).toMatchInlineSnapshot(`
      "<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
      <path d="M61.52 97.73L86.52 112.54L91.34 64.12Z" fill="#bd8860" stroke="#bd8860" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M86.52 112.54L138.48 102.27L108.66 60.7L91.34 64.12Z" fill="#b57a4e" stroke="#b57a4e" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      "
    `);
  });
});

describe('pyramid: validation', () => {
  const messages = (node: unknown) =>
    checkScene({ width: 100, height: 100, children: [node] }).map((i) => i.message);

  it('needs a width, a height and a depth', () => {
    expect(messages({ type: 'pyramid' })).toEqual([
      'scene.children[0].width: expected a number of at least 0, received nothing. For example 20.',
      'scene.children[0].height: expected a number of at least 0, received nothing. For example 20.',
      'scene.children[0].depth: expected a number of at least 0, received nothing. For example 20.',
    ]);
  });

  it('rejects a ridge longer than the base', () => {
    expect(messages({ type: 'pyramid', width: 40, height: 20, depth: 30, ridge: 50 })).toEqual([
      'scene.children[0].ridge: expected a number from 0 to the width (40), received 50. The ridge runs along x and cannot be longer than the base. Use 40 for a gable roof, or make "width" larger.',
    ]);
    expect(messages({ type: 'pyramid', width: 40, height: 20, depth: 30, ridge: 40 })).toEqual([]);
    expect(messages({ type: 'pyramid', width: 40, height: 20, depth: 30, ridge: -1 })).toHaveLength(
      1,
    );
  });

  it('explains the options people reach for', () => {
    const base = { type: 'pyramid', width: 40, height: 20, depth: 30 };
    expect(messages({ ...base, topFace: '#f00' })[0]).toContain('A pyramid has no top face.');
    expect(messages({ ...base, length: 20 })[0]).toContain(
      'Use "width" and "depth" for the base and "height" for how far the top is above it.',
    );
    expect(messages({ ...base, backface: '#f00' })[0]).toContain('"bottomFace"');
  });

  it('points wedge, prism and roof at the pyramid', () => {
    expect(messages({ type: 'wedge', width: 40, height: 20, depth: 30 })[0]).toContain(
      'use a "pyramid" whose "ridge" equals its "width"',
    );
    expect(messages({ type: 'roof' })[0]).toContain('For a roof use a "pyramid"');
    expect(messages({ type: 'prism' })[0]).toContain('"pyramid"');
  });

  it('draws nothing wrong when it has no size', () => {
    const flat = { width: 100, height: 100, rotate: { x: -20, y: 30 }, children: [] as Node[] };
    for (const p of [
      pyramid({ width: 0, height: 0, depth: 0 }),
      pyramid({ width: 40, height: 0, depth: 30 }),
      pyramid({ width: 40, height: 20, depth: 0, ridge: 40 }),
    ]) {
      const svg = renderSvg({ ...flat, children: [p, box({ width: 20, height: 20, depth: 20 })] });
      expect(svg).not.toContain('NaN');
    }
  });
});
