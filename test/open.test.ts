import { describe, expect, it } from 'vitest';
import { insideColor, shadeColor } from '../src/color.ts';
import {
  box,
  checkScene,
  cone,
  cylinder,
  dot,
  hemisphere,
  type Node,
  path,
  pyramid,
  renderSpinSvg,
  renderSvg,
  type Scene,
} from '../src/index.ts';
import {
  compilePieces,
  paintConstraints,
  paintedColor,
  paintLayer,
  piecesOverlap,
  positions,
  visiblePieces,
} from '../src/pieces.ts';
import { surfaceDepth } from '../src/solids.ts';
import { normalizeScene } from '../src/validate.ts';

const view = (children: Node[], rotate = { x: -25, y: -30 }): Scene => ({
  width: 240,
  height: 240,
  rotate,
  children,
});

const pieces = (scene: Scene) => compilePieces(normalizeScene(scene));

/** Position in the paint order of each visible piece, with the piece. */
function painted(scene: Scene) {
  const visible = visiblePieces(pieces(scene));
  const at = positions(paintConstraints(visible).order);
  return visible.map((piece, i) => ({ piece, at: at[i] as number }));
}

const messages = (children: unknown[]) =>
  checkScene({ width: 100, height: 100, children }).map((issue) => issue.message);

describe('open solids: validation', () => {
  it('leaves a face out with false, on every solid', () => {
    expect(
      messages([
        { type: 'box', width: 1, height: 1, depth: 1, topFace: false, frontFace: false },
        { type: 'pyramid', width: 1, height: 1, depth: 1, bottomFace: false },
        { type: 'cylinder', diameter: 1, length: 1, frontFace: false, backface: false },
        { type: 'cone', diameter: 1, length: 1, backface: false },
        { type: 'cone', diameter: 1, length: 1, tipDiameter: 2, frontFace: false },
        { type: 'hemisphere', diameter: 1, backface: false, inside: '#246' },
      ]),
    ).toEqual([]);
  });

  it('says what a face option takes', () => {
    expect(
      messages([
        { type: 'box', width: 1, height: 1, depth: 1, topFace: true },
        { type: 'cone', diameter: 1, length: 1, frontFace: false },
        { type: 'cylinder', diameter: 1, length: 1, inside: 5 },
        { type: 'rect', width: 1, height: 1, inside: '#246' },
      ]),
    ).toMatchInlineSnapshot(`
      [
        "scene.children[0].topFace: expected a CSS color string such as "#e62", or false to leave the face out, received true. Leave the option out to shade this face from "color".",
        "scene.children[1].frontFace: expected no "frontFace" on a cone that ends in a point, received false. A cone has a far end only when "tipDiameter" cuts its tip off. Set "tipDiameter", or use "backface" for the base.",
        "scene.children[2].inside: expected a CSS color string such as "#e62", "rgb(230, 100, 30)" or "tomato", received 5.",
        "scene.children[3].inside: unknown option "inside". "inside" is an option of "box", "pyramid", "cylinder", "cone", "hemisphere" nodes. Allowed: "type", "id", "translate", "rotate", "scale", "visible", "children", "color", "stroke", "fill", "backface", "width", "height" (options of a "rect" node).",
      ]
    `);
  });
});

