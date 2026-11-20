import { gzipSync } from 'node:zlib';
import { SaxesParser } from 'saxes';
import { beforeAll, describe, expect, it } from 'vitest';
import { lighthouse } from '../examples/lighthouse.ts';
import { pup } from '../examples/pup.ts';
import { depthWork } from '../src/depth.ts';
import {
  dot,
  ellipse,
  path,
  rect,
  renderSpinSvg,
  renderSvg,
  type Scene,
  type SpinOptions,
  ZpupValidationError,
} from '../src/index.ts';
import { compilePieces, paintConstraints } from '../src/pieces.ts';
import { planSpin, SPIN_STEPS } from '../src/spin.ts';
import { normalizeScene } from '../src/validate.ts';

interface Element {
  name: string;
  attributes: Record<string, string>;
  children: Element[];
}

/** Parses an XML string into a plain tree, failing on any well-formedness error. */
function parse(xml: string): Element {
  const parser = new SaxesParser({ xmlns: false });
  const root: Element = { name: '#root', attributes: {}, children: [] };
  const stack = [root];
  parser.on('error', (error) => {
    throw error;
  });
  parser.on('opentag', (tag) => {
    const element: Element = {
      name: tag.name,
      attributes: Object.fromEntries(
        Object.entries(tag.attributes).map(([k, v]) => [k, String(v)]),
      ),
      children: [],
    };
    stack[stack.length - 1]?.children.push(element);
    stack.push(element);
  });
  parser.on('closetag', () => {
    stack.pop();
  });
  parser.write(xml).close();
  return root.children[0] as Element;
}

interface Group {
  /** Piece indices in paint order. */
  order: number[];
  /** Whether the group is visible at each step of the turn. */
  visible: boolean[];
}

/** Reads the epoch groups of a spin SVG and when each of them is shown. */
function groupsOf(svg: Element): Group[] {
  return svg.children
    .filter((e) => e.name === 'g')
    .map((g) => {
      const order = g.children
        .filter((e) => e.name === 'use')
        .map((u) => Number((u.attributes.href ?? '').split('-').pop()));
      const animate = g.children.find((e) => e.name === 'animate');
      const visible: boolean[] = [];
      if (!animate) {
        expect(g.attributes.display ?? 'inline').toBe('inline');
        for (let step = 0; step < SPIN_STEPS; step++) visible.push(true);
        return { order, visible };
      }
      expect(animate.attributes).toMatchObject({
        attributeName: 'display',
        calcMode: 'discrete',
        repeatCount: 'indefinite',
      });
      const times = (animate.attributes.keyTimes ?? '').split(';').map(Number);
      const values = (animate.attributes.values ?? '').split(';');
      expect(times[0]).toBe(0);
      expect(values).toHaveLength(times.length);
      expect(g.attributes.display).toBe(values[0]);
      for (let step = 0; step < SPIN_STEPS; step++) {
        let value = values[0];
        times.forEach((t, i) => {
          if (Math.round(t * SPIN_STEPS) <= step) value = values[i];
        });
        visible.push(value === 'inline');
      }
      return { order, visible };
    });
}

const at = (scene: Scene, y: number): Scene => ({
  ...scene,
  rotate: { ...scene.rotate, y: (scene.rotate?.y ?? 0) + y },
});

