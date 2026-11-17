import { describe, expect, it } from 'vitest';
import { lighthouse } from '../../examples/lighthouse.ts';
import { pup } from '../../examples/pup.ts';
import { surfaceDepth } from '../../src/solids.ts';
import { normalizeScene } from '../../src/validate.ts';
import { scoreReply } from '../lib/score.ts';
import {
  checkView,
  normalizeColor,
  type Point,
  type Primitive,
  solidFrame,
  summarizeViews,
} from '../lib/turns.ts';
import { zpupTurnErrors } from '../lib/turns-zpup.ts';
import { runZdog } from '../lib/zdog.ts';

const size = { width: 100, height: 100 };
const p = (x: number, y: number, z: number): Point => ({ x, y, z });
const square = (x0: number, y0: number, x1: number, y1: number, z: number, color: string) => ({
  color,
  fill: { rings: [[p(x0, y0, z), p(x1, y0, z), p(x1, y1, z), p(x0, y1, z)]] },
});

describe('checkView', () => {
  const near = square(20, 20, 60, 60, 10, '#c33');
  const far = square(40, 40, 80, 80, -10, '#36c');

  it('finds nothing wrong when shapes are painted back to front', () => {
    // 40x40 + 40x40 - 20x20 overlap.
    expect(checkView([far, near], size, 1)).toEqual({ covered: 2800, wrong: 0 });
  });

  it('flags the overlap when the same shapes are painted front to back', () => {
    expect(checkView([near, far], size, 1)).toEqual({ covered: 2800, wrong: 400 });
  });

  it('does not flag an overlap that cannot be seen: same color, or closer than the tolerance', () => {
    expect(checkView([near, { ...far, color: '#C33' }], size, 1).wrong).toBe(0);
    expect(checkView([near, square(40, 40, 80, 80, 9, '#36c')], size, 1).wrong).toBe(0);
  });

  it('uses a sloped plane where it is sloped', () => {
    // A fill rising from z = -20 at x = 0 to z = 20 at x = 100, painted over a flat one at z = 0:
    // wrong where the flat one is more than 1.5 in front, that is x < 46.25.
    const flat = square(0, 0, 100, 10, 0, '#111');
    const ramp = {
      color: '#eee',
      fill: { rings: [[p(0, 0, -20), p(100, 0, 20), p(100, 10, 20), p(0, 10, -20)]] },
    };
    expect(checkView([flat, ramp], size, 1).wrong).toBe(46 * 10);
  });

  it('ignores a fill seen edge-on', () => {
    const edgeOn = {
      color: '#111',
      fill: { rings: [[p(10, 10, 0), p(90, 10, 0), p(90, 10, 50)]] },
    };
    expect(checkView([edgeOn], size, 1).covered).toBe(0);
  });

  it('gives a stroke the depth of a tube', () => {
    // A line of radius 5 at z = 0 under a fill at z = 3: the tube's front is more than 1.5 in
    // front of the fill only within 2.18 of its center line, so four rows of pixel centers.
    const line: Primitive = {
      color: '#111',
      stroke: { radius: 5, lines: [[p(10, 50, 0), p(90, 50, 0)]] },
    };
    const sheet = square(20, 20, 80, 80, 3, '#eee');
    expect(checkView([line, sheet], size, 1).wrong).toBe(60 * 4);
    expect(checkView([sheet, line], size, 1).wrong).toBe(0);
  });

  it('gives a one-point stroke the depth of a ball', () => {
    const ball: Primitive = { color: '#111', stroke: { radius: 20, lines: [[p(50, 50, 0)]] } };
    const sheet = square(0, 0, 100, 100, 10, '#eee');
    let expected = 0;
    for (let y = 0.5; y < 100; y++) {
      for (let x = 0.5; x < 100; x++) {
        const d2 = (x - 50) ** 2 + (y - 50) ** 2;
        if (d2 <= 400 && Math.sqrt(400 - d2) - 10 > 1.5) expected++;
      }
    }
    expect(expected).toBeGreaterThan(800);
    expect(checkView([ball, sheet], size, 1).wrong).toBe(expected);
  });

  it('fills by the nonzero rule', () => {
    // Two rings in the same direction, one inside the other: the inner one stays filled.
    const rings = [
      [p(10, 10, 0), p(90, 10, 0), p(90, 90, 0), p(10, 90, 0)],
      [p(30, 30, 0), p(70, 30, 0), p(70, 70, 0), p(30, 70, 0)],
    ];
    expect(checkView([{ color: '#111', fill: { rings } }], size, 1).covered).toBe(6400);
  });
});

