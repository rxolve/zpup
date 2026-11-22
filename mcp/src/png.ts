import { Resvg, type ResvgRenderOptions } from '@resvg/resvg-js';

export interface PngOptions {
  /** Length of the longer side in pixels. */
  size: number;
  /**
   * Paints white behind the picture. A scene without a background is
   * transparent, which a model viewing the PNG may see as black.
   */
  backdrop: boolean;
}

// A Zpup picture has no text, and loading the system's fonts takes a quarter
// of a second per picture.
const NO_FONTS: ResvgRenderOptions = { font: { loadSystemFonts: false } };

/** Draws a still Zpup SVG as a PNG. Animation in the SVG is ignored: the first frame is drawn. */
export function svgToPng(svg: string, options: PngOptions): Buffer {
  const probe = new Resvg(svg, NO_FONTS);
  const wide = probe.width >= probe.height;
  const drawn = new Resvg(svg, {
    ...NO_FONTS,
    fitTo: wide ? { mode: 'width', value: options.size } : { mode: 'height', value: options.size },
    ...(options.backdrop ? { background: '#ffffff' } : {}),
  });
  return drawn.render().asPng();
}

/** Draws an SVG as a PNG at the size it gives, with nothing painted behind it. */
export function svgToExactPng(svg: string): Buffer {
  return new Resvg(svg, NO_FONTS).render().asPng();
}
