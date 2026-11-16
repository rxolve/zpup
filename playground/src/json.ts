/**
 * JSON helpers for the editor: a compact formatter, and a scanner that finds
 * where each value sits in the text and where a syntax error is. Values
 * themselves are always read with `JSON.parse`; the scanner only adds
 * positions.
 */

/** A range of characters in the text, `[start, end)`. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** A location in the JSON: object keys and array indices, starting with `"scene"`. */
export type JsonPath = readonly (string | number)[];

/** The map key for a path; paths are arrays, which maps compare by identity. */
export function pathKey(path: JsonPath): string {
  return JSON.stringify(path);
}

/** What {@link scanJson} found. */
export interface JsonScan {
  /** Span of each value, keyed by {@link pathKey}. */
  readonly values: Map<string, Span>;
  /** Span of each object property, from its key to the end of its value, keyed by {@link pathKey}. */
  readonly properties: Map<string, Span>;
  /** The first syntax error, if any. */
  readonly error?: { readonly offset: number; readonly message: string };
}

/**
 * Formats a JSON value with two-space indentation, keeping any object or
 * array on one line when it fits within `width` characters (76, so a line
 * fits the editor), so that points such as `{ "x": 4, "y": 2 }`
 * do not take four lines each.
 */
export function formatJson(value: unknown, width = 76): string {
  return `${format(value, '', width)}\n`;
}

/** `lead` is how many characters precede the value on its first line (such as a key). */
function format(value: unknown, indent: string, width: number, lead = 0): string {
  const flat = inline(value);
  if (flat === undefined) return 'null';
  if (value === null || typeof value !== 'object') return flat;
  if (indent.length + lead + flat.length <= width) return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => inner + format(v, inner, width));
    return `[\n${items.join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => inline(v) !== undefined);
  if (entries.length === 0) return '{}';
  const items = entries.map(([k, v]) => {
    const key = `${JSON.stringify(k)}: `;
    return inner + key + format(v, inner, width, key.length);
  });
  return `{\n${items.join(',\n')}\n${indent}}`;
}

/** One-line form with spaces inside braces, or undefined for values JSON leaves out. */
function inline(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') {
    const json = JSON.stringify(value);
    return json === undefined ? undefined : json;
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => inline(v) ?? 'null').join(', ')}]`;
  }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    const s = inline(v);
    if (s !== undefined) parts.push(`${JSON.stringify(k)}: ${s}`);
  }
  return parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`;
}

/**
 * Walks JSON text, recording where each value and property is, and stops at
 * the first syntax error. Paths start with `"scene"`, as in the
 * `pathSegments` of zpup's issues.
 */
export function scanJson(text: string): JsonScan {
  const values = new Map<string, Span>();
  const properties = new Map<string, Span>();
  let i = 0;

  class SyntaxProblem {
    readonly offset: number;
    readonly message: string;
    constructor(offset: number, message: string) {
      this.offset = offset;
      this.message = message;
    }
  }
  const fail = (message: string, at = i): never => {
    throw new SyntaxProblem(at, message);
  };
  const describeAt = (at: number) => (at >= text.length ? 'the end of the text' : `"${text[at]}"`);
  const space = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i] as string)) i++;
  };

  const string = (): string => {
    const start = i;
    i++; // opening quote
    while (i < text.length) {
      const ch = text[i] as string;
      if (ch === '"') {
        i++;
        return JSON.parse(text.slice(start, i)) as string;
      }
      if (ch === '\\') {
        const next = text[i + 1];
        if (next === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6)))
            fail('Bad \\u escape in a string');
          i += 6;
        } else if (next !== undefined && '"\\/bfnrt'.includes(next)) {
          i += 2;
        } else {
          fail('Bad escape in a string');
        }
        continue;
      }
      if (ch < ' ') fail('A line break or control character inside a string; strings end with "');
      i++;
    }
    return fail('A string is not closed with "', start);
  };

  const number = () => {
    const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!match) fail(`Unexpected ${describeAt(i)}`);
    i += (match as RegExpExecArray)[0].length;
  };

  const value = (path: JsonPath) => {
    space();
    const start = i;
    const ch = text[i];
    if (ch === '{') object(path);
    else if (ch === '[') array(path);
    else if (ch === '"') string();
    else if (ch === '-' || (ch !== undefined && ch >= '0' && ch <= '9')) number();
    else {
      const word = /^(true|false|null)/.exec(text.slice(i));
      if (word) i += word[0].length;
      else if (ch === "'") fail('JSON strings use double quotes (")');
      else if (ch === undefined) fail('Expected a value, found the end of the text');
      else fail(`Expected a value, found ${describeAt(i)}`);
    }
    values.set(pathKey(path), { start, end: i });
  };

  const object = (path: JsonPath) => {
    i++; // {
    space();
    if (text[i] === '}') {
      i++;
      return;
    }
    for (;;) {
      space();
      const keyStart = i;
      if (text[i] !== '"') {
        if (text[i] === '}') fail('A comma before "}" is not allowed in JSON');
        fail(`Expected a property name in double quotes, found ${describeAt(i)}`);
      }
      const key = string();
      space();
      if (text[i] !== ':') fail(`Expected ":" after the property name, found ${describeAt(i)}`);
      i++;
      const childPath = [...path, key];
      value(childPath);
      properties.set(pathKey(childPath), { start: keyStart, end: i });
      space();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '}') {
        i++;
        return;
      }
      fail(`Expected "," or "}" after a property, found ${describeAt(i)}`);
    }
  };

  const array = (path: JsonPath) => {
    i++; // [
    space();
    if (text[i] === ']') {
      i++;
      return;
    }
    for (let index = 0; ; index++) {
      space();
      if (text[i] === ']') fail('A comma before "]" is not allowed in JSON');
      value([...path, index]);
      space();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === ']') {
        i++;
        return;
      }
      fail(`Expected "," or "]" after an item, found ${describeAt(i)}`);
    }
  };

  try {
    value(['scene']);
    space();
    if (i < text.length) fail(`Unexpected ${describeAt(i)} after the end of the scene`);
    return { values, properties };
  } catch (e) {
    if (e instanceof SyntaxProblem) {
      return { values, properties, error: { offset: e.offset, message: e.message } };
    }
    throw e;
  }
}

/**
 * Finds the text for an issue's `pathSegments`, such as
 * `["scene", "children", 0, "colour"]`. Prefers the whole property (key and
 * value), then the value, then the nearest enclosing path that exists, so an
 * issue about a missing option points at the node that lacks it.
 */
export function locate(scan: JsonScan, path: JsonPath): Span | undefined {
  for (let length = path.length; length > 0; length--) {
    const key = pathKey(path.slice(0, length));
    const found = scan.properties.get(key) ?? scan.values.get(key);
    if (found) return found;
  }
  return undefined;
}

/** 1-based line and column of an offset. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
}