describe('renderSpinSvg', () => {
  const svg = renderSpinSvg(pup);
  const tree = parse(svg);

  it('returns well-formed XML with one definition per piece', () => {
    expect(tree.name).toBe('svg');
    expect(tree.attributes).toMatchObject({ width: '240', height: '240', role: 'img' });
    const defs = tree.children.find((e) => e.name === 'defs');
    expect(defs?.children).toHaveLength(compilePieces(normalizeScene(pup)).length);
  });

  it('is deterministic', () => {
    expect(renderSpinSvg(pup)).toBe(svg);
    expect(renderSpinSvg(JSON.parse(JSON.stringify(pup)))).toBe(svg);
  });

  it('shows exactly one group at every step of the turn', () => {
    const groups = groupsOf(tree);
    for (let step = 0; step < SPIN_STEPS; step++) {
      expect(groups.filter((g) => g.visible[step]).length, `step ${step}`).toBe(1);
    }
  });

  it('plans epochs that cover the turn without gaps or overlaps', () => {
    const epochs = planSpin(normalizeScene(pup), { axis: 'y', direction: 'positive' });
    expect(epochs[0]?.start).toBe(0);
    expect(epochs.at(-1)?.end).toBe(SPIN_STEPS);
    epochs.forEach((e, i) => {
      expect(e.end).toBeGreaterThan(e.start);
      if (i > 0) expect(e.start).toBe(epochs[i - 1]?.end);
    });
  });

  it('paints every overlapping pair in the right order at every step', () => {
    const s = normalizeScene(pup);
    const groups = groupsOf(tree);
    for (let step = 0; step < SPIN_STEPS; step++) {
      const shown = groups.find((g) => g.visible[step]) as Group;
      const position: number[] = [];
      shown.order.forEach((piece, n) => {
        position[piece] = n;
      });
      const pieces = compilePieces(s, { ...s.rotate, y: s.rotate.y + (step * 360) / SPIN_STEPS });
      for (const [before, after] of paintConstraints(pieces).constraints) {
        expect(
          position[before] as number,
          `${pieces[before]?.nodeId} before ${pieces[after]?.nodeId} at step ${step}`,
        ).toBeLessThan(position[after] as number);
      }
    }
  });

  it('starts with the still picture, for renderers without SMIL', () => {
    // Every shape here is a single piece, so the first frame should match
    // the still renderer element for element.
    const scene: Scene = {
      width: 120,
      height: 100,
      rotate: { x: -20, y: 30 },
      children: [
        rect({
          width: 60,
          height: 30,
          fill: true,
          stroke: 2,
          color: '#636',
          translate: { z: -20 },
        }),
        dot({ stroke: 24, color: '#e62' }),
        ellipse({ diameter: 70, fill: true, stroke: 0, color: '#9cd', rotate: { x: 90 } }),
        path({
          path: [
            { x: -30, y: 20 },
            { x: 30, y: 20 },
          ],
          stroke: 6,
        }),
      ],
    };
    const spin = parse(renderSpinSvg(scene));
    const still = parse(renderSvg(scene, { precision: 1 }));
    const defs = new Map(
      (spin.children.find((e) => e.name === 'defs') as Element).children.map((e) => [
        e.attributes.id,
        e,
      ]),
    );
    const first = spin.children.find(
      (e) => e.name === 'g' && (e.attributes.display ?? 'inline') === 'inline',
    ) as Element;
    const shown = first.children
      .filter((e) => e.name === 'use')
      .map((u) => {
        const e = defs.get((u.attributes.href ?? '').slice(1)) as Element;
        const { id: _, ...attributes } = e.attributes;
        return { name: e.name, attributes };
      });
    const expected = still.children
      .filter((e) => e.name !== 'title' && e.name !== 'rect')
      .map((e) => ({ name: e.name, attributes: e.attributes }));
    expect(shown).toEqual(expected);
  });

  it('draws a scene with one shape as a single group with no visibility switching', () => {
    const out = renderSpinSvg({ width: 50, height: 50, children: [dot({ stroke: 10 })] });
    expect(out).toMatchInlineSnapshot(`
      "<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">
      <defs>
      <circle id="zxudn-0" cx="25" cy="25" r="5" fill="#333"/>
      </defs>
      <g><use href="#zxudn-0"/></g>
      </svg>
      "
    `);
  });

  it('uses a single epoch when no shapes ever overlap', () => {
    // Dots stacked on the turning axis stay where they are.
    const scene: Scene = {
      width: 100,
      height: 200,
      rotate: { x: -10 },
      children: [-50, 0, 50].map((y) => dot({ translate: { y }, stroke: 30 })),
    };
    expect(planSpin(normalizeScene(scene), { axis: 'y', direction: 'positive' })).toHaveLength(1);
    const groups = groupsOf(parse(renderSpinSvg(scene)));
    expect(groups).toHaveLength(1);
  });

  it('renders an empty scene', () => {
    const out = parse(renderSpinSvg({ width: 10, height: 10, children: [] }));
    expect(out.children.map((e) => e.name)).toEqual(['defs', 'g']);
  });

  it('follows the options', () => {
    const scene: Scene = { width: 100, height: 100, children: [dot({ translate: { x: 20 } })] };
    const out = renderSpinSvg(scene, { keyframes: 4, duration: 2.5, precision: 0 });
    expect(out).toContain('values="70;50;30;50;70"');
    expect(out).toContain('dur="2.5s"');
    // Turning the other way visits the same positions in the opposite order.
    expect(renderSpinSvg(scene, { keyframes: 4, precision: 0, axis: 'z' })).toContain(
      'attributeName="cy" dur="8s" repeatCount="indefinite" values="50;70;50;30;50"',
    );
    expect(
      renderSpinSvg(scene, { keyframes: 4, precision: 0, axis: 'z', direction: 'negative' }),
    ).toContain('attributeName="cy" dur="8s" repeatCount="indefinite" values="50;30;50;70;50"');
  });

  it('keeps the output size of the pup in check', () => {
    // Measured at 42,900 bytes and 5,920 gzipped; fail on a clear regression.
    expect(svg.length).toBeLessThan(50_000);
    expect(gzipSync(svg, { level: 9 }).length).toBeLessThan(7_500);
  });

  it('turns the same scene into the same frames as the still renderer at keyframe angles', () => {
    // At 90 degrees (keyframe 9 of 36), each piece's keyframe value equals
    // the still render of the turned scene.
    const turned = parse(renderSvg(at(pup, 90), { precision: 1 }));
    const circles = turned.children
      .filter((e) => e.name === 'circle')
      .map((e) => `${e.attributes.cx};${e.attributes.cy}`);
    const defs = (tree.children.find((e) => e.name === 'defs') as Element).children;
    const tenth = defs
      .filter((e) => e.name === 'circle')
      .map((e) => {
        // A piece on the turn axis does not move and has no animation.
        const values = (name: string) =>
          e.children
            .find((a) => a.attributes.attributeName === name)
            ?.attributes.values?.split(';')
            .at(9) ?? e.attributes[name];
        return `${values('cx')};${values('cy')}`;
      });
    expect(new Set(tenth)).toEqual(new Set(circles));
  });
});

