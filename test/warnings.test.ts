import { describe, expect, it } from 'vitest';
import { lighthouse } from '../examples/lighthouse.ts';
import { pup } from '../examples/pup.ts';
import { checkScene, checkSceneWarnings, renderSvg, type Scene } from '../src/index.ts';

const scene = (extra: Partial<Scene>): Scene => ({
  width: 400,
  height: 400,
  children: [{ type: 'ellipse', diameter: 40, fill: true }],
  ...extra,
});
const messages = (input: unknown) => checkSceneWarnings(input).map((w) => w.message);

describe('checkSceneWarnings', () => {
  it('finds nothing to warn about in the examples', () => {
    expect(checkSceneWarnings(pup)).toEqual([]);
    expect(checkSceneWarnings(lighthouse)).toEqual([]);
  });

  it('returns nothing for an invalid scene, which checkScene reports', () => {
    expect(checkSceneWarnings({ width: 10 })).toEqual([]);
  });

  it('never makes a scene invalid', () => {
    const odd = scene({ rotate: { x: 0.5, y: -0.4 }, children: [{ type: 'group' }] });
    expect(checkSceneWarnings(odd).length).toBeGreaterThan(0);
    expect(checkScene(odd)).toEqual([]);
    expect(() => renderSvg(odd)).not.toThrow();
  });

  it('warns about angles that look like radians', () => {
    expect(
      messages(
        scene({
          rotate: { x: -0.35, y: 0.5 },
          children: [{ type: 'ellipse', diameter: 40, rotate: { x: 1.5708 } }],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "scene.rotate.x: expected an angle in degrees, received -0.35 (and 2 more, all at most 2π). Every rotation in this scene is a small fraction, which looks like radians. zpup angles are in degrees: multiply radians by 57.2958 (-0.35 rad = -20.1 degrees, 0.5 rad = 28.6 degrees, 1.5708 rad = 90 degrees).",
      ]
    `);
    // One angle alone counts when it is a common radian value such as π/4.
    expect(messages(scene({ rotate: { y: 0.785 } }))).toHaveLength(1);
  });

  it('does not take degrees for radians', () => {
    for (const rotate of [
      { x: -15, y: 30 },
      { x: 90 },
      { z: 5, x: -3 }, // small, but whole numbers
      { z: 2.5 }, // one small fraction that is no common radian value
      { x: -20, y: 0.5 }, // one angle is clearly degrees
      {},
    ]) {
      expect(messages(scene({ rotate })), JSON.stringify(rotate)).toEqual([]);
    }
  });

  it('warns about shapes entirely outside the image, and explains the centered origin', () => {
    expect(
      messages(
        scene({
          children: [
            { type: 'ellipse', diameter: 40, translate: { x: 300, y: 300 } },
            { type: 'ellipse', diameter: 400, fill: true }, // partly inside: fine
          ],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "scene.children[0]: expected a shape at least partly inside the 400 by 400 image, received a shape entirely outside it (from 480, 480 to 521, 521 in image pixels). The origin (0, 0) is the center of the image, so x runs from -200 to 200 and y from -200 to 200 (y down). If you placed shapes from the top-left corner as in SVG, subtract 200 from x and 200 from y.",
      ]
    `);
    const many = scene({
      children: Array.from({ length: 5 }, (_, i) => ({
        type: 'ellipse' as const,
        diameter: 10,
        translate: { x: 250 + i * 20, y: 250 },
      })),
    });
    const warnings = checkSceneWarnings(many);
    expect(warnings).toHaveLength(3);
    expect(warnings[2]?.message).toContain('2 more shapes are outside too.');
    // Zoom changes which scene units are on screen.
    expect(
      messages(
        scene({ zoom: 0.5, children: [{ type: 'ellipse', diameter: 40, translate: { x: 300 } }] }),
      ),
    ).toEqual([]);
  });

  it('warns about a scene that draws nothing, with the reason', () => {
    expect(messages(scene({ children: [] }))[0]).toContain('received no nodes');
    expect(messages(scene({ children: [{ type: 'group' }] }))[0]).toContain('only groups');
    expect(
      messages(scene({ children: [{ type: 'ellipse', diameter: 10, visible: false }] }))[0],
    ).toContain('only hidden shapes');
    expect(
      messages(scene({ children: [{ type: 'ellipse', diameter: 10, stroke: 0 }] })),
    ).toMatchInlineSnapshot(`
        [
          "scene.children: expected at least one visible shape, received shapes with "stroke": 0 and no fill. A shape needs a "stroke" above 0 or "fill": true to show.",
        ]
      `);
  });

  it('warns about solids whose color cannot be shaded', () => {
    expect(
      messages(
        scene({
          children: [{ type: 'box', width: 40, height: 40, depth: 40, color: 'currentColor' }],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "scene.children[0].color: expected a color that can be shaded: hex, rgb(), hsl() or a color name, received "currentColor". Every face gets this one color, so the solid looks flat. Use a hex color, give faces their own colors (such as "frontFace"), or set "shade": false.",
      ]
    `);
    expect(
      messages(
        scene({
          children: [
            { type: 'box', width: 40, height: 40, depth: 40, color: 'currentColor', shade: false },
          ],
        }),
      ),
    ).toEqual([]);
  });
});
