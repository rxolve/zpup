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
    expect(svg).toContain('x1="0" y1="0" x2="1" y2="0"');
    // The side (fill and rounded edge) uses the gradient; the visible end does not.
    expect(svg.match(/fill="url\(#zs-l0-/g)).toHaveLength(1);
    expect(svg.match(/fill="#/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it('runs the gradient across the side, away from the upper left', () => {
    expect(sideKind({ x: 0, y: -1, z: 0 })).toBe('side:0'); // upright: left to right
    expect(sideKind({ x: 0, y: 1, z: 0 })).toBe('side:0');
    expect(sideKind({ x: 1, y: 0, z: 0 })).toBe('side:90'); // lying: top to bottom
    expect(sideKind({ x: 1, y: -1, z: 0 })).toBe('side:45');
    expect(sideKind({ x: 0, y: 0, z: 1 })).toBe('side:0'); // seen end-on
  });

  it('leaves flat shapes, lines and colors it cannot read as they are', () => {
    const children = [
      ellipse({ diameter: 40, fill: true, color: '#c33' }),
      path({ path: [{ x: -30 }, { x: 30 }], stroke: 12, color: '#36c' }),
      dot({ translate: { y: 50 }, stroke: 20, color: 'currentColor' }),
    ];
    expect(renderSvg(scene(children, { shading: 'soft' }))).toBe(renderSvg(scene(children)));
  });

  it('rejects other values with a hint', () => {
    const [issue] = checkScene({ ...scene([ball]), shading: 'smooth' });
    expect(issue?.message).toBe(
      'scene.shading: expected "flat" or "soft", received "smooth". Use "soft" to shade round things with a gradient, or leave the option out.',
    );
  });

  it('shades a turning picture, keeping a round side flat when its direction changes', () => {
    const upright = cylinder({ diameter: 40, length: 60, rotate: { x: 90 }, color: '#4a7bd0' });
    const lying = cylinder({ translate: { y: -60 }, diameter: 20, length: 60, color: '#2a9d8f' });
    const flat = renderSpinSvg(scene([ball, upright, lying]));
    const soft = renderSpinSvg(scene([ball, upright, lying], { shading: 'soft' }));
    expect(flat).not.toContain('Gradient');
    expect(soft).toContain('<radialGradient id="zs-b-e8a865"');
    // The upright cylinder's side runs the same way all the way round.
    expect(soft.match(/<linearGradient /g)).toHaveLength(1);
    // Same shapes and animation, only the paint differs.
    expect(soft.match(/<animate /g)?.length).toBe(flat.match(/<animate /g)?.length);
  });
});
