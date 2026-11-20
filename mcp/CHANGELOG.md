# Changelog

## 0.3.0

- `changes` takes `copy`: a copy of a shape is added to the list it is in, with the keys of `value` put over it, so a second tree or window does not have to be sent again.

## 0.2.0

- The server remembers the last valid scene. `render_scene`, `render_spin` and `check_scene` can leave `scene` out to use it again.
- `render_scene` and `render_spin` take `changes`: `set`, `remove`, `insert` and `append` at a path such as `children[2].color`, so a small fix does not need the whole scene again. If the result is not valid, nothing is changed.
- A path can start at a shape's `id`: `#roof.color`.
- New tool `get_scene` returns the remembered scene as JSON.

## 0.1.3

- `render_scene` says how much empty space is left on each side of the drawing and where it is cut off, so a picture can be centered without guessing.
- Uses `@zpup/core` 0.3.1, which paints flat shapes lying in one plane in tree order.

## 0.1.2

- Uses `@zpup/core` 0.3.0, which adds the `pyramid` solid for roofs and wedges.

## 0.1.1

- `render_spin` returns stills at even steps of the turn (`preview_frames`, default 4) in place of the first frame only, so a model can see what the animation shows.

## 0.1.0

First release: `get_reference`, `check_scene`, `render_scene` and `render_spin`.
