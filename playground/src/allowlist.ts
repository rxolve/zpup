/**
 * The elements and attributes that `renderSvg` writes. The page parses each
 * picture and refuses any element or attribute not listed here before it
 * goes into the document, so even a bug in the library could not put a
 * script, an event handler or a link on the page. (zpup already validates
 * colors and escapes all text, so this is a second, independent check.)
 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  svg: ['xmlns', 'width', 'height', 'viewBox', 'role', 'aria-label'],
  title: [],
  rect: ['width', 'height', 'fill'],
  circle: ['cx', 'cy', 'r', 'fill'],
  path: ['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'],
};

/** Whether an element with this name and these attribute names may be shown. */
export function isAllowedSvgElement(name: string, attributes: readonly string[]): boolean {
  const allowed = Object.hasOwn(ALLOWED, name) ? ALLOWED[name] : undefined;
  return allowed !== undefined && attributes.every((a) => allowed.includes(a));
}

/**
 * Paint and geometry values must not reach outside the picture (`url(...)`)
 * or look like markup. The label is free text and is only ever read as text.
 */
export function isAllowedSvgValue(attribute: string, value: string): boolean {
  if (attribute === 'aria-label') return true;
  return !/url\s*\(|[<>]|javascript:/i.test(value);
}
