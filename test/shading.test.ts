import { describe, expect, it } from 'vitest';
import {
  checkScene,
  cylinder,
  dot,
  ellipse,
  hemisphere,
  path,
  renderSpinSvg,
  renderSvg,
  type Scene,
} from '../src/index.ts';
import { sideKind } from '../src/shading.ts';

const scene = (children: Scene['children'], more: Partial<Scene> = {}): Scene => ({
  width: 200,
  height: 200,
  rotate: { x: -20, y: 30 },
  children,
  ...more,
});

describe('soft shading', () => {
  const ball = dot({ stroke: 60, color: '#e8a865' });

  it('is off by default, and "flat" is the same as leaving it out', () => {
    const plain = renderSvg(scene([ball]));
    expect(plain).not.toContain('Gradient');
    expect(renderSvg(scene([ball], { shading: 'flat' }))).toBe(plain);
  });

  it('paints a dot with a gradient made from its color', () => {
    const svg = renderSvg(scene([ball], { shading: 'soft' }));
    expect(svg).toContain('<radialGradient id="zs-b-e8a865"');
    expect(svg).toContain('fill="url(#zs-b-e8a865)"');
    // Lighter at the highlight, the color itself in between, darker at the rim.
    expect(svg).toMatch(/stop-color="#efc293".*stop-color="#e8a865".*stop-color="#b0804d"/);
  });

  it('darkens only the edge of a ball that faces away from the light', () => {
    const svg = renderSvg(scene([ball], { shading: 'soft' }));
    const g = /<radialGradient id="zs-b-e8a865" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/.exec(svg);
    const [cx, cy, r] = (g ?? []).slice(1).map(Number) as [number, number, number];
    // How far along the gradient the ball's edge is, toward and away from the upper left.
    const along = (x: number, y: number) => Math.hypot(x - cx, y - cy) / r;
    const edge = Math.SQRT1_2 / 2;
    expect(along(0.5 - edge, 0.5 - edge)).toBeLessThan(0.55);
    expect(along(0.5 + edge, 0.5 + edge)).toBeGreaterThan(0.9);
  });

  it('defines one gradient for all shapes of the same kind and color', () => {
    const svg = renderSvg(
      scene(
        [
          ball,
          dot({ translate: { x: 50 }, stroke: 20, color: '#e8a865' }),
          hemisphere({ diameter: 30, color: '#333' }),
        ],
        { shading: 'soft' },
      ),
    );
    expect(svg.match(/<radialGradient /g)).toHaveLength(2);
    expect(svg.match(/url\(#zs-b-e8a865\)/g)).toHaveLength(2);
  });

  it('shades the side of an upright cylinder from left to right, and leaves its ends flat', () => {
    const svg = renderSvg(
      scene([cylinder({ diameter: 60, length: 80, rotate: { x: 90 }, color: '#4a7bd0' })], {
        shading: 'soft',
      }),
    );
    expect(svg.match(/<linearGradient /g)).toHaveLength(1);
    expect(svg).toContain('x1="0" y1="0.5" x2="1" y2="0.5"');
    // The side (fill and rounded edge) uses the gradient; the visible end does not.
    expect(svg.match(/fill="url\(#zs-l0-/g)).toHaveLength(1);
    expect(svg.match(/fill="#/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it('runs the gradient across the side, away from the upper left', () => {
    expect(sideKind({ x: 0, y: -1, z: 0 })).toBe('side:0'); // upright: left to right
    expect(sideKind({ x: 0, y: 1, z: 0 })).toBe('side:0');
    expect(sideKind({ x: 1, y: 0, z: 0 })).toBe('side:90'); // lying: top to bottom
    expect(sideKind({ x: 1, y: -1, z: 0 })).toBe('side:45');
    // In steps of 15 degrees; straight toward the upper right and straight
    // toward the lower left are the same line, and get one name.
    expect(sideKind({ x: 1, y: -0.3, z: 0 })).toBe('side:75');
    expect(sideKind({ x: 1, y: 1, z: 0 })).toBe('side:135');
    expect(sideKind({ x: -1, y: -1, z: 0 })).toBe('side:135');
    expect(sideKind({ x: 0, y: 0, z: 1 })).toBe('side:0'); // seen end-on
  });

  it('leaves flat shapes and colors it cannot read as they are', () => {
    const children = [
      ellipse({ diameter: 40, fill: true, color: '#c33' }),
      dot({ translate: { y: 50 }, stroke: 20, color: 'currentColor' }),
      path({ path: [{ x: -30 }, { x: 30 }], stroke: 12, color: 'currentColor' }),
    ];
    expect(renderSvg(scene(children, { shading: 'soft' }))).toBe(renderSvg(scene(children)));
  });

  it('shades a thick line as a tube: the same line stroked from dark and wide to light and narrow', () => {
    const line = path({ path: [{ x: -30 }, { x: 30 }], stroke: 20, color: '#3366cc' });
    const flat = renderSvg(scene([line]));
    const soft = renderSvg(scene([line], { shading: 'soft' }));
    const d = flat.match(/ d="([^"]+)"/)?.[1];
    const strokes = [
      ...soft.matchAll(/<path d="([^"]+)" stroke="(#[0-9a-f]{6})" stroke-width="([\d.]+)"/g),
    ];
    expect(strokes.length).toBeGreaterThanOrEqual(5);
    expect(strokes.every((m) => m[1] === d)).toBe(true);
    const widths = strokes.map((m) => Number(m[3]));
    expect(widths[0]).toBe(20);
    expect(widths).toEqual([...widths].sort((x, y) => y - x));
    const blue = strokes.map((m) => Number.parseInt((m[2] as string).slice(5), 16));
    expect(blue).toEqual([...blue].sort((x, y) => x - y));
    // The full width is not moved; the rest move up and to the left, toward the light.
    expect(soft.match(/transform="translate\(-[\d.]+ -[\d.]+\)"/g)).toHaveLength(
      strokes.length - 1,
    );
    expect(soft).not.toContain('Gradient');
  });

  it('rejects other values with a hint', () => {
    const [issue] = checkScene({ ...scene([ball]), shading: 'smooth' });
    expect(issue?.message).toBe(
      'scene.shading: expected "flat" or "soft", received "smooth". Use "soft" to shade round things with a gradient, or leave the option out.',
    );
  });

  it('shades a turning picture, stepping the gradient of a round side as its direction changes', () => {
    const upright = cylinder({ diameter: 40, length: 60, rotate: { x: 90 }, color: '#4a7bd0' });
    const lying = cylinder({ translate: { y: -60 }, diameter: 20, length: 60, color: '#2a9d8f' });
    const flat = renderSpinSvg(scene([ball, upright]));
    const soft = renderSpinSvg(scene([ball, upright], { shading: 'soft' }));
    expect(flat).not.toContain('Gradient');
    expect(soft).toContain('<radialGradient id="zs-b-e8a865"');
    // The upright cylinder's side runs the same way all the way round: one
    // gradient, and the same animation as the flat picture.
    expect(soft.match(/<linearGradient /g)).toHaveLength(1);
    expect(soft.match(/<animate /g)?.length).toBe(flat.match(/<animate /g)?.length);

    // A cylinder lying down points every way on screen as it turns. Its side
    // steps through the gradients, fill and rounded edge alike.
    const turning = renderSpinSvg(scene([lying], { shading: 'soft' }));
    const plain = renderSpinSvg(scene([lying]));
    const gradients = turning.match(/<linearGradient /g)?.length ?? 0;
    expect(gradients).toBeGreaterThan(2);
    // A paint that points to a gradient cannot be animated (browsers paint it
    // black), so the side is drawn once per gradient and shown one at a time.
    expect(turning).not.toMatch(/attributeName="(fill|stroke)"/);
    const shows = turning.match(
      /<path d="[^"]+" fill="url\(#zs-lm?\d+-[0-9a-f]+\)" stroke="url\(#zs-lm?\d+-[0-9a-f]+\)" visibility="(visible|hidden)"><animate attributeName="d"[^>]*\/><animate attributeName="visibility"[^>]*calcMode="discrete"/g,
    );
    expect(shows).toHaveLength(gradients);
    expect(shows?.filter((x) => x.includes('visibility="visible"'))).toHaveLength(1);
    // Each copy moves by itself: WebKit does not redraw a moving shape that
    // is reached through two levels of <use>.
    expect(turning).not.toMatch(/<g id="[^"]+"[^>]*>(<[^g][^>]*>)*<use /);
    const switches = (svg: string) => svg.match(/attributeName="visibility"/g)?.length ?? 0;
    expect(switches(turning) - switches(plain)).toBe(gradients);
  });

  it('paints a tube in a turning picture as layered strokes that each move', () => {
    const line = path({ path: [{ x: -30, z: 10 }, { x: 30 }], stroke: 20, color: '#3366cc' });
    const flat = renderSpinSvg(scene([line]));
    const soft = renderSpinSvg(scene([line], { shading: 'soft' }));
    const layers = soft.match(
      /<path d="[^"]+" stroke="#[0-9a-f]{6}" stroke-width=[^>]*><animate /g,
    );
    expect(layers?.length).toBeGreaterThanOrEqual(5);
    expect(soft.match(/<animate /g)?.length).toBe(
      (flat.match(/<animate /g)?.length ?? 0) * (layers?.length ?? 0),
    );
    // Not shared through a second level of <use>: WebKit would not redraw it.
    expect(soft.match(/<use /g)).toHaveLength(1);
  });
});
