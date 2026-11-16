import { describe, expect, it } from 'vitest';
import { checkScene, renderSvg, type Scene, ZpupValidationError } from '../src/index.ts';

const messages = (input: unknown) => checkScene(input).map((i) => i.message);

describe('validation', () => {
  it('accepts a valid scene', () => {
    expect(checkScene({ width: 10, height: 10, children: [{ type: 'group' }] })).toEqual([]);
  });

  it('names the node, the option and what is allowed', () => {
    expect(
      messages({
        width: 100,
        height: 100,
        children: [
          { type: 'group', children: [{ type: 'path', id: 'tail', path: [{}], stroke: '12px' }] },
        ],
      }),
    ).toMatchInlineSnapshot(`
      [
        "scene.children[0].children[0].stroke (in node "tail"): expected a number of at least 0, received "12px". Use a plain number in scene units without a unit suffix, e.g. 12.",
      ]
    `);
  });

  it('reports every problem at once, with hints', () => {
    expect(
      messages({
        width: '100',
        children: [
          { type: 'circle', diameter: 20 },
          { type: 'ellipse', diameter: 20, colour: 'red' },
          { type: 'rect', width: 10, height: 10, translate: [1, 2, 3] },
          { type: 'group', color: 'red' },
          { type: 'ellipse', radius: 5 },
          { type: 'path', path: [] },
          { type: 'polygon', sides: 2.5, radius: 10, color: 'url(#x)"/><script>' },
          { type: 'rect', width: 1, height: 1, scale: { x: 2, w: 1 }, fill: 'true' },
        ],
      }),
    ).toMatchInlineSnapshot(`
      [
        "scene.width: expected a number greater than 0, received "100". Remove the quotes: 100.",
        "scene.height: expected a number greater than 0, received nothing. For example 240.",
        "scene.children[0].type: expected one of "group", "path", "ellipse", "rect", "polygon", received "circle". Did you mean "ellipse"?",
        "scene.children[1].colour: unknown option "colour". Did you mean "color"? Allowed: "type", "id", "translate", "rotate", "scale", "visible", "children", "color", "stroke", "fill", "diameter", "width", "height" (options of an "ellipse" node).",
        "scene.children[2].translate: expected an object with optional numeric x, y and z, received an array [1,2,3]. Arrays are not accepted. Write { "x": 0, "y": -20, "z": 10 } instead.",
        "scene.children[3].color: unknown option "color". Groups draw nothing; set "color" on the shapes inside the group. Allowed: "type", "id", "translate", "rotate", "scale", "visible", "children" (options of a "group" node).",
        "scene.children[4].radius: unknown option "radius". Use "diameter" (twice the radius). Allowed: "type", "id", "translate", "rotate", "scale", "visible", "children", "color", "stroke", "fill", "diameter", "width", "height" (options of an "ellipse" node).",
        "scene.children[4].diameter: expected a "diameter", or a "width" and a "height", received nothing. For example { "type": "ellipse", "diameter": 20 }.",
        "scene.children[5].path: expected a non-empty array of points, received an array []. For example [{ "x": -10 }, { "x": 10 }] for a line, or [{}] for a dot at the origin.",
        "scene.children[6].color: expected a CSS color string such as "#e62", "rgb(230, 100, 30)" or "tomato", received "url(#x)\\"/><script>".",
        "scene.children[6].sides: expected an integer of at least 3, received 2.5. For example 6.",
        "scene.children[7].scale.w: unknown option "w". Did you mean "x"? Allowed: "x", "y", "z".",
        "scene.children[7].fill: expected true or false, received "true". Remove the quotes: true.",
      ]
    `);
  });

  it('rejects a node that appears twice', () => {
    const shared = { type: 'group' };
    expect(messages({ width: 1, height: 1, children: [shared, shared] })).toHaveLength(1);
  });

  it('throws a ZpupValidationError with structured issues', () => {
    const bad = {
      width: 10,
      height: 10,
      children: [{ type: 'rect', width: -1, height: 2 }],
    } as Scene;
    try {
      renderSvg(bad);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ZpupValidationError);
      const e = error as ZpupValidationError;
      expect(e.issues).toHaveLength(1);
      expect(e.issues[0]).toMatchObject({ path: 'scene.children[0].width', received: '-1' });
      expect(e.message).toMatch(/^Invalid zpup scene \(1 problem\):/);
    }
  });
});
