import { describe, expect, it } from 'vitest';
import {
  box,
  checkScene,
  dot,
  ellipse,
  group,
  renderSvg,
  type Scene,
  ZpupValidationError,
} from '../src/index.ts';

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
        "scene.children[0].type: expected one of "group", "path", "ellipse", "rect", "polygon", "box", "cylinder", "cone", "hemisphere", received "circle". Did you mean "ellipse"? A circle is an "ellipse" with "diameter", e.g. { "type": "ellipse", "diameter": 40 }. The other options were checked as an "ellipse".",
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

  it('explains that colors go in "color" and that stroke is a width', () => {
    expect(
      messages({
        width: 100,
        height: 100,
        children: [
          { type: 'ellipse', diameter: 20, fill: '#fff' },
          { type: 'path', path: [{}], stroke: '#000' },
          { type: 'rect', width: 10, height: 10, stroke: 'none', fill: 'none' },
          { type: 'box', width: 1, height: 1, depth: 1, fill: '#abc' },
        ],
      }),
    ).toMatchInlineSnapshot(`
      [
        "scene.children[0].fill: expected true or false, received "#fff". "fill" only switches filling on; the fill color is "color". Write "color": "#fff", "fill": true.",
        "scene.children[1].stroke: expected a number of at least 0, received "#000". "stroke" is the outline width in scene units; its color is "color". Write "stroke": 2, "color": "#000".",
        "scene.children[2].stroke: expected a number of at least 0, received "none". Use 0 for no outline.",
        "scene.children[2].fill: expected true or false, received "none". Use false, or leave "fill" out, for no fill.",
        "scene.children[3].fill: expected true (solids are always filled), received "#abc". Colors go in "color", e.g. "color": "#e62". Remove "fill".",
      ]
    `);
  });

  it('checks the rest of a node whose type is wrong, so one round of fixes is enough', () => {
    expect(
      messages({
        width: 100,
        height: 100,
        children: [
          { type: 'circle', radius: 10, colour: 'red', translate: [1, 2] },
          { type: 'cube', size: 40 },
          { type: 'sphere', diameter: 40, rotate: { x: 'a' }, colour: 'red' },
          { type: 'cilinder', diameter: 10, length: 20, stroke: '2px' },
          { type: 'g', children: [{ type: 'ellipse', diameter: -1 }] },
        ],
      }),
    ).toMatchInlineSnapshot(`
      [
        "scene.children[0].type: expected one of "group", "path", "ellipse", "rect", "polygon", "box", "cylinder", "cone", "hemisphere", received "circle". Did you mean "ellipse"? A circle is an "ellipse" with "diameter", e.g. { "type": "ellipse", "diameter": 40 }. The other options were checked as an "ellipse".",
        "scene.children[0].radius: unknown option "radius". Use "diameter" (twice the radius). Allowed: "type", "id", "translate", "rotate", "scale", "visible", "children", "color", "stroke", "fill", "diameter", "width", "height" (options of an "ellipse" node).",
        "scene.children[0].colour: unknown option "colour". Did you mean "color"? Allowed: "type", "id", "translate", "rotate", "scale", "visible", "children", "color", "stroke", "fill", "diameter", "width", "height" (options of an "ellipse" node).",
        "scene.children[0].translate: expected an object with optional numeric x, y and z, received an array [1,2]. Arrays are not accepted. Write { "x": 0, "y": -20, "z": 10 } instead.",
        "scene.children[1].type: expected one of "group", "path", "ellipse", "rect", "polygon", "box", "cylinder", "cone", "hemisphere", received "cube". Did you mean "box"? Give it a "width", "height" and "depth", e.g. { "type": "box", "width": 40, "height": 40, "depth": 40 }. The other options were checked as a "box".",
        "scene.children[1].size: unknown option "size". Use "width", "height" and "depth". Allowed: "type", "id", "translate", "rotate", "scale", "visible", "children", "color", "stroke", "fill", "shade", "width", "height", "depth", "frontFace", "rearFace", "leftFace", "rightFace", "topFace", "bottomFace" (options of a "box" node).",
        "scene.children[2].type: expected one of "group", "path", "ellipse", "rect", "polygon", "box", "cylinder", "cone", "hemisphere", received "sphere". For a sphere use a dot: { "type": "path", "path": [{}], "stroke": 20 } (the stroke is its diameter). For half a sphere use "hemisphere".",
        "scene.children[2].colour: unknown option "colour". Did you mean "color"? Allowed: "type", "id", "translate", "rotate", "scale", "visible", "children", "color", "stroke", "fill", "path", "closed", "diameter", "width", "height", "sides", "radius", "shade", "depth", "frontFace", "rearFace", "leftFace", "rightFace", "topFace", "bottomFace", "length", "backface" (options of any node).",
        "scene.children[2].rotate.x: expected a finite number, received "a". For example 10.",
        "scene.children[3].type: expected one of "group", "path", "ellipse", "rect", "polygon", "box", "cylinder", "cone", "hemisphere", received "cilinder". Did you mean "cylinder"? The other options were checked as a "cylinder".",
        "scene.children[3].stroke: expected a number of at least 0, received "2px". Use a plain number in scene units without a unit suffix, e.g. 2.",
        "scene.children[4].type: expected one of "group", "path", "ellipse", "rect", "polygon", "box", "cylinder", "cone", "hemisphere", received "g". Did you mean "group"? SVG's <g> is a "group". The other options were checked as a "group".",
        "scene.children[4].children[0].diameter: expected a number of at least 0, received -1. For example 20.",
      ]
    `);
  });

  it('names the replacement for types from other tools', () => {
    const hint = (type: string) =>
      checkScene({ width: 10, height: 10, children: [{ type }] })[0]?.hint ?? '';
    expect(hint('line')).toContain('{ "type": "path", "path": [{ "x": -20 }, { "x": 20 }] }');
    expect(hint('sphere')).toContain('{ "type": "path", "path": [{}], "stroke": 20 }');
    expect(hint('triangle')).toContain('{ "type": "polygon", "sides": 3, "radius": 20 }');
    expect(hint('hexagon')).toContain('"sides": 6');
    expect(hint('cube')).toContain('"type": "box"');
    expect(hint('ring')).toContain('unfilled "ellipse"');
    expect(hint('polyline')).toContain('Did you mean "path"?');
    expect(hint('Rectangle')).toContain('Did you mean "rect"?');
    expect(hint('text')).toContain('no text');
  });

  it('checks the options of solids', () => {
    expect(
      messages({
        width: 100,
        height: 100,
        children: [
          { type: 'cylinder', radius: 20, height: 40, topFace: '#fff', fill: false },
          { type: 'cone', diameter: 20, length: 30, frontFace: '#fff' },
          { type: 'box', width: 1, height: 1, depth: 1, rearFace: false, shade: 'no' },
          { type: 'hemisphere', diameter: 10, backface: 'url(#x)' },
        ],
      }),
    ).toMatchInlineSnapshot(`
      [
        "scene.children[0].radius: unknown option "radius". Use "diameter" (twice the radius). Allowed: "type", "id", "translate", "rotate", "scale", "visible", "children", "color", "stroke", "fill", "shade", "diameter", "length", "frontFace", "backface" (options of a "cylinder" node).",
        "scene.children[0].height: unknown option "height". Use "length", the size along the local z axis. Add "rotate": { "x": 90 } to stand it up. Allowed: "type", "id", "translate", "rotate", "scale", "visible", "children", "color", "stroke", "fill", "shade", "diameter", "length", "frontFace", "backface" (options of a "cylinder" node).",
        "scene.children[0].topFace: unknown option "topFace". A cylinder's ends are "frontFace" (+z) and "backface" (-z); with "rotate": { "x": 90 } the frontFace is on top. The side uses "color". Allowed: "type", "id", "translate", "rotate", "scale", "visible", "children", "color", "stroke", "fill", "shade", "diameter", "length", "frontFace", "backface" (options of a "cylinder" node).",
        "scene.children[0].fill: expected true (solids are always filled), received false. Remove "fill"; for an outline only, use "path", "ellipse", "rect" or "polygon".",
        "scene.children[0].diameter: expected a number of at least 0, received nothing. For example 20.",
        "scene.children[0].length: expected a number of at least 0, received nothing. For example 20.",
        "scene.children[1].frontFace: unknown option "frontFace". The flat side of a cone is "backface"; the round surface uses "color". Allowed: "type", "id", "translate", "rotate", "scale", "visible", "children", "color", "stroke", "fill", "shade", "diameter", "length", "backface" (options of a "cone" node).",
        "scene.children[2].shade: expected true or false, received "no".",
        "scene.children[2].rearFace: expected a CSS color string such as "#e62", received false. Faces cannot be left out. Leave the option out to shade this face from "color".",
        "scene.children[3].backface: expected a CSS color string such as "#e62", "rgb(230, 100, 30)" or "tomato", received "url(#x)".",
      ]
    `);
    expect(
      checkScene({
        width: 10,
        height: 10,
        children: [
          {
            type: 'box',
            width: 1,
            height: 2,
            depth: 3,
            fill: true,
            frontFace: '#fff',
            shade: false,
          },
          { type: 'cylinder', diameter: 1, length: 2, frontFace: 'red', backface: 'blue' },
          { type: 'cone', diameter: 1, length: 2, backface: 'red' },
          { type: 'hemisphere', diameter: 1, backface: 'red', stroke: 0 },
        ],
      }),
    ).toEqual([]);
  });

  it('rejects a node that appears twice', () => {
    const shared = { type: 'group' };
    expect(messages({ width: 1, height: 1, children: [shared, shared] })).toHaveLength(1);
  });

  it('accepts CSS color names in any case and suggests one for a misspelled name', () => {
    const scene = (color: string) => ({
      width: 10,
      height: 10,
      children: [{ type: 'path', path: [{}], color }],
    });
    for (const ok of [
      'red',
      'RebeccaPurple',
      'transparent',
      'currentColor',
      'currentcolor',
      'grey',
    ])
      expect(checkScene(scene(ok))).toEqual([]);
    expect(checkScene(scene('blu'))[0]?.hint).toBe('Did you mean "blue"?');
    expect(checkScene(scene('lightgren'))[0]?.hint).toBe('Did you mean "lightgreen"?');
    expect(checkScene(scene('skin'))[0]?.hint).toMatch(/is not a CSS color name/);
  });

  it('gives the path as segments and the message without its location', () => {
    const [issue] = checkScene({
      width: 10,
      height: 10,
      children: [{ type: 'group', children: [{ id: 'eye', type: 'path', path: [{ x: 'a' }] }] }],
    });
    expect(issue).toMatchObject({
      path: 'scene.children[0].children[0].path[0].x',
      pathSegments: ['scene', 'children', 0, 'children', 0, 'path', 0, 'x'],
      nodeId: 'eye',
    });
    expect(issue?.message).toBe(
      `scene.children[0].children[0].path[0].x (in node "eye"): ${issue?.detail}`,
    );
    expect(issue?.detail).toMatch(/^expected a finite number, received "a"\./);
  });

  it('puts "type" first in the objects the helpers return', () => {
    expect(Object.keys(group({ id: 'g', children: [] }))).toEqual(['type', 'id', 'children']);
    expect(Object.keys(dot({ id: 'd', stroke: 4 }))).toEqual(['type', 'id', 'stroke', 'path']);
    expect(Object.keys(box({ width: 1, height: 1, depth: 1 }))[0]).toBe('type');
    // The helper's type wins over one smuggled in through the options.
    expect(ellipse({ type: 'rect', diameter: 2 } as never).type).toBe('ellipse');
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