describe('renderSpinSvg options', () => {
  const issues = (options: unknown) => {
    try {
      renderSpinSvg(pup, options as SpinOptions);
    } catch (error) {
      if (error instanceof ZpupValidationError) return error;
      throw error;
    }
    throw new Error('expected a validation error');
  };

  it('reports every problem at once, with hints', () => {
    const error = issues({
      axis: 'Y',
      duration: '8s',
      keyframes: 36.5,
      direction: 'clockwise',
      precison: 2,
    });
    expect(error.message).toMatchInlineSnapshot(`
      "Invalid spin options (5 problems):
        - options.precison: unknown option "precison". Did you mean "precision"? Allowed: "axis", "duration", "keyframes", "direction", "precision".
        - options.axis: expected one of "x", "y", "z", received "Y". Did you mean "y"?
        - options.direction: expected one of "positive" or "negative", received "clockwise".
        - options.duration: expected a number of seconds of at least 0.1, received "8s". Use a plain number of seconds without a unit, e.g. 8.
        - options.keyframes: expected an integer from 4 to 720, received 36.5. Use a whole number such as 37."
    `);
    expect(error.issues.map((i) => i.path)).toEqual([
      'options.precison',
      'options.axis',
      'options.direction',
      'options.duration',
      'options.keyframes',
    ]);
  });

  it('checks ranges', () => {
    expect(issues({ keyframes: 2 }).issues[0]?.message).toBe(
      'options.keyframes: expected an integer from 4 to 720, received 2.',
    );
    expect(issues({ precision: 11 }).issues[0]?.path).toBe('options.precision');
    expect(issues({ duration: 0 }).issues[0]?.path).toBe('options.duration');
    expect(issues({ duration: Number.POSITIVE_INFINITY }).issues[0]?.received).toBe('Infinity');
    expect(issues('fast').message).toContain('options: expected an options object');
  });

  it('reports scene and option problems together', () => {
    try {
      renderSpinSvg({ width: 10, children: [] } as unknown as Scene, { axis: 'w' as 'x' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ZpupValidationError);
      expect((error as ZpupValidationError).message).toMatch(
        /^Invalid Zpup scene and spin options \(2 problems\)/,
      );
    }
  });
});

/**
 * Time limit for tests that depth-sort a whole turn (720 steps). Locally they
 * take under a second; CI machines have been 3 to 4 times slower.
 */
const FULL_TURN_TIMEOUT = 20_000;

describe('renderSpinSvg with solids', () => {
  const s = normalizeScene(lighthouse);
  let tree: Element = { name: '#root', attributes: {}, children: [] };
  let work = { ...depthWork };
  beforeAll(() => {
    Object.assign(depthWork, { sorts: 0, comparisons: 0, roundComparisons: 0 });
    tree = parse(renderSpinSvg(lighthouse));
    work = { ...depthWork };
  }, FULL_TURN_TIMEOUT);

  it('depth-sorts no more than it needs to', () => {
    // Counted, not timed, so that a slow machine cannot fail it. Measured at
    // 720 sorts, 39,377 compared pairs and 27,152 against a round surface;
    // pairs that cannot overlap on screen are not compared (comparing every
    // pair whose bounds meet gave 151,180).
    expect(work.sorts).toBe(SPIN_STEPS);
    expect(work.comparisons).toBeLessThan(47_000);
    expect(work.roundComparisons).toBeLessThan(33_000);
  });

  it('keeps every face, including those turned away, so they can come into view', () => {
    const defs = tree.children.find((e) => e.name === 'defs');
    expect(defs?.children).toHaveLength(compilePieces(s).length);
  });

  it(
    'shows one group at every step and paints every overlapping pair in order',
    () => {
      const groups = groupsOf(tree);
      // Collected and checked once: tens of thousands of separate expect()
      // calls cost more than the depth sorting they check.
      const wrong: string[] = [];
      for (let step = 0; step < SPIN_STEPS; step++) {
        const shown = groups.filter((g) => g.visible[step]);
        expect(shown.length, `step ${step}`).toBe(1);
        const position: number[] = [];
        (shown[0] as Group).order.forEach((piece, n) => {
          position[piece] = n;
        });
        const pieces = compilePieces(s, { ...s.rotate, y: s.rotate.y + (step * 360) / SPIN_STEPS });
        for (const [before, after] of paintConstraints(pieces).constraints) {
          if (!((position[before] as number) < (position[after] as number))) {
            wrong.push(`step ${step}: ${before} before ${after}`);
          }
        }
      }
      expect(wrong).toEqual([]);
    },
    FULL_TURN_TIMEOUT,
  );

  it('gives every piece the same path commands in every keyframe', () => {
    for (const path of tree.children.find((e) => e.name === 'defs')?.children ?? []) {
      const animate = path.children.find((a) => a.attributes.attributeName === 'd');
      if (!animate) continue;
      const shapes = new Set(
        (animate.attributes.values ?? '').split(';').map((d) => d.replace(/[^A-Z]/g, '')),
      );
      expect(shapes.size).toBe(1);
    }
  });
});