describe('solidFrame', () => {
  const center = p(50, 50, 0);
  it('gives a cylinder the depth of its round side', () => {
    const s = solidFrame('cylinder', p(20, 50, 0), p(80, 50, 0), 20);
    expect(s).toBeDefined();
    if (!s) return;
    expect(surfaceDepth(s, 50, 50)).toBeCloseTo(20);
    expect(surfaceDepth(s, 30, 62)).toBeCloseTo(Math.sqrt(400 - 144));
    expect(surfaceDepth(s, 90, 50)).toBeUndefined();
  });

  it('gives a cone pointing at the viewer the depth of its side', () => {
    const s = solidFrame('cone', center, p(50, 50, 40), 20);
    if (!s) throw new Error('no frame');
    expect(surfaceDepth(s, 50, 50)).toBeCloseTo(40);
    expect(surfaceDepth(s, 60, 50)).toBeCloseTo(20);
  });

  it('gives a hemisphere its dome, or its flat face when the dome points away', () => {
    const toward = solidFrame('hemisphere', center, p(50, 50, 20), 20);
    const away = solidFrame('hemisphere', center, p(50, 50, -20), 20);
    if (!toward || !away) throw new Error('no frame');
    expect(surfaceDepth(toward, 62, 50)).toBeCloseTo(16);
    expect(surfaceDepth(away, 62, 50)).toBeCloseTo(0);
  });

  it('has no frame for a solid without size', () => {
    expect(solidFrame('cone', center, center, 20)).toBeUndefined();
  });
});

describe('summarizeViews', () => {
  it('averages the shares of the views that cover anything', () => {
    const view = (offsetDeg: number, covered: number, wrong: number) => ({
      offsetDeg,
      count: { covered, wrong },
      excluded: 1,
    });
    expect(summarizeViews([view(0, 100, 0), view(30, 100, 10), view(60, 0, 0)])).toEqual({
      mean: 0.05,
      worst: 0.1,
      worstOffsetDeg: 30,
      views: 2,
      excluded: 3,
    });
    expect(summarizeViews([view(0, 0, 0)])).toBeUndefined();
  });

  it('compares colors written two ways as one', () => {
    expect(normalizeColor(' #ABC ')).toBe('#aabbcc');
    expect(normalizeColor('rgb(1, 2, 3)')).toBe('rgb(1,2,3)');
  });
});

describe('zpup turn errors', () => {
  it('finds nothing wrong in the pup, which turns cleanly', () => {
    expect(zpupTurnErrors(normalizeScene(pup))).toMatchObject({ mean: 0, worst: 0, views: 12 });
  });

  it('finds next to nothing in the lighthouse', () => {
    const t = zpupTurnErrors(normalizeScene(lighthouse));
    expect(t?.worst).toBeLessThan(0.002);
  });

  it('is stored on the score of a valid scene', () => {
    const scene = JSON.stringify({
      width: 400,
      height: 400,
      children: [{ type: 'dot', stroke: 40 }],
    });
    const score = scoreReply('zpup', scene, {
      canvas: { width: 400, height: 400 },
      rotationOffsetsDeg: [0],
    });
    expect(score.turnErrors).toMatchObject({ mean: 0, views: 12, excluded: 0 });
  });
});