describe('open solids: pieces', () => {
  const closed = cylinder({ diameter: 50, length: 50, rotate: { x: 90 }, color: '#e62' });
  const open = { ...closed, frontFace: false as const };

  it('changes nothing about a closed solid', () => {
    const all = pieces(view([closed]));
    expect(all).toHaveLength(3);
    expect(all.every((p) => p.backface === true && p.normal === undefined)).toBe(true);
    expect(all.map((p) => p.layer)).toEqual([0, 1, 1]);
  });

  it('drops the face and adds the inside of the wall', () => {
    const all = pieces(view([open]));
    // Inner wall, outer wall, the end that is left.
    expect(all).toHaveLength(3);
    expect(all.map((p) => p.layer)).toEqual([-1, 0, 1]);
    expect(all[0]?.surface?.back).toBe(true);
    expect(all.some((p) => p.backfacing)).toBe(false);
  });

  it('paints a wall that faces away in the inside color, before the rest', () => {
    // Seen from above, the floor of a cup shows its inner side.
    const all = pieces(view([open]));
    const floor = all[2];
    expect(floor?.front).toBe(false);
    expect(floor && paintLayer(floor)).toBe(-2);
    // The inner side of the floor faces up.
    expect(floor && paintedColor(floor)).toBe(
      shadeColor(insideColor('#e62'), { x: 0, y: -1, z: 0 }),
    );
    // From below it shows its outer side, on top.
    const below = pieces(view([open], { x: 25, y: -30 }))[2];
    expect(below?.front).toBe(true);
    expect(below && paintLayer(below)).toBe(1);
    expect(below && paintedColor(below)).toBe(shadeColor('#e62', { x: 0, y: 1, z: 0 }));
  });

  it('takes the inside color from "inside", unshaded with shade: false', () => {
    const all = pieces(view([{ ...open, inside: '#123456', shade: false }]));
    expect(all[0]?.color).toBe('#123456');
    expect(all[2] && paintedColor(all[2])).toBe('#123456');
  });

  it('keeps the same commands at every view angle', () => {
    const solids: Node[] = [
      open,
      cone({ diameter: 30, length: 40, tipDiameter: 50, frontFace: false }),
      cone({ diameter: 30, length: 40, backface: false }),
      hemisphere({ diameter: 40, backface: false }),
      box({ width: 30, height: 20, depth: 10, topFace: false }),
      pyramid({ width: 30, height: 20, depth: 10, bottomFace: false }),
    ];
    const commands = (rotate: { x: number; y: number }) =>
      pieces(view(solids, rotate)).map((p) =>
        p.geometry.segments.map((s) => (s.kind === 'line' ? 'L' : 'C')).join(''),
      );
    const first = commands({ x: 0, y: 0 });
    for (let x = -90; x <= 90; x += 15) {
      for (let y = 0; y < 360; y += 15) expect(commands({ x, y })).toEqual(first);
    }
  });

  it('finds the far side of a round solid', () => {
    const [inner, outer] = pieces(view([open], { x: -40, y: 0 }));
    const back = inner?.surface;
    const front = outer?.surface;
    expect(back && front).toBeTruthy();
    if (!back || !front) return;
    // Through the middle of the image: in at the near wall, out at the far one.
    const near = surfaceDepth(front, 120, 120) as number;
    const far = surfaceDepth(back, 120, 120) as number;
    expect(near).toBeGreaterThan(far);
    expect(near - far).toBeGreaterThan(40);
    expect(surfaceDepth(back, 5, 5)).toBeUndefined();
  });
});

