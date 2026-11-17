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
  return result;
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
