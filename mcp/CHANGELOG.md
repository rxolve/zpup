# Changelog

## Unreleased

- `render_sprites` takes `poses`: lists of changes, each a pose of the scene. The sheet then has one row per direction and one column per pose, for a walk cycle or any other motion in steps. Frames are named `<name>-<direction>-<pose>.png` and carry `pose`, and the frame list has `animations` with the frames of each direction in order. Poses are applied to the scene one at a time and are not remembered. Up to 16 poses and 128 cells.
- `render_sprites` takes `fit`: the frame is set from the drawing, so that it fills the cell in the direction and pose where it reaches furthest, with nothing cut off. Every cell still shows the same part of the scene.
- `render_sprites` takes `preview_direction`: one direction is sent back as a second, larger picture, its poses side by side.
- The frame list has `meta.origin`, where the middle of the scene is in a cell.
- `render_scene` takes `pose`: changes that are drawn but not remembered, to look at one pose from several angles.

## 0.4.0

- New tool `render_sprites`: one scene drawn from 2 to 32 directions, turned in equal steps about its vertical axis, as one transparent PNG sprite sheet. With `save_to` it writes the frame list next to the PNG as JSON, in TexturePacker's hash form. The answer says when the object is cut off in some directions.
- Uses `@zpup/core` 0.5.0, so `get_reference` describes open solids (a face option set to `false`).

## 0.3.1

- Uses `@zpup/core` 0.4.1, so a file from `render_spin` with many shapes no longer stops in Firefox.

## 0.3.0

- `changes` takes `copy`: a copy of a shape is added to the list it is in, with the keys of `value` put over it, so a second tree or window does not have to be sent again.
- Uses `@zpup/core` 0.4.0, which adds `tipDiameter` on a `cone` and stops small balls under soft shading from showing a dark ring.

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
