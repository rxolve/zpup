/**
 * Fixed face shading for solids. There is no light and nothing depends on the
 * view: a face's shade comes only from the direction it points in the scene,
 * so it stays the same while the view turns.
 */
import type { Vec3 } from './math.ts';

interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** CSS named colors as six hex digits. */
const NAMED =
  'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,' +
  'bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,' +
  'burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,' +
  'cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,' +
  'darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,' +
  'darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,' +
  'darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,' +
  'darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,' +
  'deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,' +
  'firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,' +
  'ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,' +
  'grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,' +
  'khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,' +
  'lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,' +
  'lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,' +
  'lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,' +
  'lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,' +
  'magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,' +
  'mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,' +
  'mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,' +
  'mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,' +
  'olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,' +
  'palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,' +
  'peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,' +
  'rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,' +
  'salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,' +
  'skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,' +
  'springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,' +
  'turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,' +
  'yellowgreen:9acd32';

let namedColors: Map<string, string> | undefined;

function named(name: string): string | undefined {
  namedColors ??= new Map(NAMED.split(',').map((pair) => pair.split(':') as [string, string]));
  return namedColors.get(name);
}

/**
 * Parses hex, `rgb()`/`rgba()`, `hsl()`/`hsla()` and named colors. Returns
 * undefined for anything else (`currentColor`, `oklch()` and so on), which
 * zpup draws but cannot shade.
 */
export function parseColor(input: string): Rgba | undefined {
  const text = input.trim().toLowerCase();
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)?.[1] ?? named(text);
  if (hex !== undefined) {
    const full =
      hex.length <= 4
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    if (full.length !== 6 && full.length !== 8) return undefined;
    const byte = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
    return { r: byte(0), g: byte(2), b: byte(4), a: full.length === 8 ? byte(6) / 255 : 1 };
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(text);
  if (!fn) return undefined;
  const parts = (fn[2] as string)
    .replace(/\s*\/\s*/, ' / ')
    .split(/\s*,\s*|\s+/)
    .filter((p) => p !== '' && p !== '/');
  if (parts.length !== 3 && parts.length !== 4) return undefined;
  const value = (p: string, scale: number) => {
    const n = Number.parseFloat(p);
    if (!Number.isFinite(n)) return Number.NaN;
    return p.endsWith('%') ? (n / 100) * scale : n;
  };
  const alpha = parts[3] === undefined ? 1 : value(parts[3], 1);
  let rgb: [number, number, number];
  if ((fn[1] as string).startsWith('rgb')) {
    rgb = [
      value(parts[0] as string, 255),
      value(parts[1] as string, 255),
      value(parts[2] as string, 255),
    ];
  } else {
    const h = Number.parseFloat(parts[0] as string);
    const s = value(parts[1] as string, 1);
    const l = value(parts[2] as string, 1);
    rgb = hslToRgb(((h % 360) + 360) % 360, clamp(s, 0, 1), clamp(l, 0, 1));
  }
  if (![...rgb, alpha].every(Number.isFinite)) return undefined;
  return {
    r: clamp(rgb[0], 0, 255),
    g: clamp(rgb[1], 0, 255),
    b: clamp(rgb[2], 0, 255),
    a: clamp(alpha, 0, 1),
  };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * How much lighter (positive) or darker (negative) a face pointing along the
 * unit normal `n` is drawn, as a fraction of the way to white or black.
 * Directions are in scene space (y down). Up is lightest and down darkest;
 * left is lighter and right darker, in proportion, so the two sides that show
 * when a box is turned by any angle about the vertical axis always differ.
 * Front and back get 0; they are never seen at the same time.
 */
export function shadeAmount(n: Vec3): number {
  return MAX_LIGHTER * Math.max(0, -n.y) - MAX_DARKER * Math.max(0, n.y) - 0.12 * n.x;
}

/** The shade of a face pointing straight up. */
const MAX_LIGHTER = 0.25;
/** The shade of a face pointing straight down, negated. */
const MAX_DARKER = 0.3;

/**
 * The color of a face of a solid whose base color is `color` and that points
 * along the scene-space unit normal `n`. Returns `color` unchanged when it
 * cannot be parsed.
 *
 * Near-white colors cannot get lighter and near-black ones cannot get darker,
 * so for them the range of shades is moved and narrowed: the top of a white
 * box stays white and the other faces get darker in smaller steps.
 */
export function shadeColor(color: string, n: Vec3): string {
  const c = parseColor(color);
  if (!c) return color;
  const luminance = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  const light = smoothstep(0.72, 0.95, luminance);
  const dark = smoothstep(0.28, 0.05, luminance);
  const base = shadeAmount(n);
  // Near white, the top keeps the color and the rest get darker in half
  // steps; near black, the bottom keeps it and the rest get lighter.
  const amount =
    base * (1 - light - dark) +
    (base - MAX_LIGHTER) * 0.5 * light +
    (base + MAX_DARKER) * 0.6 * dark;
  const mix = (v: number) => Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
  const hex = (v: number) => v.toString(16).padStart(2, '0');
  const out = `#${hex(mix(c.r))}${hex(mix(c.g))}${hex(mix(c.b))}`;
  return c.a < 1 ? `${out}${hex(Math.round(c.a * 255))}` : out;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
