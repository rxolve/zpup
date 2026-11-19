import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { lighthouse } from '../examples/lighthouse.ts';
import { parseColor, shadeColor } from '../src/color.ts';
import {
  box,
  compileScene,
  cone,
  cylinder,
  hemisphere,
  type Node,
  pyramid,
  renderSpinSvg,
  renderSvg,
  type Scene,
} from '../src/index.ts';
import { compilePieces, visiblePieces } from '../src/pieces.ts';
import { surfaceDepth } from '../src/solids.ts';
import { lerpGeometry, outlineDistance, refineTimes, SPIN_TOLERANCE } from '../src/spin.ts';
import { normalizeScene } from '../src/validate.ts';

const one = (node: Node, rotate = { x: -20, y: 30 }): Scene => ({
  width: 200,
  height: 200,
  rotate,
  children: [node],
});

const solids: [string, Node][] = [
  ['box', box({ width: 60, height: 40, depth: 50, color: '#e62' })],
  ['cylinder', cylinder({ diameter: 60, length: 80, color: '#3a7' })],
  ['cone', cone({ diameter: 60, length: 70, color: '#46c' })],
  ['hemisphere', hemisphere({ diameter: 70, color: '#c4a' })],
  ['pyramid', pyramid({ width: 60, height: 40, depth: 50, ridge: 20, color: '#a63' })],
];

/** The command letters of a piece's outline, as the spin renderer writes them. */
const commands = (scene: Scene, rotate: { x: number; y: number; z: number }) =>
  compilePieces(normalizeScene(scene), rotate).map(
    (p) => `M${p.geometry.segments.map((s) => (s.kind === 'line' ? 'L' : 'C')).join('')}Z`,
  );

