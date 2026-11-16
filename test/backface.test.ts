import { SaxesParser } from 'saxes';
import { describe, expect, it } from 'vitest';
import { depthOrder } from '../src/depth.ts';
import {
  checkScene,
  checkSceneWarnings,
  compileScene,
  dot,
  ellipse,
  group,
  type Node,
  path,
  rect,
  renderSpinSvg,
  renderSvg,
  type Scene,
} from '../src/index.ts';
import {
  compilePieces,
  depthShapes,
  facesViewer,
  type Piece,
  paintConstraints,
  piecesOverlap,
  visiblePieces,
} from '../src/pieces.ts';
import { facingOf, facingTurns, planSpin, SPIN_STEPS } from '../src/spin.ts';
import { normalizeScene } from '../src/validate.ts';
import { face, HEAD_RADIUS } from './fixtures/face.ts';

interface Element {
  name: string;
  attributes: Record<string, string>;
  children: Element[];
}

function parse(xml: string): Element {
  const parser = new SaxesParser({ xmlns: false });
  const root: Element = { name: '#root', attributes: {}, children: [] };
  const stack = [root];
  parser.on('error', (error) => {
    throw error;
  });
  parser.on('opentag', (tag) => {
    const element: Element = {
      name: tag.name,
      attributes: Object.fromEntries(
        Object.entries(tag.attributes).map(([k, v]) => [k, String(v)]),
      ),
      children: [],
    };
    stack[stack.length - 1]?.children.push(element);
    stack.push(element);
  });
  parser.on('closetag', () => {
    stack.pop();
  });
  parser.write(xml).close();
  return root.children[0] as Element;
}

/** The epoch groups of a spin SVG: the `<use>` references and the stretches of the turn when each is shown. */
function groupsOf(svg: Element): { refs: string[]; shown: [number, number][] }[] {
  return svg.children
    .filter((e) => e.name === 'g')
    .map((g) => {
      const refs = g.children
        .filter((e) => e.name === 'use')
        .map((u) => (u.attributes.href ?? '').split('-').pop() as string);
      const animate = g.children.find((e) => e.name === 'animate');
      if (!animate) return { refs, shown: [[0, 1]] };
      const times = (animate.attributes.keyTimes ?? '').split(';').map(Number);
      const values = (animate.attributes.values ?? '').split(';');
      const shown: [number, number][] = [];
      times.forEach((t, i) => {
        if (values[i] === 'visible') shown.push([t, times[i + 1] ?? 1]);
      });
      return { refs, shown };
    });
}

/** Turns, as fractions, where `front` changes, found by bisection on the compiled pieces. */
function bisectTurns(front: (turn: number) => boolean): number[] {
  const turns: number[] = [];
  const n = 3600;
  for (let k = 0; k < n; k++) {
    let lo = k / n;
    let hi = (k + 1) / n;
    if (front(lo) === front(hi)) continue;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (front(mid) === front(lo)) lo = mid;
      else hi = mid;
    }
    turns.push((lo + hi) / 2);
  }
  return turns;
}

const ball = (children: Node[], extra: Partial<Scene> = {}): Scene => ({
  width: 120,
  height: 120,
  children: [dot({ stroke: 80, color: '#f4c95d' }), ...children],
  ...extra,
});