describe('open solids: depth order', () => {
  const mug = cylinder({
    id: 'mug',
    diameter: 50,
    length: 50,
    rotate: { x: 90 },
    color: '#e62',
    stroke: 2,
    frontFace: false,
  });
  const straw = path({
    id: 'straw',
    path: [
      { x: 5, y: -55, z: 5 },
      { x: -8, y: 15, z: -5 },
    ],
    stroke: 5,
    color: '#36c',
  });
  const at = (scene: Scene, id: string, layer?: number) => {
    const found = painted(scene).filter(
      (p) => p.piece.nodeId === id && (layer === undefined || paintLayer(p.piece) === layer),
    );
    expect(found.length).toBeGreaterThan(0);
    return found.map((p) => p.at);
  };

  it('puts what stands in a cup between its inside and its outside', () => {
    for (let y = 0; y < 360; y += 20) {
      const scene = view([mug, straw], { x: -25, y });
      const [inside] = at(scene, 'mug', -1);
      const [floor] = at(scene, 'mug', -2);
      const [outside] = at(scene, 'mug', 0);
      const [s] = at(scene, 'straw');
      expect(inside).toBeLessThan(s as number);
      expect(floor).toBeLessThan(s as number);
      expect(s).toBeLessThan(outside as number);
    }
  });

  it('puts what lies in an open box in front of its far walls and behind its near ones', () => {
    const crate = box({
      id: 'crate',
      width: 60,
      height: 40,
      depth: 50,
      color: '#c95',
      stroke: 2,
      topFace: false,
    });
    const ball = dot({ id: 'ball', stroke: 18, color: '#e62', translate: { x: 5, y: 8, z: -4 } });
    for (let y = 10; y < 360; y += 40) {
      const scene = view([crate, ball], { x: -30, y });
      const all = painted(scene);
      const b = all.find((p) => p.piece.nodeId === 'ball');
      expect(b).toBeDefined();
      if (!b) continue;
      // Only walls the ball overlaps on screen have an order against it.
      const walls = all.filter(
        (p) => p.piece.nodeId === 'crate' && piecesOverlap(p.piece, b.piece),
      );
      expect(walls.some((w) => paintLayer(w.piece) === -2)).toBe(true);
      for (const w of walls) {
        if (paintLayer(w.piece) === -2) expect(w.at).toBeLessThan(b.at);
        else expect(w.at).toBeGreaterThan(b.at);
      }
      // The floor and the two walls or so that face away show their inner side.
      expect(all.filter((p) => p.piece.nodeId === 'crate')).toHaveLength(5);
    }
  });

  it('shows what is behind a tube through it', () => {
    const tube = cylinder({
      id: 'tube',
      diameter: 50,
      length: 20,
      color: '#999',
      frontFace: false,
      backface: false,
    });
    const behind = dot({ id: 'behind', stroke: 10, color: '#36c', translate: { z: -40 } });
    const scene = view([behind, tube], { x: 0, y: 0 });
    // Seen straight down its axis, a tube paints nothing over its middle.
    const svg = renderSvg(scene);
    expect(svg).toContain('#36c');
    const all = painted(scene);
    expect(all.filter((p) => p.piece.nodeId === 'tube')).toHaveLength(2);
    const [b] = at(scene, 'behind');
    for (const t of at(scene, 'tube')) expect(b).toBeLessThan(t);
  });

  it('draws the outside of a cone seen from its wide end as a point behind the inside', () => {
    const pot = cone({
      id: 'pot',
      diameter: 36,
      tipDiameter: 54,
      length: 40,
      rotate: { x: 90 },
      color: '#c64',
      stroke: 2,
      frontFace: false,
    });
    const all = pieces(view([pot], { x: -85, y: 0 }));
    const outside = all[1];
    expect(outside?.layer).toBe(-3);
    const points = new Set(outside?.points.map((p) => `${p.x},${p.y}`));
    expect(points.size).toBe(1);
    // A little lower, part of the outside faces the viewer again.
    expect(pieces(view([pot], { x: -60, y: 0 }))[1]?.layer).toBe(0);
  });
});

describe('open solids: turning', () => {
  it('turns a cup with something in it', () => {
    const scene = view([
      cylinder({ diameter: 50, length: 50, rotate: { x: 90 }, color: '#e62', frontFace: false }),
      dot({ stroke: 14, color: '#fc4', translate: { x: 8, y: 12, z: 6 } }),
      box({
        width: 20,
        height: 20,
        depth: 20,
        translate: { x: 60 },
        color: '#c95',
        topFace: false,
      }),
    ]);
    for (const axis of ['x', 'y'] as const) {
      const svg = renderSpinSvg(scene, { axis });
      // The floor of the cup and the walls of the box show both of their colors.
      expect(svg).toContain(shadeColor(insideColor('#e62'), { x: 0, y: -1, z: 0 }));
      expect(svg).toContain(insideColor('#c95'));
      expect(svg.length).toBeLessThan(200_000);
    }
  });
});
