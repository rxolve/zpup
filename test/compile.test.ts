import { describe, expect, it } from 'vitest';
import { compileScene, dot, group, path, rect } from '../src/index.ts';

const base = { width: 100, height: 100 };

describe('transform composition', () => {
  it('puts the origin at the center of the image', () => {
    const frame = compileScene({ ...base, children: [dot({ stroke: 10 })] });
    expect(frame.items).toMatchObject([{ kind: 'dot', x: 50, y: 50, radius: 5 }]);
  });

  it('composes translate, rotate and scale from parent to child', () => {
    const frame = compileScene({
      ...base,
      children: [
        group({
          translate: { x: 10 },
          rotate: { z: 90 },
          scale: 2,
          children: [
            group({
              translate: { x: 5 },
              rotate: { z: 90 },
              children: [dot({ translate: { x: 1 }, stroke: 4 })],
            }),
          ],
        }),
      ],
    });
    // Inner: (1,0) rotated 90 -> (0,1), + (5,0) -> (5,1).
    // Outer: scaled -> (10,2), rotated 90 -> (-2,10), + (10,0) -> (8,10).
    expect(frame.items).toMatchObject([{ kind: 'dot', x: 58, y: 60, radius: 4 }]);
  });

  it('lets shapes carry children too', () => {
    const frame = compileScene({
      ...base,
      children: [
        dot({
          translate: { y: 10 },
          stroke: 2,
          children: [dot({ translate: { y: 10 }, stroke: 2 })],
        }),
      ],
    });
    expect(frame.items.map((i) => (i.kind === 'dot' ? i.y : null))).toEqual([60, 70]);
  });

  it('applies the view rotation and zoom to everything', () => {
    const frame = compileScene({
      ...base,
      zoom: 2,
      rotate: { y: 90 },
      children: [dot({ translate: { z: -10 }, stroke: 3 })],
    });
    // z = -10 turns to x = -10, doubled by zoom.
    expect(frame.items).toMatchObject([{ kind: 'dot', x: 30, y: 50, radius: 3 }]);
  });

  it('skips hidden nodes and their children', () => {
    const frame = compileScene({
      ...base,
      children: [group({ visible: false, children: [dot({ stroke: 5 })] }), dot({ stroke: 0 })],
    });
    expect(frame.items).toEqual([]);
  });

  it('projects a rect to path commands', () => {
    const frame = compileScene({
      ...base,
      children: [rect({ width: 20, height: 10, fill: true })],
    });
    expect(frame.items[0]).toMatchObject({
      kind: 'path',
      fill: true,
      commands: [
        { op: 'M', x: 40, y: 45 },
        { op: 'L', x: 60, y: 45 },
        { op: 'L', x: 60, y: 55 },
        { op: 'L', x: 40, y: 55 },
        { op: 'Z' },
      ],
    });
  });

  it('draws a line seen end-on as a dot', () => {
    const frame = compileScene({
      ...base,
      children: [path({ path: [{ z: -5 }, { z: 5 }], stroke: 6 })],
    });
    expect(frame.items).toMatchObject([{ kind: 'dot', radius: 3 }]);
  });
});