describe('backface on flat shapes', () => {
  const still = (shape: Node, rotate = {}) =>
    compileScene({ width: 100, height: 100, rotate, children: [shape] }).items;

  it('draws both sides by default and with true', () => {
    expect(still(rect({ width: 20, height: 20, fill: true }), { y: 180 })).toHaveLength(1);
    expect(
      still(rect({ width: 20, height: 20, fill: true, backface: true }), { y: 180 }),
    ).toHaveLength(1);
  });

  it('leaves a shape out with false while its front (local +z) faces away', () => {
    const shape = rect({ width: 20, height: 20, fill: true, backface: false });
    expect(still(shape)).toHaveLength(1);
    expect(still(shape, { y: 89 })).toHaveLength(1);
    expect(still(shape, { y: 91 })).toHaveLength(0);
    expect(still(shape, { y: 180 })).toHaveLength(0);
    // Exactly edge-on it has no area, and counts as turned away.
    expect(still(shape, { y: 90 })).toHaveLength(0);
    expect(still(shape, { x: -90 })).toHaveLength(0);
  });

  it('applies to every flat type and to dots', () => {
    const away = { y: 180 };
    for (const shape of [
      ellipse({ diameter: 20, backface: false }),
      path({ path: [{ x: -10 }, { x: 10 }], backface: false }),
      dot({ stroke: 10, backface: false }),
    ]) {
      expect(still(shape)).toHaveLength(1);
      expect(still(shape, away)).toHaveLength(0);
    }
  });

  it('paints the back in the given color', () => {
    const shape = ellipse({ diameter: 20, fill: true, color: '#e62', backface: '#36c' });
    expect(still(shape)[0]?.color).toBe('#e62');
    expect(still(shape, { y: 180 })[0]?.color).toBe('#36c');
    expect(renderSvg({ width: 50, height: 50, rotate: { y: 135 }, children: [shape] })).toContain(
      'fill="#36c"',
    );
  });

  it('follows the node transforms, the parents and the view', () => {
    const shape = (rotate: { x?: number; y?: number }) =>
      group({ rotate, children: [ellipse({ diameter: 20, fill: true, backface: false })] });
    expect(still(shape({ y: 120 }))).toHaveLength(0);
    expect(still(shape({ y: 120 }), { y: -60 })).toHaveLength(1);
    expect(still(shape({ x: 45 }), { x: 30 })).toHaveLength(1);
    expect(still(shape({ x: 45 }), { x: 50 })).toHaveLength(0);
  });

  it('keeps the front under a mirroring scale in x or y, and moves it with a negative z scale', () => {
    // The front is the side the transformed local +z axis points to, as a
    // normal of the shape's plane, so it turns edge-on exactly with the shape.
    const shape = (scale: { x?: number; y?: number; z?: number }) =>
      ellipse({ diameter: 20, fill: true, backface: false, scale });
    for (const scale of [{ x: -1 }, { y: -1 }, { x: -1, y: -1 }, { x: -2, y: 0.5 }]) {
      expect(still(shape(scale)), JSON.stringify(scale)).toHaveLength(1);
      expect(still(shape(scale), { y: 180 }), JSON.stringify(scale)).toHaveLength(0);
    }
    expect(still(shape({ z: -1 }))).toHaveLength(0);
    expect(still(shape({ z: -1 }), { y: 180 })).toHaveLength(1);
    // A sheared plane still disappears exactly when it is edge-on.
    const sheared = group({
      scale: { x: 3 },
      children: [ellipse({ diameter: 20, fill: true, backface: false, rotate: { y: 30 } })],
    });
    const s = normalizeScene({ width: 100, height: 100, children: [sheared] });
    const piece = (y: number) => compilePieces(s, { x: 0, y, z: 0 })[0] as Piece;
    // Edge-on when the plane's points all share one screen x: find that angle.
    const width = (y: number) => {
      const xs = piece(y).points.map((q) => q.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    let lo = 0;
    let hi = 90;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (piece(mid).front) lo = mid;
      else hi = mid;
    }
    expect(width(lo)).toBeLessThan(1e-6);
  });

  it('flattens a shape with a zero scale into one with no front', () => {
    const shape = ellipse({ diameter: 20, fill: true, backface: false, scale: { x: 0 } });
    expect(still(shape)).toHaveLength(0);
    expect(still({ ...shape, backface: true })).toHaveLength(1);
  });

  it('leaves faces of solids alone', () => {
    const items = (backface: string) =>
      compileScene({
        width: 100,
        height: 100,
        rotate: { y: 180 },
        children: [{ type: 'cylinder', diameter: 20, length: 20, backface }],
      }).items.map((i) => i.color);
    expect(items('#36c')).toContain('#36c');
  });

  it('takes culled shapes out of the depth sort', () => {
    const s = normalizeScene(
      ball([ellipse({ diameter: 10, fill: true, backface: false, rotate: { y: 180 } })]),
    );
    const pieces = compilePieces(s, { x: 0, y: 0, z: 0 });
    expect(pieces[1]?.culled).toBe(true);
    expect(visiblePieces(pieces)).toHaveLength(1);
    expect(paintConstraints(pieces).constraints).toEqual([]);
  });
});

describe('backface validation', () => {
  const messages = (shape: Record<string, unknown>) =>
    checkScene({ width: 100, height: 100, children: [shape] }).map((i) => i.message);

  it('accepts true, false and colors on flat shapes', () => {
    for (const backface of [true, false, '#36c', 'tomato', ' rgb(1, 2, 3) ']) {
      for (const shape of [
        { type: 'ellipse', diameter: 10 },
        { type: 'rect', width: 10, height: 10 },
        { type: 'polygon', sides: 5, radius: 5 },
        { type: 'path', path: [{}] },
      ]) {
        expect(messages({ ...shape, backface }), `${shape.type} ${backface}`).toEqual([]);
      }
    }
  });

  it('explains wrong values', () => {
    expect(messages({ type: 'ellipse', diameter: 10, backface: 'false' })).toMatchInlineSnapshot(`
      [
        "scene.children[0].backface: expected true, false or a CSS color string such as "#e62", received "false". Remove the quotes: false.",
      ]
    `);
    expect(
      messages({ type: 'rect', width: 1, height: 1, backface: 'none' }),
    ).toMatchInlineSnapshot(`
      [
        "scene.children[0].backface: expected true, false or a CSS color string such as "#e62", received "none". Use false to leave the shape out while its front faces away.",
      ]
    `);
    expect(messages({ type: 'path', path: [{}], backface: 'blu' })).toMatchInlineSnapshot(`
      [
        "scene.children[0].backface: expected true, false or a CSS color string such as "#e62", received "blu". Did you mean "blue"?",
      ]
    `);
    expect(messages({ type: 'polygon', sides: 3, radius: 5, backface: 0 })).toMatchInlineSnapshot(`
      [
        "scene.children[0].backface: expected true, false or a CSS color string such as "#e62", received 0.",
      ]
    `);
  });

  it('points groups and solids to the right option', () => {
    expect(messages({ type: 'group', backface: false })[0]).toContain(
      'Groups draw nothing; set "backface" on the shapes inside the group.',
    );
    expect(messages({ type: 'box', width: 1, height: 1, depth: 1, backface: false })[0]).toContain(
      'A box\'s face toward -z is "rearFace".',
    );
    expect(
      messages({ type: 'cylinder', diameter: 1, length: 1, backface: false }),
    ).toMatchInlineSnapshot(`
        [
          "scene.children[0].backface: expected a CSS color string such as "#e62", received false. On a cylinder, "backface" is the color of a face, and faces cannot be left out (only flat shapes take "backface": false). Leave the option out to shade this face from "color".",
        ]
      `);
    expect(messages({ type: 'hemisphere', diameter: 1, backface: '#36c' })).toEqual([]);
  });

  it('warns when every shape is turned away', () => {
    const scene = ball([], { rotate: { y: 180 } });
    scene.children = [ellipse({ diameter: 10, fill: true, backface: false })];
    expect(checkSceneWarnings(scene).map((w) => w.message)).toMatchInlineSnapshot(`
      [
        "scene.children: expected at least one visible shape, received only shapes turned away with "backface": false. They show only while their front (local +z) faces the viewer. Turn them or the view, or remove "backface": false.",
      ]
    `);
  });
});

describe('the depth sort around a sphere', () => {
  const R = 40;
  // Group rotations that point local +z to the front, the side, the top and
  // diagonally up and to the right.
  const placements: Record<string, { x: number; y: number }> = {
    front: { x: 0, y: 0 },
    side: { x: 0, y: 90 },
    top: { x: 90, y: 0 },
    oblique: { x: 45, y: 35.26439 },
  };
  const patches: Record<string, Node> = {
    'ellipse, no stroke': ellipse({ diameter: 16, fill: true, stroke: 0 }),
    'ellipse, stroke 1': ellipse({ diameter: 16, fill: true }),
    'open curve, stroke 1': path({
      path: [
        { x: -8, y: -2 },
        {
          bezier: [
            { x: -4, y: 4 },
            { x: 4, y: 4 },
            { x: 8, y: -2 },
          ],
        },
      ],
    }),
  };

  it('paints a flat piece on a tangent plane after the sphere while it faces the viewer', () => {
    // The piece lies on the plane that touches the sphere, half a unit
    // outside it, so its stroke reaches the sphere but does not cut into it.
    // Facing the viewer, it is then in front of the sphere wherever the two
    // overlap, right up to the sphere's outline.
    const wrong: string[] = [];
    let checked = 0;
    for (const [patchName, patch] of Object.entries(patches)) {
      for (const [where, rotate] of Object.entries(placements)) {
        for (const tilt of [0, -20, 30]) {
          const s = normalizeScene(
            ball(
              [
                group({
                  rotate,
                  children: [{ ...patch, translate: { z: R + 0.5 }, backface: false } as Node],
                }),
              ],
              { rotate: { x: tilt } },
            ),
          );
          for (let step = 0; step < SPIN_STEPS; step++) {
            const pieces = visiblePieces(compilePieces(s, { x: tilt, y: step / 2, z: 0 }));
            const order = depthOrder(depthShapes(pieces));
            const sphere = order.indexOf(0);
            for (let k = 1; k < pieces.length; k++) {
              if (!piecesOverlap(pieces[0] as Piece, pieces[k] as Piece)) continue;
              checked++;
              if (order.indexOf(k) < sphere) {
                wrong.push(`${patchName} at ${where}, tilt ${tilt}, turned ${step / 2}`);
              }
            }
          }
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(10_000);
  }, 20_000);
});

describe('facing turns', () => {
  it('match bisection on the compiled pieces to well under 0.01 degrees', () => {
    const shape = ellipse({ diameter: 10, fill: true, backface: false });
    let compared = 0;
    for (const axis of ['x', 'y', 'z'] as const) {
      for (const sign of [1, -1]) {
        for (const [rotate, view] of [
          [{ x: 20, y: -35 }, { x: -15 }],
          [
            { x: 70, y: 10, z: 30 },
            { x: 40, y: 10 },
          ],
          [{ y: 90 }, {}],
          [{ x: -50 }, { x: -20, z: 15 }],
        ] as const) {
          const s = normalizeScene({
            width: 100,
            height: 100,
            rotate: view,
            children: [group({ rotate, scale: { x: 2, z: -1 }, children: [shape] })],
          });
          const at = (turn: number) =>
            compilePieces(s, {
              ...s.rotate,
              [axis]: s.rotate[axis] + sign * turn * 360,
            })[0] as Piece;
          const f = facingOf(at(0), at(0.25), at(0.5));
          expect(f).toBeDefined();
          if (!f) continue;
          const exact = facingTurns(f);
          const bisected = bisectTurns((t) =>
            facesViewer(at(t).normal as { x: number; y: number; z: number }),
          );
          expect(exact.length, `${axis} ${sign} ${JSON.stringify(rotate)}`).toBe(bisected.length);
          for (const t of exact) {
            // Around the circle: a turn at 0 may be found just before 1.
            const apart = Math.min(
              ...bisected.map((u) => Math.min(Math.abs(t - u), 1 - Math.abs(t - u))),
            );
            expect(apart * 360).toBeLessThan(1e-6);
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(10);
  });
});

describe('renderSpinSvg with backface', () => {
  it('leaves each feature of the face out exactly while it faces away', () => {
    const s = normalizeScene(face);
    const pieces = compilePieces(s);
    const features = pieces.flatMap((p, i) => (p.backface === false ? [i] : []));
    expect(features).toHaveLength(3);
    const at = (turn: number) => compilePieces(s, { ...s.rotate, y: s.rotate.y + turn * 360 });
    const groups = groupsOf(parse(renderSpinSvg(face)));
    const boundaries = groups.flatMap((g) => g.shown.flat());
    for (const i of features) {
      const front = (turn: number) => (at(turn)[i] as Piece).front;
      const turns = bisectTurns(front);
      // Every feature turns away and back once; the epochs end where it does.
      expect(turns).toHaveLength(2);
      for (const t of turns) {
        const nearest = Math.min(...boundaries.map((b) => Math.abs(b - t)));
        expect(nearest * 360, `piece ${i} turns at ${t * 360} degrees`).toBeLessThan(0.001);
      }
      // In every stretch a group is shown, the feature is drawn exactly when
      // it faces the viewer, at its start, middle and end.
      for (const g of groups) {
        for (const [from, to] of g.shown) {
          const drawn = g.refs.includes(String(i));
          for (const t of [from + 1e-5, (from + to) / 2, to - 1e-5]) {
            expect(drawn, `piece ${i} at ${t * 360} degrees`).toBe(front(t));
          }
        }
      }
    }
    // The head is in every group, and nothing else is.
    for (const g of groups) {
      expect(g.refs).toContain('0');
      expect(g.refs.every((r) => r === '0' || features.includes(Number(r)))).toBe(true);
    }
  });

  it('paints every overlapping pair of the face in order', () => {
    const s = normalizeScene(face);
    const epochs = planSpin(s, { axis: 'y', direction: 'positive' });
    const wrong: string[] = [];
    for (const e of epochs) {
      // Checked inside the epoch, where every side is settled.
      for (const step of [e.start + (e.end - e.start) / 4, (e.start + e.end) / 2]) {
        const pieces = compilePieces(s, { ...s.rotate, y: s.rotate.y + (step * 360) / SPIN_STEPS });
        pieces.forEach((p, i) => {
          if (p.culled !== (e.sides[i] === 'hidden')) wrong.push(`piece ${i} side at ${step}`);
        });
        const position: number[] = [];
        e.order.forEach((piece, n) => {
          position[piece] = n;
        });
        for (const [before, after] of paintConstraints(pieces).constraints) {
          if (!((position[before] as number) < (position[after] as number)))
            wrong.push(`${before} before ${after} at ${step}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('starts with the still picture when a shape turns exactly at angle 0', () => {
    // Facing +x, the ellipse is edge-on at the start and turns toward the
    // viewer right after it.
    const scene = ball([
      group({
        rotate: { y: -90 },
        children: [
          ellipse({
            diameter: 10,
            fill: true,
            translate: { z: HEAD_RADIUS + 0.5 },
            backface: false,
          }),
        ],
      }),
    ]);
    const groups = groupsOf(parse(renderSpinSvg(scene)));
    const first = groups.find((g) => g.shown.some(([from]) => from === 0));
    expect(first?.refs).toEqual(['0']);
    expect(renderSvg(scene)).not.toContain('<path');
    const next = groups.find((g) => g.shown.some(([from]) => from > 0 && from < 1e-5));
    expect(next?.refs).toEqual(['0', '1']);
  });

  it('defines a piece that is never shown nowhere, and one that never turns once', () => {
    const scene = ball(
      [
        // Faces up while the scene turns about y with no tilt: always edge-on.
        group({ rotate: { x: 90 }, children: [ellipse({ diameter: 10, backface: false })] }),
        // Faces the viewer while the scene turns about z: always in front.
        ellipse({ diameter: 10, fill: true, translate: { z: 41 }, backface: false }),
      ],
      {},
    );
    const z = parse(renderSpinSvg(scene, { axis: 'z' }));
    const ids = (z.children.find((e) => e.name === 'defs') as Element).children.map((e) =>
      (e.attributes.id ?? '').split('-').pop(),
    );
    const pieceCount = compilePieces(normalizeScene(scene)).length;
    // The outline of the first ellipse is eight pieces, all left out.
    expect(ids).toEqual(['0', String(pieceCount - 1)]);
    expect(groupsOf(z)).toHaveLength(1);
    const y = parse(renderSpinSvg(scene, { axis: 'y' }));
    expect(
      (y.children.find((e) => e.name === 'defs') as Element).children.map((e) =>
        (e.attributes.id ?? '').split('-').pop(),
      ),
    ).toEqual(['0', String(pieceCount - 1)]);
  });

  it('draws a piece with a back color as two definitions and switches between them', () => {
    const scene: Scene = {
      width: 60,
      height: 60,
      children: [rect({ width: 30, height: 20, fill: true, color: '#e62', backface: '#36c' })],
    };
    const svg = parse(renderSpinSvg(scene));
    const defs = (svg.children.find((e) => e.name === 'defs') as Element).children;
    expect(defs.map((e) => [(e.attributes.id ?? '').split('-').pop(), e.attributes.fill])).toEqual([
      ['0', '#e62'],
      ['0b', '#36c'],
    ]);
    const groups = groupsOf(svg);
    const shownAs = (turn: number) =>
      groups.find((g) => g.shown.some(([a, b]) => a <= turn && turn < b))?.refs;
    expect(shownAs(0)).toEqual(['0']);
    expect(shownAs(0.2)).toEqual(['0']);
    expect(shownAs(0.26)).toEqual(['0b']);
    expect(shownAs(0.74)).toEqual(['0b']);
    expect(shownAs(0.76)).toEqual(['0']);
    // The switch is at a quarter turn, where the rectangle is edge-on.
    const ends = groups.flatMap((g) => g.shown.flat()).filter((t) => t > 0 && t < 1);
    expect(ends.map((t) => Math.round(t * 1e6) / 1e6).sort()).toEqual([0.25, 0.25, 0.75, 0.75]);
  });

  it('changes nothing in the plan of a scene that does not use it', () => {
    const scene = ball([ellipse({ diameter: 10, fill: true, translate: { z: 41 } })]);
    const epochs = planSpin(normalizeScene(scene), { axis: 'y', direction: 'positive' });
    for (const e of epochs) {
      expect(Number.isInteger(e.start)).toBe(true);
      expect(e.sides.every((side) => side === 'front')).toBe(true);
    }
  });
});