describe('solids', () => {
  it('draws only the faces that face the viewer', () => {
    const items = (node: Node, rotate = { x: -20, y: 30 }) =>
      compileScene(one(node, rotate)).items.length;
    expect(items(solids[0]?.[1] as Node)).toBe(3); // top, left, front
    expect(items(solids[0]?.[1] as Node, { x: 0, y: 0 })).toBe(1); // front only
    expect(items(solids[1]?.[1] as Node)).toBe(2); // side and the end facing the viewer
    expect(items(solids[2]?.[1] as Node)).toBe(1); // tip toward the viewer: base hidden
    expect(items(solids[2]?.[1] as Node, { x: 0, y: 180 })).toBe(2); // base toward the viewer
    expect(items(solids[3]?.[1] as Node)).toBe(1);
  });

  it('gives each visible face of a box its own shade', () => {
    for (const y of [0, 20, 45, 70, 135, 200, 300]) {
      for (const x of [-30, 30]) {
        const colors = compileScene(
          one(box({ width: 50, height: 50, depth: 50, color: '#4a7bd0' }), { x, y }),
        ).items.map((i) => i.color);
        expect(new Set(colors).size, `x ${x}, y ${y}`).toBe(colors.length);
      }
    }
    // White and black too: they cannot get lighter or darker, so the range moves.
    for (const color of ['#fff', '#000']) {
      const colors = compileScene(
        one(box({ width: 50, height: 50, depth: 50, color }), { x: -30, y: 30 }),
      ).items.map((i) => i.color);
      expect(new Set(colors).size, color).toBe(3);
    }
  });

  it('keeps the front of a box and the side of an upright cylinder in the given color', () => {
    const front = compileScene(
      one(box({ width: 50, height: 50, depth: 50, color: '#e62' }), { x: 0, y: 0 }),
    );
    expect(front.items.map((i) => i.color)).toEqual(['#ee6622']);
    const upright = compileScene(
      one(cylinder({ diameter: 50, length: 60, rotate: { x: 90 }, color: '#4a7bd0' }), {
        x: -20,
        y: 40,
      }),
    );
    expect(upright.items.map((i) => i.color)).toEqual(['#4a7bd0', '#779cdc']); // side, lighter top
  });

  it('does not depend on the view: a face keeps its color as the scene turns', () => {
    const colorsAt = (y: number) =>
      compilePieces(normalizeScene(one(solids[0]?.[1] as Node)), { x: -20, y, z: 0 }).map(
        (p) => p.color,
      );
    expect(colorsAt(10)).toEqual(colorsAt(250));
  });

  it('uses face colors exactly and paints everything in one color when shading is off', () => {
    const faces = compileScene(
      one(
        cylinder({
          diameter: 50,
          length: 60,
          color: '#3a7',
          frontFace: '#5b3a29',
          rotate: { x: 90 },
        }),
      ),
    );
    expect(faces.items.map((i) => i.color)).toContain('#5b3a29');
    const flat = compileScene(
      one(box({ width: 50, height: 50, depth: 50, color: 'tomato', shade: false })),
    );
    expect(new Set(flat.items.map((i) => i.color))).toEqual(new Set(['tomato']));
  });

  it('stands up with rotate x 90, like Zdog: frontFace on top', () => {
    const scene = one(
      cylinder({ diameter: 40, length: 100, rotate: { x: 90 }, frontFace: '#f00' }),
      {
        x: -30,
        y: 0,
      },
    );
    const frame = compileScene(scene);
    const top = frame.items.find((i) => i.color === '#f00');
    const ys = frame.items.flatMap((i) =>
      i.kind === 'path' ? i.commands.flatMap((c) => ('y' in c ? [c.y] : [])) : [],
    );
    const topYs = top?.kind === 'path' ? top.commands.flatMap((c) => ('y' in c ? [c.y] : [])) : [];
    expect(Math.min(...topYs)).toBeCloseTo(Math.min(...ys), 0);
  });

  it('has the silhouette the solid should have', () => {
    // An upright cylinder seen from 20 degrees above: as wide as its diameter,
    // as tall as its side seen at a slant plus one end seen at a slant. The
    // side stops at the near rim of the end that faces the viewer, so the two
    // together make the silhouette.
    const pieces = visiblePieces(
      compilePieces(
        normalizeScene(
          one(cylinder({ diameter: 60, length: 100, rotate: { x: 90 }, stroke: 0 }), {
            x: -20,
            y: 37,
          }),
        ),
      ),
    );
    expect(pieces).toHaveLength(2);
    const xs = pieces.flatMap((p) => p.points.map((q) => q.x));
    const ys = pieces.flatMap((p) => p.points.map((q) => q.y));
    const rad = (20 * Math.PI) / 180;
    // The outlines are flattened to short lines, which fall a little inside the curves.
    expect(Math.abs(Math.max(...xs) - Math.min(...xs) - 60)).toBeLessThan(0.2);
    const height = 100 * Math.cos(rad) + 60 * Math.sin(rad);
    expect(Math.abs(Math.max(...ys) - Math.min(...ys) - height)).toBeLessThan(0.2);
    // The side alone is one end's near half shorter than the silhouette.
    const side = pieces.find((p) => p.surface) as (typeof pieces)[number];
    const sideYs = side.points.map((q) => q.y);
    expect(
      Math.abs(Math.max(...sideYs) - Math.min(...sideYs) - (height - 30 * Math.sin(rad))),
    ).toBeLessThan(0.2);
  });

  it('knows the depth of its round surfaces', () => {
    // A cylinder lying along x, seen from the front: the surface over the
    // axis is one radius in front of it, and nothing is there past the ends.
    const pieces = compilePieces(
      normalizeScene(
        one(cylinder({ diameter: 40, length: 100, rotate: { y: 90 } }), { x: 0, y: 0 }),
      ),
    );
    const side = pieces.find((p) => p.surface);
    expect(side?.surface).toBeDefined();
    const surface = side?.surface as NonNullable<typeof side>['surface'] & object;
    expect(surfaceDepth(surface, 100, 100)).toBeCloseTo(20, 6);
    expect(surfaceDepth(surface, 130, 100 + 10)).toBeCloseTo(Math.sqrt(400 - 100), 6);
    expect(surfaceDepth(surface, 100, 125)).toBeUndefined();
    expect(surfaceDepth(surface, 160, 100)).toBeUndefined();
    const dome = compilePieces(
      normalizeScene(one(hemisphere({ diameter: 40 }), { x: 0, y: 0 })),
    ).find((p) => p.surface);
    expect(surfaceDepth(dome?.surface as typeof surface, 100, 100)).toBeCloseTo(20, 6);
    const tip = compilePieces(
      normalizeScene(one(cone({ diameter: 40, length: 30 }), { x: 0, y: 0 })),
    ).find((p) => p.surface);
    expect(surfaceDepth(tip?.surface as typeof surface, 100, 100)).toBeCloseTo(30, 6);
    expect(surfaceDepth(tip?.surface as typeof surface, 110, 100)).toBeCloseTo(15, 6);
  });

  it('keeps the same path commands at every angle, also looking straight along the axis', () => {
    for (const [name, node] of solids) {
      for (const tilt of [0, -5, -30]) {
        const first = commands(one(node), { x: tilt, y: 0, z: 0 });
        for (let y = 0; y < 360; y += 7.5) {
          expect(
            commands(one(node), { x: tilt, y, z: 0 }),
            `${name} at tilt ${tilt}, y ${y}`,
          ).toEqual(first);
        }
      }
    }
  });

  it('builds finite outlines when the axis points straight at the viewer or away', () => {
    for (const [name, node] of solids) {
      for (const y of [0, 180]) {
        for (const p of compilePieces(normalizeScene(one(node)), { x: 0, y, z: 0 })) {
          for (const v of [p.geometry.start, ...p.geometry.segments.map((s) => s.to)]) {
            expect(Number.isFinite(v.x + v.y + v.z), `${name} at ${y}`).toBe(true);
          }
        }
      }
    }
  });

  it('works under non-uniform scale', () => {
    const svg = renderSvg(one(hemisphere({ diameter: 60, scale: { z: 0.4 }, rotate: { x: 90 } })));
    expect(svg).toContain('<path');
    expect(svg).not.toContain('NaN');
  });

  it('matches the committed lighthouse example', () => {
    const committed = readFileSync(new URL('../examples/lighthouse.svg', import.meta.url), 'utf8');
    expect(renderSvg(lighthouse)).toBe(committed);
  });
});