describe('Zdog turn errors', () => {
  const options = { width: 400, height: 400, offsetsDeg: [], turnsDeg: [0, 90, 180, 270] };
  const counts = (code: string) => {
    const run = runZdog(
      `const illo = new Zdog.Illustration({ element: '.zdog-svg', rotate: { x: -0.5 } });${code}illo.updateRenderGraph();`,
      options,
    );
    return (run.turns ?? []).map((t) => {
      if (!t.primitives) throw new Error(t.error);
      expect(t.primitives.length + t.excluded).toBe(t.elements);
      return checkView(t.primitives, { width: 400, height: 400 }, 1);
    });
  };
  const floor =
    "new Zdog.Rect({ addTo: illo, width: 120, height: 360, rotate: { x: Math.PI / 2 }, fill: true, stroke: false, color: '#3a3' });";

  it('flags a ball on the far end of a long floor, which Zdog sorts by its middle', () => {
    const [own] = counts(
      `${floor}new Zdog.Shape({ addTo: illo, translate: { y: -20, z: -150 }, stroke: 40, color: '#e33' });`,
    );
    expect(own?.wrong).toBeGreaterThan(200);
  });

  it('does not flag the same ball on the near end, or a ball in front of a wall', () => {
    const [own] = counts(
      `${floor}new Zdog.Shape({ addTo: illo, translate: { y: -20, z: 150 }, stroke: 40, color: '#e33' });`,
    );
    expect(own?.wrong).toBe(0);
    const wall = counts(
      "new Zdog.Rect({ addTo: illo, width: 200, height: 160, translate: { z: -60 }, fill: true, stroke: false, color: '#36c' });new Zdog.Shape({ addTo: illo, stroke: 60, color: '#e33' });",
    );
    expect(wall.map((c) => c.wrong)).toEqual([0, 0, 0, 0]);
  });

  it('models every Zdog solid without flagging it', () => {
    for (const solid of [
      "new Zdog.Box({ addTo: illo, width: 120, height: 80, depth: 100, stroke: false, color: '#c25', leftFace: '#ea0', rightFace: '#e62', topFace: '#ed0', bottomFace: '#636', rearFace: '#06c' });",
      "new Zdog.Cylinder({ addTo: illo, diameter: 100, length: 140, stroke: false, color: '#36c', backface: '#9cf', rotate: { x: 1.2 } });",
      "new Zdog.Cone({ addTo: illo, diameter: 120, length: 140, stroke: false, color: '#3a3', backface: '#060', rotate: { x: 1.5 } });",
      "new Zdog.Hemisphere({ addTo: illo, diameter: 140, stroke: 4, color: '#a3a', backface: '#fcf', rotate: { x: -0.6 } });",
    ]) {
      const views = counts(solid);
      expect(views.every((c) => c.covered > 0)).toBe(true);
      expect(views.map((c) => c.wrong)).toEqual([0, 0, 0, 0]);
    }
  });

  it('paints a Group in its own order, as Zdog does', () => {
    const box =
      "new Zdog.Box({ addTo: g, width: 120, height: 80, depth: 100, stroke: false, color: '#c25', leftFace: '#ea0', rightFace: '#e62', topFace: '#ed0', bottomFace: '#636', rearFace: '#06c' });";
    const inGroup = counts(`const g = new Zdog.Group({ addTo: illo });${box}`);
    const inAnchor = counts(`const g = new Zdog.Anchor({ addTo: illo });${box}`);
    expect(inGroup.some((c) => c.wrong > 1000)).toBe(true);
    expect(inAnchor.map((c) => c.wrong)).toEqual([0, 0, 0, 0]);
  });

  it('is stored on the score of a valid script', () => {
    const score = scoreReply(
      'zdog',
      "const illo = new Zdog.Illustration({ element: '.zdog-svg' });new Zdog.Shape({ addTo: illo, stroke: 80, color: '#e62' });illo.updateRenderGraph();",
      { canvas: { width: 400, height: 400 }, rotationOffsetsDeg: [0] },
    );
    expect(score.turnErrors).toMatchObject({ mean: 0, views: 12, excluded: 0 });
  });

  it('leaves out what a script paints that is not a Zdog shape', () => {
    const run = runZdog(
      "const illo = new Zdog.Illustration({ element: '.zdog-svg', onPrerender(svg) { svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path')); } });new Zdog.Shape({ addTo: illo, stroke: 20 });",
      options,
    );
    expect(run.turns?.[0]).toMatchObject({ excluded: 1, elements: 2 });
  });

  it('leaves out a round solid that is scaled differently along its axes', () => {
    const hemisphere = (scale: string) =>
      runZdog(
        `const illo = new Zdog.Illustration({ element: '.zdog-svg' });new Zdog.Hemisphere({ addTo: illo, diameter: 100, stroke: false, rotate: { x: 1 }, scale: ${scale} });`,
        options,
      ).turns?.[0];
    expect(hemisphere('2')).toMatchObject({ excluded: 0, elements: 2 });
    expect(hemisphere('{ y: 0.4 }')).toMatchObject({ excluded: 1, elements: 2 });
  });
});
