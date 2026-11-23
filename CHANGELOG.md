# Changelog

## Unreleased (1.0.0)

The scene format and the exported functions are now stable. Nothing in the format changed since 0.5.0: a scene that was valid there is valid here and draws the same.

- [docs/decisions.md](docs/decisions.md) says what 1.x keeps (the format, every option's meaning and default, the exported functions, the fields of an issue and of a `Frame`) and what may still get better (depth sorting, shading, the turning animation, the wording of messages), and no decision in it is left open.
- The type `SoftKind`, which `DotItem` and `PathItem` already used, is exported.
- Checked: a turning SVG with soft shading switches the outlines of a tilted round side one at a time in Chromium, WebKit and Firefox.

## 0.5.0

Added

- Open solids. A face option set to `false` (`"frontFace": false`, `"topFace": false`, `"backface": false`) leaves that face out, on every solid. The other faces are then thin walls seen from both sides: the inside shows through the opening, and shapes placed inside are drawn in front of the far wall and behind the near one. This gives a cup with pencils in it, an open box, a bowl and a tube you can see through. `inside` sets the color of the inside; without it, a darker `color` is used.

Changed

- `false` on a face option of a solid was an error ("faces cannot be left out") and is now accepted. `true` is still an error. Closed solids are drawn exactly as before.

## 0.4.1

Fixed

- A turning SVG with many shapes no longer stops in Firefox. The groups that are not on screen are now hidden with `display` where they used `visibility`; Firefox went on animating everything inside an invisible group, and a soft-shaded scene of about twenty shapes drew no frame at all. The pictures are the same in every browser.

## 0.4.0

Added

- `tipDiameter` on a `cone` cuts its tip off and is the diameter of that end: a lamp shade, a plant pot, a cup. It may be larger than `diameter`. The far end takes `frontFace`, as a cylinder's does. A node of type `frustum` is answered with this.

Changed

- With `shading: "soft"`, a ball's edge that faces the light stays near its own color and only the far edge goes dark. The whole rim used to be darkened, so a ball a few pixels wide showed as a dark ring around its color. Pictures with soft balls and domes come out a little lighter.
- `frontFace` on a cone that ends in a point is answered with what it needs (`tipDiameter`), where it used to be an unknown option.

## 0.3.1

Fixed

- Two filled flat shapes lying in one plane, such as a road on a lawn, are now painted in tree order at every view angle: the later one on top. Before, the earlier one covered the later one when neither had a stroke, and with strokes the order changed with the view.

Changed

- `translate` or `scale` on the scene is answered with what to use in its place.
- `llms.txt` says which way a round solid points when laid on its side, how far in front of a wall to put a door, and that the scene itself cannot be moved.

## 0.3.0

Added

- `pyramid`: a solid on a rectangular base with its top straight above the middle. It stands upright with no rotation. `ridge` makes the top an edge along x: as long as the width it is a gable roof or a wedge, shorter a hip roof.
- The types `wedge`, `prism` and `roof` are answered with how to write them as a pyramid.

## 0.2.1

Documentation only.

- `llms.txt` says where a `cylinder`, `cone` and `hemisphere` end up once they are stood upright, with an example of stacking them.
- The README states the bundle size and that there is no text shape and no clipping.

## 0.2.0

Added

- `dot`: a ball at a point, with `stroke` as its diameter.
- `shading: "soft"` on the scene: dots and the round surfaces of solids get a gradient, and thick lines are drawn as tubes, as if lit from the upper left. It works in still and turning pictures.
- `checkSceneWarnings` reports shapes of different colors that pass through each other, with the area that ends up in the wrong order and the view angle where it shows most.

Fixed

- Depth sorting around solids. The side of a cylinder is now only its visible part, so it no longer paints over a post standing inside a ring. Two solids that a flat face separates are ordered by that face. When no order is right, the one that hides the least area is chosen.
- Soft tubes and tilted round sides now turn in Safari.

Changed

- The name is written Zpup in prose and in error messages (`Invalid Zpup scene`). The package name, identifiers and URLs are unchanged.

## 0.1.0

The first release: scene tree, transforms, orthographic projection, depth sorting, `renderSvg`, `renderSpinSvg`, validation with hints, and the solids `box`, `cylinder`, `cone` and `hemisphere`.
