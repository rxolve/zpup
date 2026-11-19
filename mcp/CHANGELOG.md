# Changelog

## 0.1.3

- `render_scene` says how much empty space is left on each side of the drawing and where it is cut off, so a picture can be centered without guessing.
- Uses `@zpup/core` 0.3.1, which paints flat shapes lying in one plane in tree order.

## 0.1.2

- Uses `@zpup/core` 0.3.0, which adds the `pyramid` solid for roofs and wedges.

## 0.1.1

- `render_spin` returns stills at even steps of the turn (`preview_frames`, default 4) in place of the first frame only, so a model can see what the animation shows.

## 0.1.0

First release: `get_reference`, `check_scene`, `render_scene` and `render_spin`.
