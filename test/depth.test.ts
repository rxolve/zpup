import { describe, expect, it } from 'vitest';
import { type DepthShape, depthOrder, meanDepthOrder } from '../src/depth.ts';
import { compileScene, dot, ellipse, path, rect } from '../src/index.ts';

const line = (
  a: [number, number, number],
  b: [number, number, number],
  radius = 2,
): DepthShape => ({
  points: [a, b].map(([x, y, z]) => ({ x, y, z })),
  closed: false,
  fill: false,
  radius,
});

describe('depthOrder', () => {
  it('orders shapes that do not overlap by mean depth', () => {
    const shapes = [line([0, 0, 5], [10, 0, 5]), line([0, 50, -5], [10, 50, -5])];
    expect(depthOrder(shapes)).toEqual([1, 0]);
  });

  it('keeps input order for ties', () => {
    const shapes = [
      line([0, 0, 0], [10, 0, 0]),
      line([5, -5, 0], [5, 5, 0]),
      line([0, 0, 0], [10, 10, 0]),
    ];
    expect(depthOrder(shapes)).toEqual([0, 1, 2]);
  });

  it('compares overlapping shapes where they overlap, not at their centers', () => {
    // A long stick that is mostly far away but passes in front of a short
    // stick where they cross.
    const long = line([0, -50, 50], [0, 50, -250]);
    const short = line([-50, -40, 0], [50, -40, 0]);
    expect(meanDepthOrder([long, short])).toEqual([0, 1]); // center-based: wrong
    expect(depthOrder([long, short])).toEqual([1, 0]); // long is painted last
  });

  it('orders two overlapping spheres whose centers do not cover each other', () => {
    const sphere = (x: number, z: number): DepthShape => ({
      points: [{ x, y: 0, z }],
      closed: false,
      fill: false,
      radius: 10,
    });
    expect(depthOrder([sphere(0, 5), sphere(15, 0)])).toEqual([1, 0]);
    expect(depthOrder([sphere(0, 0), sphere(15, 5)])).toEqual([0, 1]);
  });

  it('terminates and stays deterministic when shapes form a cycle', () => {
    // Three sticks, each passing over the next.
    const shapes = [
      line([-20, -10, 10], [20, -10, -10]),
      line([15, -20, 10], [-5, 20, -10]),
      line([5, 20, 10], [-15, -20, -10]),
    ];
    const order = depthOrder(shapes);
    expect([...order].sort()).toEqual([0, 1, 2]);
    expect(depthOrder(shapes)).toEqual(order);
  });
});

describe('depth sorting in a scene', () => {
  const ids = (scene: Parameters<typeof compileScene>[0]) =>
    compileScene(scene).items.map((i) => i.nodeId);

  it('paints a dot standing on the far side of a tilted floor after the floor', () => {
    // Seen from above. The dot's center is farther away than the floor's
    // center, so center-based sorting would hide it behind the floor.
    const order = ids({
      width: 200,
      height: 200,
      rotate: { x: -30 },
      children: [
        dot({ id: 'dot', translate: { y: -10, z: -80 }, stroke: 20 }),
        rect({ id: 'floor', rotate: { x: 90 }, width: 200, height: 200, fill: true, stroke: 0 }),
      ],
    });
    expect(order).toEqual(['floor', 'dot']);
  });

  it('flips the order when the view turns around', () => {
    const children = [
      dot({ id: 'head', stroke: 40 }),
      dot({ id: 'nose', translate: { z: 22 }, stroke: 8 }),
    ];
    expect(ids({ width: 100, height: 100, children })).toEqual(['head', 'nose']);
    expect(ids({ width: 100, height: 100, rotate: { y: 180 }, children })).toEqual([
      'nose',
      'head',
    ]);
  });

  it('threads a ring around a sphere: back half, sphere, front half', () => {
    const order = ids({
      width: 100,
      height: 100,
      children: [
        ellipse({ id: 'ring', diameter: 60, stroke: 4, rotate: { x: 70 } }),
        dot({ id: 'planet', stroke: 36 }),
      ],
    });
    const planet = order.indexOf('planet');
    expect(planet).toBeGreaterThan(0);
    expect(planet).toBeLessThan(order.length - 1);
  });

  it('joins an outline back into one closed path when nothing interrupts it', () => {
    const frame = compileScene({ width: 100, height: 100, children: [ellipse({ diameter: 40 })] });
    expect(frame.items).toHaveLength(1);
    expect(frame.items[0]).toMatchObject({ kind: 'path' });
    const commands = frame.items[0]?.kind === 'path' ? frame.items[0].commands : [];
    expect(commands.at(-1)).toEqual({ op: 'Z' });
  });

  it('keeps a line in front of a coplanar filled shape', () => {
    const order = ids({
      width: 100,
      height: 100,
      children: [
        path({ id: 'mouth', path: [{ x: -5 }, { x: 5 }], stroke: 2 }),
        ellipse({ id: 'face', diameter: 40, fill: true, stroke: 0 }),
      ],
    });
    expect(order).toEqual(['face', 'mouth']);
  });
});
