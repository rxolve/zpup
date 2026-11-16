/** One step of an issue's location: an object key or an array index. */
export type PathSegment = string | number;

/** One problem found in a scene description. */
export interface ValidationIssue {
  /** Where the problem is, as a JSON-style path such as `scene.children[0].stroke`. */
  path: string;
  /**
   * The same location as {@link path}, one key or index per entry, such as
   * `["scene", "children", 0, "stroke"]`. Unlike the string, it stays exact
   * for keys that contain dots or brackets.
   */
  pathSegments: PathSegment[];
  /** The `id` of the nearest node, when it has one. */
  nodeId?: string;
  /** What is allowed at this path. */
  expected: string;
  /** A short description of the value that was found. */
  received: string;
  /** A concrete suggestion for fixing the problem, when there is one. */
  hint?: string;
  /**
   * The message without the leading path and node id, for screens that show
   * the location separately.
   */
  detail: string;
  /**
   * The full, human-readable message: the path, the node id when there is
   * one, then {@link detail}.
   */
  message: string;
}

/** Writes path segments as a JSON-style path such as `scene.children[0].stroke`. */
export function formatPath(segments: readonly PathSegment[]): string {
  let out = '';
  for (const s of segments) {
    out += typeof s === 'number' ? `[${s}]` : out === '' ? s : `.${s}`;
  }
  return out;
}

/** Builds an issue, writing `path` and `message` from the parts. */
export function makeIssue(parts: {
  pathSegments: readonly PathSegment[];
  nodeId?: string | undefined;
  expected: string;
  received: string;
  hint?: string | undefined;
  detail: string;
}): ValidationIssue {
  const path = formatPath(parts.pathSegments);
  const where = parts.nodeId === undefined ? path : `${path} (in node "${parts.nodeId}")`;
  const issue: ValidationIssue = {
    path,
    pathSegments: [...parts.pathSegments],
    expected: parts.expected,
    received: parts.received,
    detail: parts.detail,
    message: `${where}: ${parts.detail}`,
  };
  if (parts.nodeId !== undefined) issue.nodeId = parts.nodeId;
  if (parts.hint !== undefined) issue.hint = parts.hint;
  return issue;
}

/**
 * Thrown when a scene description is invalid. The message lists every
 * problem; `issues` holds the same problems as structured data.
 */
export class ZpupValidationError extends Error {
  override readonly name = 'ZpupValidationError';
  readonly issues: readonly ValidationIssue[];

  /**
   * @param subject What was being checked, for the first line of the message.
   */
  constructor(issues: readonly ValidationIssue[], subject = 'zpup scene') {
    const count = issues.length === 1 ? '1 problem' : `${issues.length} problems`;
    super(`Invalid ${subject} (${count}):\n${issues.map((i) => `  - ${i.message}`).join('\n')}`);
    this.issues = issues;
  }
}

/** Describes a value briefly for an error message. */
export function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN';
    if (!Number.isFinite(value)) return String(value);
    return String(value);
  }
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'bigint') return `${value}n (a bigint)`;
  if (typeof value === 'symbol') return 'a symbol';
  let json: string;
  try {
    json = JSON.stringify(value) ?? String(value);
  } catch {
    json = Array.isArray(value) ? 'an array' : 'an object';
  }
  if (json.length > 60) json = `${json.slice(0, 57)}...`;
  if (Array.isArray(value)) return `an array ${json}`;
  return json;
}

/** Returns the closest candidate to `word`, if any is close enough to be a likely typo. */
export function closest(word: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  const lower = word.toLowerCase();
  for (const candidate of candidates) {
    const d = editDistance(lower, candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  const limit = Math.max(1, Math.floor(word.length / 3));
  return bestDistance <= limit ? best : undefined;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}
