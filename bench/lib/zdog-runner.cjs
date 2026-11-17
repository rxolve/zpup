/**
 * Runs one model-written Zdog script and prints the SVG it draws.
 *
 * Started by bench/lib/zdog.ts as its own process, with Node's permission
 * model switched on and file access limited to this file and the zdog
 * package, an empty environment and a time limit: the script comes from a
 * model and is not trusted.
 *
 * Input (stdin, JSON): { code, width, height, offsetsDeg, zdogDir }.
 * Output (stdout, JSON): { ok: true, svg, paths, rendered, rotations } or
 * { ok: false, error }.
 *
 * Zdog draws SVG through a handful of DOM calls, so a small stand-in for the
 * DOM is enough; no browser is involved.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

class FakeElement {
  constructor(name) {
    this.nodeName = name;
    this.tagName = name;
    this.attributes = new Map();
    this.children = [];
    this.style = {};
    this.parentNode = null;
  }
  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  addEventListener() {}
  removeEventListener() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  getContext() {
    return null;
  }
}

const escapeXml = (text) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function serialize(element, root) {
  const attributes = [...element.attributes].map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join('');
  const ns = root ? ` xmlns="${SVG_NS}"` : '';
  const inner = element.children.map((c) => serialize(c, false)).join('');
  return `<${element.nodeName}${ns}${attributes}>${inner}</${element.nodeName}>`;
}

function countPaths(element) {
  return element.children.reduce(
    (n, c) => n + (c.nodeName === 'path' && c.getAttribute('d') ? 1 : 0) + countPaths(c),
    0,
  );
}

function run(input) {
  const svg = new FakeElement('svg');
  svg.setAttribute('class', 'zdog-svg');
  svg.setAttribute('width', input.width);
  svg.setAttribute('height', input.height);

  const document = {
    querySelector: () => svg,
    querySelectorAll: () => [svg],
    getElementById: () => svg,
    getElementsByClassName: () => [svg],
    getElementsByTagName: () => [svg],
    createElementNS: (_ns, name) => new FakeElement(name),
    createElement: (name) => new FakeElement(name),
    addEventListener() {},
    removeEventListener() {},
    body: new FakeElement('body'),
    documentElement: new FakeElement('html'),
  };
  const window = {
    document,
    innerWidth: input.width,
    innerHeight: input.height,
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
    // The picture is taken after the script returns; animation frames never run.
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    setTimeout: () => 0,
    setInterval: () => 0,
    clearTimeout() {},
    clearInterval() {},
  };
  globalThis.document = document;
  globalThis.window = window;
  for (const name of ['requestAnimationFrame', 'cancelAnimationFrame'])
    globalThis[name] = window[name];
  globalThis.setTimeout = window.setTimeout;
  globalThis.setInterval = window.setInterval;

  const Zdog = require(input.zdogDir);
  window.Zdog = Zdog;
  globalThis.Zdog = Zdog;

  // Remember every illustration the script makes and whether it rendered one.
  const illustrations = [];
  let rendered = false;
  const Original = Zdog.Illustration;
  const render = Original.prototype.updateRenderGraph;
  Original.prototype.updateRenderGraph = function (...args) {
    if (!illustrations.includes(this)) illustrations.push(this);
    rendered = true;
    return render.apply(this, args);
  };
  const create = Original.prototype.create;
  Original.prototype.create = function (...args) {
    illustrations.push(this);
    return create.apply(this, args);
  };

  new Function('Zdog', 'document', 'window', input.code)(Zdog, document, window);

  const onSvg = illustrations.filter((i) => i.element === svg);
  if (illustrations.length === 0) {
    return { ok: false, error: 'The script created no Zdog.Illustration.' };
  }
  if (onSvg.length === 0) {
    return {
      ok: false,
      error: 'No Zdog.Illustration is attached to the <svg class="zdog-svg"> element.',
    };
  }
  const illo = onSvg[onSvg.length - 1];
  // A script that builds the scene but never renders it still gets its picture.
  render.call(illo);
  const paths = countPaths(svg);
  const result = { ok: true, svg: serialize(svg, true), paths, rendered, rotations: [] };
  const base = illo.rotate.y;
  for (const offsetDeg of input.offsetsDeg) {
    try {
      illo.rotate.y = base + (offsetDeg * Math.PI) / 180;
      render.call(illo);
      result.rotations.push({ offsetDeg, svg: serialize(svg, true) });
    } catch (error) {
      result.rotations.push({ offsetDeg, error: String(error?.message ?? error) });
    }
  }
  if (input.turnsDeg?.length) {
    result.turns = [];
    for (const offsetDeg of input.turnsDeg) {
      try {
        illo.rotate.y = base + (offsetDeg * Math.PI) / 180;
        render.call(illo);
        result.turns.push({ offsetDeg, ...paintedParts(illo, svg, Zdog, input) });
      } catch (error) {
        result.turns.push({ offsetDeg, error: String(error?.message ?? error) });
      }
    }
    illo.rotate.y = base;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Turn errors: what Zdog painted, as primitives for bench/lib/turns.ts.
//
// The paint order is read from the picture itself: the <path> elements of the
// SVG, in document order, are exactly what Zdog painted and in which order
// (its own sorting, Groups painted in their own order, `visible` and
// `backface` already applied). Each element is traced back to the Zdog object
// that owns it, and that object's transformed path gives the geometry, with
// depth. Colors and stroke widths are read from the element as rendered.
// Anything that cannot be traced or modeled is counted as excluded.

const TAU = Math.PI * 2;
/** Straight pieces per Bezier curve or arc. */
const CURVE_STEPS = 12;
/** Points on the half circle of a hemisphere's dome. */
const DOME_STEPS = 24;

