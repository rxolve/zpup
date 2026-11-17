import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pup } from '../examples/pup.ts';
import {
  compileScene,
  dot,
  ellipse,
  frameToSvg,
  path,
  rect,
  renderSvg,
  type Scene,
  type SvgOptions,
  ZpupValidationError,
} from '../src/index.ts';
import { formatNumber } from '../src/svg.ts';

const small: Scene = {
  width: 120,
  height: 80,
  background: '#fff',
  title: 'Dot & ring',
  rotate: { x: -20, y: 30 },
  children: [
    rect({ width: 40, height: 20, fill: true, stroke: 2, color: '#636', translate: { z: -20 } }),
    dot({ stroke: 24, color: '#e62' }),
    ellipse({ diameter: 50, stroke: 3, color: 'teal', rotate: { x: 80 } }),
    path({
      path: [
        { x: -30, y: 20 },
        {
          bezier: [
            { x: -10, y: 35 },
            { x: 10, y: 35 },
            { x: 30, y: 20 },
          ],
        },
      ],
      stroke: 4,
    }),
  ],
};

describe('renderSvg', () => {
  it('renders a small scene', () => {
    expect(renderSvg(small)).toMatchInlineSnapshot(`
      "<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80" role="img" aria-label="Dot &amp; ring">
      <title>Dot &amp; ring</title>
      <rect width="100%" height="100%" fill="#fff"/>
      <path d="M47.69 28.63C53.67 27.45 60.46 27.65 66.6 28.94" fill="none" stroke="teal" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M60 69.37C68.66 67.66 77.32 62.42 85.98 53.66" fill="none" stroke="#333" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M35.99 34.98C37.68 32.15 41.71 29.81 47.69 28.63" fill="none" stroke="teal" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M32.68 28.1L67.32 21.26L67.32 40.05L32.68 46.89Z" fill="#636" stroke="#636" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M66.6 28.94C72.75 30.22 78.25 32.58 81.65 35.72C85.05 38.86 85.7 42.19 84.01 45.02C82.32 47.85 78.29 50.19 72.31 51.37" fill="none" stroke="teal" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M34.02 63.92C42.68 69.26 51.34 71.08 60 69.37" fill="none" stroke="#333" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="60" cy="40" r="12" fill="#e62"/>
      <path d="M38.35 44.28C34.95 41.14 34.3 37.81 35.99 34.98" fill="none" stroke="teal" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M53.4 51.06C47.25 49.78 41.75 47.42 38.35 44.28" fill="none" stroke="teal" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M72.31 51.37C66.33 52.55 59.54 52.35 53.4 51.06" fill="none" stroke="teal" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      "
    `);
  });

  it('returns the same string for the same input', () => {
    expect(renderSvg(small)).toBe(renderSvg(small));
  });

  it('renders a scene that went through JSON identically', () => {
    expect(renderSvg(JSON.parse(JSON.stringify(pup)))).toBe(renderSvg(pup));
  });

  it('matches the committed example image', () => {
    const committed = readFileSync(new URL('../examples/pup.svg', import.meta.url), 'utf8');
    expect(renderSvg(pup)).toBe(committed);
  });

  it('escapes text', () => {
    const svg = renderSvg({ width: 10, height: 10, title: '<b> "a" & b', children: [] });
    expect(svg).toContain('<title>&lt;b&gt; &quot;a&quot; &amp; b</title>');
  });

  it('rejects bad options with the same error as bad scenes', () => {
    const scene = { width: 10, height: 10, children: [] };
    const thrown = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e;
      }
      return undefined;
    };
    const bad = thrown(() => renderSvg(scene, { precision: 1.5 })) as ZpupValidationError;
    expect(bad).toBeInstanceOf(ZpupValidationError);
    expect(bad.message).toMatch(/^Invalid SVG options \(1 problem\)/);
    expect(bad.issues[0]).toMatchObject({
      path: 'options.precision',
      pathSegments: ['options', 'precision'],
      detail: 'expected an integer from 0 to 10, received 1.5. Use a whole number such as 2.',
    });
    const typo = thrown(() =>
      renderSvg(scene, { precison: 1 } as unknown as SvgOptions),
    ) as ZpupValidationError;
    expect(typo.issues[0]?.hint).toBe('Did you mean "precision"?');
    const both = thrown(() =>
      renderSvg({ width: 10, children: [] } as unknown as Scene, { precision: -1 }),
    ) as ZpupValidationError;
    expect(both.message).toMatch(/^Invalid Zpup scene and SVG options \(2 problems\)/);
    const frame = compileScene(scene);
    expect(thrown(() => frameToSvg(frame, { precision: 11 }))).toBeInstanceOf(ZpupValidationError);
  });

  it('honors precision', () => {
    const scene: Scene = {
      width: 10,
      height: 10,
      children: [dot({ translate: { x: 1 / 3 }, stroke: 1 })],
    };
    expect(renderSvg(scene, { precision: 0 })).toContain('cx="5"');
    expect(renderSvg(scene, { precision: 3 })).toContain('cx="5.333"');
    expect(() => renderSvg(scene, { precision: 1.5 })).toThrow(ZpupValidationError);
  });
});

describe('formatNumber', () => {
  it('trims zeros and never prints negative zero', () => {
    expect(formatNumber(1.5)).toBe('1.5');
    expect(formatNumber(2.004)).toBe('2');
    expect(formatNumber(-0.001)).toBe('0');
    expect(formatNumber(-1.236)).toBe('-1.24');
  });
});
