import { describe, expect, it } from 'vitest';
import { lighthouse } from '../examples/lighthouse.ts';
import { pup } from '../examples/pup.ts';
import { compareShapes, type DepthShape, depthOrder, meanDepthOrder } from '../src/depth.ts';
import {
  box,
  compileScene,
  cylinder,
  dot,
  ellipse,
  hemisphere,
  path,
  rect,
  type Scene,
} from '../src/index.ts';
import { compilePieces, paintConstraints, positions } from '../src/pieces.ts';
import { normalizeScene } from '../src/validate.ts';

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

  it('sees a sphere over the edge of a filled area even when its center is outside it', () => {
    // A flat square, tilted away from the viewer, and a sphere whose center is
    // just outside one edge but whose front bulges over it. Mean depth alone
    // would put the square in front; where they overlap, the sphere is closer.
    // Every point that used to be sampled lay exactly on the square's edge,
    // where the inside test can go either way, so the answer flickered as the
    // shapes turned.
    for (let turn = 0; turn < 90; turn += 7) {
      const [sin, cos] = [Math.sin((turn * Math.PI) / 180), Math.cos((turn * Math.PI) / 180)];
      const at = (u: number, v: number) => ({
        x: u * cos - v * sin,
        y: u * sin + v * cos,
        z: 10 + v * 0.3,
      });
      const square: DepthShape = {
        points: [at(0, -50), at(100, -50), at(100, 50), at(0, 50)],
        closed: true,
        fill: true,
        radius: 0,
      };
      for (const offset of [0.5, 2, 5, 8]) {
        const center = at(-offset, 0);
        const sphere: DepthShape = {
          points: [{ ...center, z: 5 }],
          closed: false,
          fill: false,
          radius: 10,
        };
        expect(compareShapes(sphere, square)).toBe(1);
        expect(depthOrder([sphere, square])).toEqual([1, 0]);
      }
    }
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

describe('depth sorting while the view turns', () => {
  // The pup, turned a full circle in half-degree steps. For every two pieces
  // that overlap on screen, record which one the sorter paints first.
  const s = normalizeScene(pup);
  const STEPS = 720;
  const names = compilePieces(s).map((p) => p.nodeId);
  const history = new Map<string, Int8Array>();
  const turns = Array.from({ length: STEPS }, (_, step) => {
    const pieces = compilePieces(s, { ...s.rotate, y: s.rotate.y + step / 2 });
    const { order, constraints } = paintConstraints(pieces);
    for (const [before, after] of constraints) {
      const key = `${Math.min(before, after)}|${Math.max(before, after)}`;
      const line = history.get(key) ?? new Int8Array(STEPS);
      history.set(key, line);
      line[step] = before < after ? 1 : -1;
    }
    return positions(order);
  });

  it('never flips a pair of overlapping pieces back within 2 degrees', () => {
    const flickers: string[] = [];
    for (const [key, line] of history) {
      for (let step = 0; step < STEPS; step++) {
        const a = line[step] as number;
        const b = line[(step + 1) % STEPS] as number;
        if (a === 0 || b === 0 || a === b) continue;
        // The pair just changed sides; it must stay on the new side for at
        // least 4 steps of continued overlap.
        for (let k = 1; k <= 4; k++) {
          const next = line[(step + k) % STEPS] as number;
          if (next === 0) break;
          if (next !== b) {
            flickers.push(`${key} at ${(step + 1) / 2} degrees`);
            break;
          }
        }
      }
    }
    expect(flickers).toEqual([]);
  });

  it('keeps the legs and paws in front of the shadow they stand on', () => {
    const shadow = names.indexOf('shadow');
    const standing = ['left-front-leg', 'right-front-leg', 'left-hind-paw', 'right-hind-paw'].map(
      (id) => names.indexOf(id),
    );
    expect(Math.min(shadow, ...standing)).toBeGreaterThanOrEqual(0);
    let overlapping = 0;
    turns.forEach((position, step) => {
      for (const piece of standing) {
        const key = `${Math.min(shadow, piece)}|${Math.max(shadow, piece)}`;
        if (!history.get(key)?.[step]) continue;
        overlapping++;
        expect(position[piece] as number, `${names[piece]} at ${step / 2} degrees`).toBeGreaterThan(
          position[shadow] as number,
        );
      }
    });
    // They do overlap for most of the turn.
    expect(overlapping).toBeGreaterThan(STEPS * 3);
  });
});

/**
 * Time limit for tests that depth-sort a whole turn (720 steps). Locally they
 * take under a second; CI machines have been 3 to 4 times slower.
 */
const FULL_TURN_TIMEOUT = 20_000;

describe('depth sorting of solids while the view turns', () => {
  /** For every pair of overlapping pieces, which one is painted first at each half degree. */
  const sides = (scene: Scene) => {
    const s = normalizeScene(scene);
    const steps = 720;
    const history = new Map<string, Int8Array>();
    for (let step = 0; step < steps; step++) {
      const pieces = compilePieces(s, { ...s.rotate, y: s.rotate.y + step / 2 });
      for (const [before, after] of paintConstraints(pieces).constraints) {
        const key = `${Math.min(before, after)}|${Math.max(before, after)}`;
        const line = history.get(key) ?? new Int8Array(steps);
        history.set(key, line);
        line[step] = before < after ? 1 : -1;
      }
    }
    return { history, names: compilePieces(s).map((p) => p.nodeId) };
  };
  const flickers = (scene: Scene) => {
    const { history, names } = sides(scene);
    const found: string[] = [];
    for (const [key, line] of history) {
      for (let step = 0; step < line.length; step++) {
        const a = line[step] as number;
        const b = line[(step + 1) % line.length] as number;
        if (a === 0 || b === 0 || a === b) continue;
        for (let k = 1; k <= 4; k++) {
          const next = line[(step + k) % line.length] as number;
          if (next === 0) break;
          if (next !== b) {
            const [i, j] = key.split('|').map(Number);
            found.push(`${names[i as number]}/${names[j as number]} at ${(step + 1) / 2}`);
            break;
          }
        }
      }
    }
    return found;
  };

  const mug: Scene = {
    width: 240,
    height: 240,
    rotate: { x: -25, y: 20 },
    children: [
      cylinder({
        id: 'body',
        diameter: 90,
        length: 100,
        rotate: { x: 90 },
        color: '#4a7bd0',
        frontFace: '#5b3a29',
      }),
      path({
        id: 'handle',
        translate: { x: 44 },
        path: [{ y: -30 }, { bezier: [{ x: 34, y: -30 }, { x: 34, y: 26 }, { y: 26 }] }],
        stroke: 12,
        color: '#4a7bd0',
      }),
      ellipse({
        id: 'saucer',
        translate: { y: 52 },
        rotate: { x: 90 },
        diameter: 150,
        fill: true,
        stroke: 4,
        color: '#eee',
      }),
    ],
  };
  const robot: Scene = {
    width: 240,
    height: 300,
    rotate: { x: -15, y: 30 },
    children: [
      box({ id: 'body', width: 70, height: 80, depth: 44, color: '#8aa1b1' }),
      box({
        id: 'head',
        translate: { y: -64 },
        width: 54,
        height: 48,
        depth: 40,
        color: '#8aa1b1',
      }),
      ...[-1, 1].flatMap((side) => [
        box({
          id: `arm${side}`,
          translate: { x: side * 45 },
          width: 20,
          height: 70,
          depth: 20,
          color: '#6d8594',
        }),
        box({
          id: `leg${side}`,
          translate: { x: side * 18, y: 70 },
          width: 24,
          height: 60,
          depth: 26,
          color: '#556',
        }),
        dot({
          id: `eye${side}`,
          translate: { x: side * 12, y: -66, z: 21 },
          stroke: 9,
          color: '#222',
        }),
      ]),
      hemisphere({
        id: 'antenna',
        translate: { y: -88 },
        rotate: { x: 90 },
        diameter: 14,
        color: '#e33',
      }),
    ],
  };

  // Each scene is depth-sorted at every half degree of a whole turn, so each
  // gets its own test and a generous time limit (see FULL_TURN_TIMEOUT).
  it(
    'never flips a pair back within 2 degrees: lighthouse',
    () => {
      // The lighthouse includes a door and a window on round walls, which
      // overlap the wall only by a pixel or two as they pass its edge.
      expect(flickers(lighthouse)).toEqual([]);
    },
    FULL_TURN_TIMEOUT,
  );

  it(
    'never flips a pair back within 2 degrees: mug',
    () => {
      expect(flickers(mug)).toEqual([]);
    },
    FULL_TURN_TIMEOUT,
  );

  it(
    'never flips a pair back within 2 degrees: robot',
    () => {
      expect(flickers(robot)).toEqual([]);
    },
    FULL_TURN_TIMEOUT,
  );

  it('keeps the handle in front of the mug on its side of the mug and behind it on the far side', () => {
    const s = normalizeScene(mug);
    const front = (y: number) => {
      const pieces = compilePieces(s, { ...s.rotate, y });
      const { order } = paintConstraints(pieces);
      const position = positions(order);
      const body = pieces.findIndex((p) => p.nodeId === 'body' && p.layer === 0);
      const handle = pieces.map((p, i) => (p.nodeId === 'handle' ? i : -1)).filter((i) => i >= 0);
      return handle.every((i) => (position[i] as number) > (position[body] as number));
    };
    expect(front(-60)).toBe(true); // handle toward the viewer
    expect(front(120)).toBe(false); // handle behind the mug
  });
});
