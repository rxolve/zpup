# Changelog

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
