import { describe, expect, it } from 'vitest';
import { extractDocument, scoreReply, scoreSvg, scoreZpup } from '../lib/score.ts';

const canvas = { width: 400, height: 400 };
const options = { canvas, rotationOffsetsDeg: [0, 60, -60] };
const NS = 'xmlns="http://www.w3.org/2000/svg"';

describe('extractDocument', () => {
  it('keeps a bare reply and trims it', () => {
    expect(extractDocument('  <svg/>\n')).toEqual({ text: '<svg/>', fenced: false });
  });

  it('takes the first fenced block', () => {
    expect(extractDocument('Here:\n```json\n{"a":1}\n```\nmore')).toEqual({
      text: '{"a":1}',
      fenced: true,
    });
  });
});

describe('scoreSvg', () => {
  it('accepts a well-formed SVG that draws something', () => {
    const svg = `<svg ${NS} width="400" height="400"><circle r="5"/></svg>`;
    expect(scoreSvg(svg, canvas)).toEqual({ valid: true, problems: [], warnings: [], svg });
  });

  it('reports parser errors with their position', () => {
    const result = scoreSvg(`<svg ${NS}><g><circle r="5"/></svg>`, canvas);
    expect(result.valid).toBe(false);
    expect(result.problems[0]).toMatch(/^XML parse error: 1:\d+: /);
  });

  it('requires the root element to be svg', () => {
    expect(scoreSvg('<html><body/></html>', canvas).problems).toEqual([
      'The root element is <html>; expected <svg>.',
    ]);
  });

  it('does not count shapes that are only defined, not drawn', () => {
    const result = scoreSvg(`<svg ${NS}><defs><circle id="c" r="5"/></defs></svg>`, canvas);
    expect(result.valid).toBe(false);
    expect(result.problems[0]).toMatch(/draws nothing/);
  });

  it('counts <use> as drawing', () => {
    const svg = `<svg ${NS}><defs><circle id="c" r="5"/></defs><use href="#c"/></svg>`;
    expect(scoreSvg(svg, canvas).valid).toBe(true);
  });

  it('warns about a missing namespace and a wrong size without failing', () => {
    const result = scoreSvg(
      '<svg viewBox="0 0 200 100"><rect width="1" height="1"/></svg>',
      canvas,
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(2);
  });

  it('rejects text that is not XML at all', () => {
    expect(scoreSvg('I cannot draw that.', canvas).valid).toBe(false);
    expect(scoreSvg('', canvas).problems).toEqual(['The reply is empty.']);
  });
});

describe('scoreZpup', () => {
  const scene = {
    width: 400,
    height: 400,
    rotate: { x: -20 },
    children: [{ type: 'path', path: [{}], stroke: 40, color: '#e62' }],
  };

  it('renders a valid scene at every rotation offset', () => {
    const result = scoreZpup(JSON.stringify(scene), options);
    expect(result.valid).toBe(true);
    expect(result.svg).toMatch(/^<svg /);
    expect(result.rotations?.map((r) => r.offsetDeg)).toEqual([0, 60, -60]);
    expect(result.rotations?.every((r) => r.svg?.startsWith('<svg '))).toBe(true);
  });

  it('turns the view about the vertical axis on top of the scene rotation', () => {
    const offCenter = {
      ...scene,
      rotate: { y: 10 },
      children: [{ type: 'path', path: [{ x: 100 }], stroke: 10 }],
    };
    const result = scoreZpup(JSON.stringify(offCenter), { canvas, rotationOffsetsDeg: [80] });
    // At y = 90 degrees the point at x = 100 lies on the vertical center line.
    expect(result.rotations?.[0]?.svg).toContain('cx="200"');
  });

  it('rejects a valid scene that draws nothing, like an SVG without shapes', () => {
    const result = scoreZpup('{"width":400,"height":400,"children":[{"type":"group"}]}', options);
    expect(result).toEqual({
      valid: false,
      problems: ['The scene draws nothing: it has no visible shape.'],
      warnings: [],
    });
  });

  it('reports JSON errors', () => {
    const result = scoreZpup('{ "width": 400, }', options);
    expect(result.valid).toBe(false);
    expect(result.problems[0]).toMatch(/^JSON parse error: /);
  });

  it('reports every checkScene issue', () => {
    const result = scoreZpup(
      JSON.stringify({
        width: 400,
        height: 400,
        children: [{ type: 'circle' }, { type: 'group', colour: 'red' }],
      }),
      options,
    );
    expect(result.valid).toBe(false);
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]).toContain('scene.children[0].type');
  });
});

describe('scoreReply', () => {
  it('applies the same fence handling to both formats and warns about it', () => {
    const svg = scoreReply(
      'svg',
      `\`\`\`svg\n<svg ${NS} width="400" height="400"><circle r="1"/></svg>\n\`\`\``,
      options,
    );
    const zpup = scoreReply(
      'zpup',
      '```json\n{"width":400,"height":400,"children":[{"type":"path","path":[{}]}]}\n```',
      options,
    );
    expect(svg.valid).toBe(true);
    expect(zpup.valid).toBe(true);
    expect(svg.warnings[0]).toMatch(/code fence/);
    expect(zpup.warnings[0]).toMatch(/code fence/);
  });
});
