import { describe, expect, it } from 'vitest';
import {
  checkScene,
  compileScene,
  cone,
  cylinder,
  dot,
  type Node,
  type PathItem,
  renderSpinSvg,
  renderSvg,
  type Scene,
} from '../src/index.ts';

const one = (node: Node, rotate: Scene['rotate'] = { x: -20, y: 30 }): Scene => ({
  width: 200,
  height: 200,
  rotate,
  children: [node],
});

const paths = (scene: Scene) =>
  compileScene(scene).items.filter((i): i is PathItem => i.kind === 'path');

/** The extent on screen of everything a scene draws, with curves followed along their length. */
function extent(scene: Scene) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const item of paths(scene)) {
    let from = { x: 0, y: 0 };
    for (const c of item.commands) {
      if (c.op === 'Z') continue;
      if (c.op === 'C') {
        for (let i = 1; i < 32; i++) {
          const t = i / 32;
          const u = 1 - t;
          const at = (p0: number, p1: number, p2: number, p3: number) =>
            u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
          xs.push(at(from.x, c.x1, c.x2, c.x));
          ys.push(at(from.y, c.y1, c.y2, c.y));
        }
      }
      xs.push(c.x);
      ys.push(c.y);
      from = c;
    }
  }
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
}

const shade = { diameter: 60, tipDiameter: 30, length: 40, color: '#e9c46a' };

describe('cone with its tip cut off', () => {
  it('draws a pointed cone as before when tipDiameter is 0 or left out', () => {
    const plain = cone({ diameter: 60, length: 40, color: '#e9c46a' });
    expect(renderSvg(one({ ...plain, tipDiameter: 0 }))).toBe(renderSvg(one(plain)));
    expect(paths(one(plain))).toHaveLength(1);
  });

  it('has a far end, shown when it faces the viewer', () => {
    const node = cone({ ...shade, frontFace: '#111111', backface: '#eeeeee' });
    const fromFront = renderSvg(one(node, { x: 0, y: 20 }));
    expect(fromFront).toContain('#111111');
    expect(fromFront).not.toContain('#eeeeee');
    const fromBehind = renderSvg(one(node, { x: 0, y: 200 }));
    expect(fromBehind).toContain('#eeeeee');
    expect(fromBehind).not.toContain('#111111');
  });

  it('takes up the same room as a cylinder when both ends are the same size', () => {
    for (const rotate of [{ x: -20, y: 30 }, { x: 70, y: -100 }, { x: 0 }, { y: 90 }]) {
      const asCone = extent(
        one(cone({ diameter: 50, tipDiameter: 50, length: 40, translate: { z: -20 } }), rotate),
      );
      const asCylinder = extent(one(cylinder({ diameter: 50, length: 40 }), rotate));
      for (const [i, v] of asCone.entries()) expect(v).toBeCloseTo(asCylinder[i] as number, 1);
    }
  });

  it('is as wide on screen as its wider end, whichever that is', () => {
    const [left, right] = extent(one(cone({ ...shade, rotate: { x: 90 } }), { x: 0 }));
    expect((right as number) - (left as number)).toBeCloseTo(60, 1);
    const flipped = cone({ diameter: 30, tipDiameter: 60, length: 40, rotate: { x: 90 } });
    const [l2, r2] = extent(one(flipped, { x: 0 }));
    expect((r2 as number) - (l2 as number)).toBeCloseTo(60, 1);
  });

  it('draws at every angle, also straight down the axis from either end', () => {
    for (let x = -180; x <= 180; x += 30) {
      for (let y = -180; y <= 180; y += 30) {
        const svg = renderSvg(one(cone(shade), { x, y }));
        expect(svg).not.toContain('NaN');
        expect(svg).toContain('<path');
      }
    }
  });

  it('is painted over what is behind it and under what is in front of it', () => {
    const scene: Scene = {
      width: 200,
      height: 200,
      rotate: { x: 0 },
      children: [
        dot({ stroke: 10, color: '#00f', translate: { z: 60 } }),
        cone({ ...shade, rotate: { x: 90 }, translate: { y: 20 } }),
        dot({ stroke: 10, color: '#f00', translate: { z: -60 } }),
      ],
    };
    const colors = compileScene(scene).items.map((i) => i.color);
    expect(colors[0]).toBe('#f00');
    expect(colors.at(-1)).toBe('#00f');
  });

  it('turns', () => {
    const svg = renderSpinSvg(one(cone(shade)), { keyframes: 8 });
    expect(svg).toContain('<animate');
    expect(svg).not.toContain('NaN');
  });

  it('checks tipDiameter and says when frontFace has no end to color', () => {
    const messages = (node: object) => checkScene(one(node as Node)).map((i) => i.message);
    expect(messages({ type: 'cone', diameter: 20, length: 10, tipDiameter: -1 })[0]).toMatch(
      /tipDiameter: expected a number of at least 0/,
    );
    expect(messages({ type: 'cone', diameter: 20, length: 10, frontFace: '#fff' })[0]).toMatch(
      /frontFace: expected no "frontFace" on a cone that ends in a point/,
    );
    expect(messages({ type: 'cone', diameter: 20, length: 10, topDiameter: 5 })[0]).toMatch(
      /Use "tipDiameter"/,
    );
    expect(messages({ type: 'frustum', diameter: 20, length: 10 })[0]).toMatch(
      /use a "cone" with "tipDiameter"/,
    );
    expect(messages({ type: 'cone', diameter: 20, length: 10, tipDiameter: 30 })).toEqual([]);
  });
});