/**
 * Time limit for tests that depth-sort a whole turn (720 steps). Locally they
 * take about a second; CI machines have been 3 to 4 times slower.
 */
const FULL_TURN_TIMEOUT = 20_000;

describe('solids in the turning animation', () => {
  // Rendered once and shared: each render depth-sorts the whole turn.
  let lighthouseSpin = '';
  beforeAll(() => {
    lighthouseSpin = renderSpinSvg(lighthouse);
  }, FULL_TURN_TIMEOUT);

  it('interpolates round outlines to within the tolerance, with extra keyframes where needed', () => {
    for (const [name, node] of solids) {
      for (const tilt of [-5, -20]) {
        const s = normalizeScene(one(node, { x: tilt, y: 0 }));
        const at = (f: number) => compilePieces(s, { x: tilt, y: f * 360, z: 0 });
        at(0).forEach((piece, i) => {
          if (!piece.viewDependent) return;
          const geometry = (f: number) => (at(f)[i] as typeof piece).geometry;
          const times = refineTimes(36, geometry);
          for (let k = 0; k < times.length; k++) {
            const a = times[k] as number;
            const b = times[k + 1] ?? 1;
            for (const t of [0.3, 0.5, 0.7]) {
              const error = outlineDistance(
                lerpGeometry(geometry(a), geometry(b % 1), t),
                geometry(a + (b - a) * t),
              );
              // A little slack: refinement checks other points in the interval.
              expect(error, `${name}, tilt ${tilt}, ${a * 360} degrees`).toBeLessThan(
                SPIN_TOLERANCE * 1.5,
              );
            }
          }
        });
      }
    }
  });

  it(
    'adds key times only to round outlines that need them',
    () => {
      const svg = renderSpinSvg(
        one(cylinder({ diameter: 60, length: 80, color: '#3a7' }), { x: -5, y: 0 }),
      );
      const keyTimes = [...svg.matchAll(/attributeName="d"[^>]*keyTimes="([^"]+)"/g)].map((m) =>
        (m[1] as string).split(';').map(Number),
      );
      // The side gets extra key times; the flat ends are fixed outlines.
      expect(keyTimes).toHaveLength(1);
      for (const times of keyTimes) {
        expect(times.length).toBeGreaterThan(37);
        expect(times[0]).toBe(0);
        expect(times.at(-1)).toBe(1);
        times.slice(1).forEach((t, i) => {
          expect(t).toBeGreaterThan(times[i] as number);
        });
      }
      // Upright solids on a turntable keep their outline, so nothing is added.
      expect(lighthouseSpin).not.toMatch(/attributeName="d"[^>]*keyTimes/);
    },
    FULL_TURN_TIMEOUT,
  );

  it('keeps the size of the lighthouse in check', () => {
    // Measured at 132,287 bytes; fail on a clear regression.
    expect(lighthouseSpin.length).toBeLessThan(150_000);
  });
});

describe('color shading', () => {
  it('parses the colors it can shade', () => {
    expect(parseColor('#e62')).toEqual({ r: 238, g: 102, b: 34, a: 1 });
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('rgba(10, 20, 30, 0.25)')).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('Tomato')).toEqual({ r: 255, g: 99, b: 71, a: 1 });
    expect(parseColor('currentColor')).toBeUndefined();
    expect(parseColor('oklch(0.7 0.1 200)')).toBeUndefined();
  });

  it('keeps alpha and leaves colors it cannot parse alone', () => {
    expect(shadeColor('#ff000080', { x: 0, y: -1, z: 0 })).toMatch(/^#[0-9a-f]{6}80$/);
    expect(shadeColor('currentColor', { x: 0, y: -1, z: 0 })).toBe('currentColor');
  });
});