/** Every element Zdog can paint, mapped to the object that paints it and how. */
function owners(illo, Zdog) {
  const map = new Map();
  const seen = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (node instanceof Zdog.Cone && node.surfaceSvgElement) {
      map.set(node.surfaceSvgElement, { node, kind: 'cone' });
    }
    if (node instanceof Zdog.Hemisphere && node.domeSvgElement) {
      map.set(node.domeSvgElement, { node, kind: 'hemisphere' });
    }
    if (node.svgElement) {
      // The group inside a Cylinder paints its round surface; it is not exported.
      if (node instanceof Zdog.Group && node.frontBase && node.rearBase) {
        map.set(node.svgElement, { node, kind: 'cylinder' });
      } else if (node instanceof Zdog.Shape) {
        map.set(node.svgElement, { node, kind: 'shape' });
      }
    }
    if (Array.isArray(node.children)) for (const child of node.children) visit(child);
  };
  visit(illo);
  return map;
}

/** From Zdog's coordinates to image pixels, through the SVG viewBox as rendered. */
function screenMapping(svg, input) {
  const width = Number(svg.getAttribute('width') ?? input.width) || input.width;
  const height = Number(svg.getAttribute('height') ?? input.height) || input.height;
  const box = String(svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) {
    return { scale: 1, dx: 0, dy: 0 };
  }
  // preserveAspectRatio defaults to xMidYMid meet.
  const scale = Math.min(width / box[2], height / box[3]);
  return {
    scale,
    dx: (width - box[2] * scale) / 2 - box[0] * scale,
    dy: (height - box[3] * scale) / 2 - box[1] * scale,
  };
}

const round2 = (v) => Math.round(v * 100) / 100;

function paintedParts(illo, svg, Zdog, input) {
  const map = owners(illo, Zdog);
  const m = screenMapping(svg, input);
  const P = (v) => [
    round2(m.dx + v.x * m.scale),
    round2(m.dy + v.y * m.scale),
    round2(v.z * m.scale),
  ];
  const primitives = [];
  let excluded = 0;
  for (const elem of svg.children) {
    const owner = map.get(elem);
    const look = paintOf(elem);
    // A shape with neither fill nor stroke paints nothing.
    if (owner?.kind === 'shape' && !look.fill && !look.stroke) continue;
    const part = owner ? describe(owner, look, P, m.scale, Zdog) : undefined;
    if (part) primitives.push(part);
    else excluded++;
  }
  return { primitives, excluded, elements: svg.children.length };
}

