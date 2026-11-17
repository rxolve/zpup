# Zdog 1.1

Zdog is a pseudo-3D engine: shapes are flat or thin, drawn with round strokes, and sorted by depth. This summary was written for the benchmark from Zdog's source and its documentation at https://zzz.dog/api.

## Setup

```js
const illo = new Zdog.Illustration({ element: '.zdog-svg', zoom: 1, rotate: { x: -0.4, y: 0.6 } });
new Zdog.Ellipse({ addTo: illo, diameter: 80, stroke: 20, color: '#636' });
illo.updateRenderGraph();
```

- The origin is the center of the element. x points right, y points down, z points toward the viewer.
- Angles are in radians. `Zdog.TAU` is a full turn (2π), so a quarter turn is `Zdog.TAU / 4`.
- Projection is orthographic: there is no perspective and no lighting. Shade by choosing colors.
- `zoom` on the illustration scales everything, strokes included.

## Options every item takes

- `addTo`: the parent (the illustration, or any other item). Required.
- `translate: { x, y, z }`: position relative to the parent. Missing axes are 0.
- `rotate: { x, y, z }`: rotation in radians about each axis.
- `scale`: a number, or `{ x, y, z }`. Scaling does not change stroke width.

## Options every shape takes

- `color`: a CSS color string. Default `'#333'`.
- `stroke`: the width of the line. Default 1. `false` or 0 draws no stroke.
- `fill`: whether the inside is filled. Default false.
- `closed`: whether the last point joins back to the first. Default true.
- `visible`: false hides the shape.
- `backface`: true (default) draws the shape from behind as well, false hides it when its back faces the viewer, and a color string draws the back in that color.

## Shapes

- `Zdog.Shape({ path })`: a path of points. Each entry is a point `{ x, y, z }` (a straight line to it), `{ line: { x, y, z } }`, `{ move: { x, y, z } }`, `{ arc: [corner, end] }` (a quarter ellipse through the corner point) or `{ bezier: [control1, control2, end] }`. Without a `path`, the shape is a single point at the origin; with a thick stroke that is a ball: `new Zdog.Shape({ addTo: illo, stroke: 80, color: '#e62' })` is a sphere 80 across. A path of two points with a thick stroke is a capsule.
- `Zdog.Rect({ width, height })`.
- `Zdog.RoundedRect({ width, height, cornerRadius })`.
- `Zdog.Ellipse({ diameter })` or `Zdog.Ellipse({ width, height })`. `quarters: 1` to `4` draws that many quarter arcs (default 4, the whole ellipse).
- `Zdog.Polygon({ radius, sides })`: a regular polygon.

These lie in the x/y plane of the item, facing +z. Rotate them to face another way.

## Solids

- `Zdog.Hemisphere({ diameter, color, backface })`: the dome bulges toward +z; `backface` is the color of the flat side.
- `Zdog.Cone({ diameter, length, color, backface })`: the base is at the origin and the tip is at z = `length`; `backface` is the color of the base.
- `Zdog.Cylinder({ diameter, length, color, frontFace, backface })`: centered on the origin, with its axis along z. `frontFace` is the color of the end at +z, `backface` of the end at -z.
- `Zdog.Box({ width, height, depth, color, frontFace, rearFace, leftFace, rightFace, topFace, bottomFace })`: centered on the origin. Each face option is a color, or false to leave the face out. Faces without their own color use `color`, so give faces different colors to shade the box.

Set `stroke: false` on solids for sharp edges. Rotate a solid with `rotate: { x: Zdog.TAU / 4 }` to point its axis up or down.

## Grouping

- `Zdog.Anchor({ addTo, translate, rotate, scale })`: an invisible item. Children added to it move and turn with it.
- `Zdog.Group({ addTo, ... })`: like an Anchor, but its children are drawn together as one layer in the order they were added, and the group is sorted against other items as a whole. Use it to keep details on top of the shape they belong to. `updateSort: true` sorts the children inside it by depth.
- `item.copy({ ...options })` makes a copy of one item with some options changed. `item.copyGraph({ ...options })` also copies its children.

## Depth sorting

Each shape is sorted by the depth of a single point (the center of its path points), after rotation. A large shape and a small shape near it can therefore be drawn in the wrong order; a Group fixes the order by hand.
