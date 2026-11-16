/**
 * Puts the editor's text in the address, so a copied link opens the same
 * scene. The text is compressed with deflate and written as base64url after
 * `#s=`. An unchanged example is written as `#example=<name>` instead.
 */

/** Longest hash, in characters, that the page writes. Longer scenes are not shared by link. */
export const MAX_HASH_LENGTH = 8000;

/** What a hash describes. */
export type HashContent =
  | { kind: 'none' }
  | { kind: 'example'; name: string }
  | { kind: 'text'; text: string }
  | { kind: 'invalid'; reason: string };

/** The result of turning editor text into a hash. */
export type EncodedHash =
  | { ok: true; hash: string }
  | { ok: false; length: number; reason: string };

/** Encodes bytes as base64url, without padding. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Decodes base64url (padding optional). Throws on characters outside the alphabet. */
export function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url');
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream) {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Compresses text with raw deflate. */
export function deflate(text: string): Promise<Uint8Array> {
  return pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw'));
}

/** Reverses {@link deflate}. Rejects when the bytes are not valid deflate data. */
export async function inflate(bytes: Uint8Array): Promise<string> {
  const out = await pipe(bytes, new DecompressionStream('deflate-raw'));
  return new TextDecoder('utf-8', { fatal: true }).decode(out);
}

/** Size of `text` after gzip, in bytes, as a web server would send it. */
export async function gzipSize(text: string): Promise<number> {
  const out = await pipe(new TextEncoder().encode(text), new CompressionStream('gzip'));
  return out.length;
}

/**
 * Builds the hash for the editor's text, or explains why it is too long.
 * @param example The name of the example the text equals, if any.
 */
export async function encodeHash(text: string, example?: string): Promise<EncodedHash> {
  if (example !== undefined) return { ok: true, hash: `#example=${encodeURIComponent(example)}` };
  const hash = `#s=${toBase64Url(await deflate(text))}`;
  if (hash.length <= MAX_HASH_LENGTH) return { ok: true, hash };
  return {
    ok: false,
    length: hash.length,
    reason: `This scene is too large for a link: compressed, it takes ${formatBytes(hash.length)}, and links are kept under ${formatBytes(MAX_HASH_LENGTH)}. Copy the JSON instead.`,
  };
}

/** Reads a hash written by {@link encodeHash}. Never throws. */
export async function decodeHash(hash: string): Promise<HashContent> {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const example = params.get('example');
  if (example !== null) return { kind: 'example', name: example };
  const s = params.get('s');
  if (s === null) return { kind: 'none' };
  try {
    return { kind: 'text', text: await inflate(fromBase64Url(s)) };
  } catch {
    return { kind: 'invalid', reason: 'The scene in this link could not be read.' };
  }
}

/** Formats a byte count as "812 B" or "10.9 KB" (1 KB = 1000 bytes). */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  return `${(bytes / 1000).toFixed(1)} KB`;
}
