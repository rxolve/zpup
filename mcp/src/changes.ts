/**
 * Edits to a scene the server already has, so a model can move one shape
 * without sending the whole scene again. A change names a place with the same
 * path the errors use ("children[2].color") and says what to do there.
 */

export interface Change {
  op: 'set' | 'remove' | 'insert' | 'append' | 'copy';
  path: string;
  value?: unknown;
}

type Segment = string | number;
type Container = Record<string, unknown> | unknown[];

const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

/** Thrown with a message the model can act on. */
export class ChangeError extends Error {}

/**
 * Reads "children[2].color", "scene.children[2].color" or the JSON Pointer
 * form "/children/2/color" into its steps. With a root, "#roof.color" starts
 * at the shape whose id is "roof".
 */
export function parsePath(path: string, root?: unknown): Segment[] {
  const named = /^#([^.[\]/]+)(.*)$/.exec(path);
  if (named) {
    const id = named[1] as string;
    const found = findId(root, id, []);
    if (found.length === 0) throw new ChangeError(`no shape has the id "${id}"`);
    if (found.length > 1) {
      throw new ChangeError(
        `${found.length} shapes have the id "${id}" (${found.map(show).join(', ')}). Use one of those paths`,
      );
    }
    return [...(found[0] as Segment[]), ...parseSteps(named[2] as string, path)];
  }
  const segments = parseSteps(path, path);
  if (!path.startsWith('/') && segments[0] === 'scene') segments.shift();
  return segments;
}

/** Every place in the tree where a shape has this id. */
function findId(at: unknown, id: string, here: Segment[]): Segment[][] {
  if (!isContainer(at) || Array.isArray(at)) return [];
  const found: Segment[][] = at.id === id ? [here] : [];
  if (Array.isArray(at.children)) {
    for (const [i, child] of at.children.entries()) {
      found.push(...findId(child, id, [...here, 'children', i]));
    }
  }
  return found;
}

function parseSteps(path: string, whole: string): Segment[] {
  const segments: Segment[] = [];
  if (path.startsWith('/')) {
    for (const part of path.slice(1).split('/')) {
      const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
      segments.push(/^\d+$/.test(key) ? Number(key) : key);
    }
  } else {
    const pattern = /\[(\d+)\]|([^.[\]]+)/g;
    let consumed = 0;
    for (const m of path.matchAll(pattern)) {
      const between = path.slice(consumed, m.index);
      if (between !== '' && between !== '.') throw new ChangeError(`cannot read "${whole}"`);
      segments.push(m[1] !== undefined ? Number(m[1]) : (m[2] as string));
      consumed = m.index + m[0].length;
    }
    if (consumed !== path.length) throw new ChangeError(`cannot read "${whole}"`);
  }
  for (const s of segments) {
    if (typeof s === 'string' && UNSAFE.has(s)) throw new ChangeError(`"${s}" cannot be used`);
  }
  return segments;
}

function show(segments: readonly Segment[]): string {
  let out = '';
  for (const s of segments) out += typeof s === 'number' ? `[${s}]` : out ? `.${s}` : s;
  return out || 'scene';
}

const isContainer = (v: unknown): v is Container => typeof v === 'object' && v !== null;

function range(length: number): string {
  if (length === 0) return 'it is empty';
  return length === 1 ? 'it has 1 item, [0]' : `it has ${length} items, [0] to [${length - 1}]`;
}

/** One step down from `at`, or an error that says what is there instead. */
function step(at: unknown, segment: Segment, sofar: readonly Segment[]): unknown {
  const here = show(sofar);
  if (Array.isArray(at)) {
    if (typeof segment !== 'number') {
      throw new ChangeError(`"${here}" is a list, so it needs an index such as ${here}[0]`);
    }
    if (segment >= at.length) {
      throw new ChangeError(`nothing at "${show([...sofar, segment])}": ${range(at.length)}`);
    }
    return at[segment];
  }
  if (!isContainer(at)) throw new ChangeError(`"${here}" has nothing inside it`);
  if (typeof segment === 'number') {
    throw new ChangeError(`"${here}" is not a list, so it has no [${segment}]`);
  }
  if (!(segment in at)) throw new ChangeError(`nothing at "${show([...sofar, segment])}"`);
  return (at as Record<string, unknown>)[segment];
}