function isSolidFace(node, Zdog) {
  const parent = node.addTo;
  return (
    node instanceof Zdog.Cone ||
    node instanceof Zdog.Hemisphere ||
    parent instanceof Zdog.Box ||
    (parent instanceof Zdog.Group && (parent.frontBase === node || parent.rearBase === node))
  );
}

function paintOf(elem) {
  const fill = elem.getAttribute('fill');
  const stroke = elem.getAttribute('stroke');
  const width = Number(elem.getAttribute('stroke-width'));
  return {
    fill: fill !== null && fill !== 'none' ? fill : undefined,
    stroke: stroke !== null && stroke !== 'none' && width > 0 ? stroke : undefined,
    width,
  };
}

/** One element as a primitive, or undefined when it cannot be modeled soundly. */
function describe({ node, kind }, look, P, scale, Zdog) {
  if (kind === 'shape') return describeShape(node, look, P, scale, isSolidFace(node, Zdog));
  // The round surfaces. As for the faces of solids, their stroked edge is
  // left out: the area inside it is the solid's true outline on screen, and
  // its depth is the front of the solid.
  if (kind === 'cylinder') {
    const front = node.frontBase;
    const rear = node.rearBase;
    if (!look.stroke || front.width !== undefined || front.height !== undefined) return undefined;
    const r = (front.diameter / 2) * front.renderNormal.magnitude() * scale;
    const a = P(front.renderOrigin);
    const b = P(rear.renderOrigin);
    // Zdog paints a line from one end to the other with butt caps, as wide as
    // the diameter plus the stroke: without the stroke, this band.
    const len = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (!(len > 1e-6) || !(r > 0)) return undefined;
    const length = node.addTo?.length;
    if (!isRound(front, r, sub(a, b), (length * r) / (front.diameter / 2), P)) return undefined;
    const nx = (-(a[1] - b[1]) / len) * r;
    const ny = ((a[0] - b[0]) / len) * r;
    const ring = [
      [a[0] + nx, a[1] + ny, a[2]],
      [b[0] + nx, b[1] + ny, b[2]],
      [b[0] - nx, b[1] - ny, b[2]],
      [a[0] - nx, a[1] - ny, a[2]],
    ];
    return {
      color: look.stroke,
      fill: { rings: [ring], solid: { kind: 'cylinder', base: b, tip: a, radius: r } },
    };
  }
  // An unfilled cone or hemisphere is an outline whose points have no true
  // depth (Zdog computes only their x and y): left out.
  if (!look.fill) return undefined;
  // An elliptical base is not the round solid Zdog's surface assumes.
  if (node.width !== undefined || node.height !== undefined) return undefined;
  // Nor is one scaled differently along its axes (checked below).
  const r = (node.diameter / 2) * node.renderNormal.magnitude() * scale;
  const base = P(node.renderOrigin);
  const tip = P(node.apex.renderOrigin);
  const axisLength = kind === 'cone' ? (node.length * r) / (node.diameter / 2) : r;
  if (!(r > 0) || !isRound(node, r, sub(tip, base), axisLength, P)) return undefined;
  if (kind === 'cone') {
    const ring = node.surfacePathCommands.map((c) => P(c.renderPoints[0]));
    return {
      color: look.fill,
      fill: { rings: [ring], solid: { kind: 'cone', base, tip, radius: r } },
    };
  }
  if (kind === 'hemisphere') {
    // The half disc Zdog draws: radius r, on the side the dome points to.
    const n = node.renderNormal;
    const turn = Math.atan2(n.y, n.x) - TAU / 4;
    const ring = [];
    for (let i = 0; i <= DOME_STEPS; i++) {
      const t = Math.PI + (Math.PI * i) / DOME_STEPS + turn;
      ring.push([round2(base[0] + r * Math.cos(t)), round2(base[1] + r * Math.sin(t)), base[2]]);
    }
    return {
      color: look.fill,
      fill: { rings: [ring], solid: { kind: 'hemisphere', base, tip, radius: r } },
    };
  }
  return undefined;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = (a) => Math.sqrt(dot3(a, a));

/**
 * Whether a round solid is round on screen: the two radii of its base (an
 * Ellipse) are `r` long, its axis is `axisLength` long, and all three are
 * perpendicular. Zdog draws the round surface as if they were; a scale that
 * differs between axes breaks this, and then the solid's true front cannot be
 * known from what Zdog draws.
 */
function isRound(ellipse, r, axis, axisLength, P) {
  const commands = ellipse.pathCommands;
  if (!Array.isArray(commands) || commands.length < 2 || !(axisLength > 0)) return false;
  const center = P(ellipse.renderOrigin);
  const u = sub(P(commands[0].renderPoints[0]), center); // local (0, -r)
  const v = sub(P(commands[1].endRenderPoint), center); // local (r, 0)
  const near = (a, b) => Math.abs(a - b) <= 0.01 * b + 0.05;
  const square = (a, b) => Math.abs(dot3(a, b)) <= 0.01 * len3(a) * len3(b) + 0.05;
  return (
    near(len3(u), r) &&
    near(len3(v), r) &&
    near(len3(axis), axisLength) &&
    square(u, v) &&
    square(u, axis) &&
    square(v, axis)
  );
}

function describeShape(shape, look, P, scale, solidFace) {
  const commands = shape.pathCommands;
  if (!Array.isArray(commands) || commands.length === 0) return undefined;
  const subpaths = [];
  let current;
  let prev;
  const bezier = (p0, p1, p2, p3) => {
    for (let i = 1; i <= CURVE_STEPS; i++) {
      const t = i / CURVE_STEPS;
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      current.push(
        P({
          x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
          y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
          z: a * p0.z + b * p1.z + c * p2.z + d * p3.z,
        }),
      );
    }
  };
  const lerp = (a, b, t) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  });
  for (const command of commands) {
    const pts = command.renderPoints;
    if (command.method === 'move' || !current) {
      current = [P(pts[0])];
      subpaths.push(current);
      prev = pts[0];
    } else if (command.method === 'line') {
      current.push(P(pts[0]));
      prev = pts[0];
    } else if (command.method === 'bezier') {
      bezier(prev, pts[0], pts[1], pts[2]);
      prev = pts[2];
    } else if (command.method === 'arc') {
      // As PathCommand.prototype.arc: control points 9/16 of the way to the corner.
      const from = command.previousPoint ?? prev;
      bezier(from, lerp(from, pts[0], 9 / 16), lerp(pts[1], pts[0], 9 / 16), pts[1]);
      prev = pts[1];
    } else {
      return undefined;
    }
  }
  // As Shape.prototype.renderPath: a two-point line is never closed.
  const twoPoints = commands.length === 2 && commands[1].method === 'line';
  const closed = !twoPoints && Boolean(shape.closed);
  const part = { color: look.fill ?? look.stroke };
  if (!part.color) return undefined;
  if (look.fill) {
    const rings = subpaths.filter((s) => s.length >= 3);
    if (rings.length) part.fill = { rings };
  }
  // The faces of solids (Box, the ends of Cylinder, the bases of Cone and
  // Hemisphere) are drawn without their edges when filled, as Zpup's are.
  if (look.stroke && !(solidFace && look.fill)) {
    const lines = subpaths.map((s, i) =>
      closed && i === subpaths.length - 1 && s.length > 1 ? [...s, s[0]] : s,
    );
    part.stroke = { radius: round2((look.width * scale) / 2), lines };
  }
  return part.fill || part.stroke ? part : undefined;
}

let text = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  text += chunk;
});
process.stdin.on('end', () => {
  let output;
  try {
    output = run(JSON.parse(text));
  } catch (error) {
    const name = error?.name ?? 'Error';
    output = { ok: false, error: `${name}: ${String(error?.message ?? error)}` };
  }
  process.stdout.write(JSON.stringify(output));
});