function walk(root: unknown, segments: readonly Segment[]): unknown {
  let at = root;
  for (const [i, s] of segments.entries()) at = step(at, s, segments.slice(0, i));
  return at;
}

function withoutIds(node: unknown): unknown {
  if (!isContainer(node) || Array.isArray(node)) return node;
  delete node.id;
  if (Array.isArray(node.children)) for (const child of node.children) withoutIds(child);
  return node;
}

function applyOne(root: Container, change: Change): void {
  const segments = parsePath(change.path, root);
  const needsValue = change.op !== 'remove' && change.op !== 'copy';
  if (needsValue && change.value === undefined) {
    throw new ChangeError(`"${change.op}" needs a value`);
  }

  if (change.op === 'append') {
    const last = segments[segments.length - 1];
    const parent = walk(root, segments.slice(0, -1));
    // Appending to a group that has no children yet makes the list.
    if (
      typeof last === 'string' &&
      isContainer(parent) &&
      !Array.isArray(parent) &&
      !(last in parent)
    ) {
      parent[last] = [change.value];
      return;
    }
    const target = walk(root, segments);
    if (!Array.isArray(target)) {
      throw new ChangeError(
        `"${show(segments)}" is not a list. Append to a list such as "children"`,
      );
    }
    target.push(change.value);
    return;
  }

  if (segments.length === 0) {
    throw new ChangeError('the path is the whole scene. Pass scene to replace it');
  }
  const last = segments[segments.length - 1] as Segment;
  const parentPath = segments.slice(0, -1);
  const parent = walk(root, parentPath);

  if (change.op === 'copy') {
    const source = step(parent, last, parentPath);
    if (!Array.isArray(parent) || !isContainer(source) || Array.isArray(source)) {
      throw new ChangeError(
        `copy needs a shape in a list, such as "children[2]" or "#tree". "${show(segments)}" is not one`,
      );
    }
    const overrides = change.value ?? {};
    if (!isContainer(overrides) || Array.isArray(overrides)) {
      throw new ChangeError(
        'the value of a copy is an object with what differs, such as { "id": "tree2", "translate": { "x": 40 } }',
      );
    }
    for (const key of Object.keys(overrides)) {
      if (UNSAFE.has(key)) throw new ChangeError(`"${key}" cannot be used`);
    }
    // The copy and what is inside it lose their ids, so each id still names one shape.
    const copy = withoutIds(structuredClone(source)) as Record<string, unknown>;
    parent.push(Object.assign(copy, structuredClone(overrides)));
    return;
  }

  if (change.op === 'insert') {
    if (!Array.isArray(parent) || typeof last !== 'number') {
      throw new ChangeError(
        'insert needs a place in a list, such as "children[2]" to put the value before item 2',
      );
    }
    if (last > parent.length) {
      throw new ChangeError(`cannot insert at "${show(segments)}": ${range(parent.length)}`);
    }
    parent.splice(last, 0, change.value);
    return;
  }

  if (change.op === 'remove') {
    step(parent, last, parentPath);
    if (Array.isArray(parent)) parent.splice(last as number, 1);
    else delete (parent as Record<string, unknown>)[last as string];
    return;
  }

  // set
  if (Array.isArray(parent)) {
    step(parent, last, parentPath);
    parent[last as number] = change.value;
    return;
  }
  if (!isContainer(parent)) throw new ChangeError(`"${show(parentPath)}" has nothing inside it`);
  if (typeof last === 'number') {
    throw new ChangeError(`"${show(parentPath)}" is not a list, so it has no [${last}]`);
  }
  (parent as Record<string, unknown>)[last] = change.value;
}

/**
 * Applies the changes in order to a copy of the scene and returns the copy.
 * Later changes see the earlier ones, so after a remove the items behind it
 * have moved down by one.
 */
export function applyChanges(scene: unknown, changes: readonly Change[]): unknown {
  const copy = structuredClone(scene) as Container;
  for (const [i, change] of changes.entries()) {
    try {
      applyOne(copy, change);
    } catch (e) {
      if (e instanceof ChangeError) throw new ChangeError(`changes[${i}]: ${e.message}.`);
      throw e;
    }
  }
  return copy;
}
