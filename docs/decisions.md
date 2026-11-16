# Design decisions

Short notes on the choices where there was a real fork in the road. Each has a status: **settled** (follows from the project goals) or **open** (a default was picked; easy to revisit before 1.0).

## Scene format

**The scene is a plain JSON tree; helpers are optional sugar.** (settled)
`group()`, `ellipse()` and friends only add a `type` field. Nothing is a class instance, so scenes can be generated, diffed, stored and sent over the wire. This is what "AI-friendly" means in practice.

**Vectors are objects with optional keys, not arrays.** (open)
`{ x: 10 }` is self-describing and partial; `[10, 0, 0]` is shorter but easy to get wrong. Accepting only one form keeps validation and error messages simple.

**Unknown options are errors.** (settled)
A typo such as `colour` fails with a "did you mean" hint instead of being silently ignored. All problems in a scene are reported at once.

**Any node may have children.** (open)
A shape can carry children (eyes on a head) without a wrapping group. `group` is a node that draws nothing.

**`path` is open by default; `rect`, `ellipse` and `polygon` are closed.** (open)
Zdog closes paths by default. Open reads more naturally for "a line from A to B".

**Colors are validated CSS color strings.** (settled)
Hex, functional notation, and named colors pass; anything else is rejected, and all text is escaped on output, so a scene from an untrusted source cannot inject markup.

## Coordinates and rotation

**x right, y down, z toward the viewer.** (settled)
x and y match SVG, CSS and Zdog, so numbers mean the same thing as in the tools designers already use, and "larger z is closer" is easy to remember. The system is left-handed as a result.

**Angles are in degrees.** (open)
`90` is exact and readable in JSON; `1.5707963` is neither. Zdog uses radians. Multiples of 90 degrees produce exact results.

**Rotation order: z, then y, then x.** (open)
The same order Zdog uses, so a view rotation of `{ x: -20, y: 30 }` spins the scene about its vertical axis and then tilts it, which is the turntable behavior people expect. Positive `z` is clockwise on screen, like CSS `rotate()`.

**Node transform order: scale, rotate, translate.** (settled)
The conventional order; children inherit the composed transform.

**Stroke width scales with the node.** (open)
The factor is the cube root of the transform's determinant: exactly `s` for a uniform scale `s`, and a sensible average for non-uniform scale. Scene `zoom` scales strokes too.

## Projection

**Orthographic only; no perspective and no lighting.** (settled)
These are what would turn zpup into a weaker three.js. Orthographic projection is also affine, which keeps Bezier curves and ellipses exact after projection.

## Depth sorting

**Compare overlapping shapes where they overlap, then sort topologically.** (settled in approach, open in details)
Zdog sorts by one center point per shape, which flips the order of shapes that overlap away from their centers. zpup instead:

1. Flattens each shape to line segments in screen space.
2. For each pair whose screen bounds overlap, samples points that both shapes cover (outline points, crossings, and the middle of the overlap between nearby strokes) and compares surface depth there.
3. Topologically sorts the resulting "paint before" constraints. Unconstrained shapes fall back to mean depth, then tree order. Cycles are broken at the shape with the lowest mean depth.

Depth model: a round stroke is a tube and a single point is a sphere, so their surfaces bulge toward the viewer by the stroke radius; a filled area is a flat sheet at its plane. This lets a line or dot sit on a coplanar filled shape and still win.

**Unfilled outlines are sorted per segment.** (open)
Each line segment (and each half of a Bezier segment) is sorted on its own, and consecutive pieces that end up adjacent are joined back into one path. This lets a ring pass behind and in front of a sphere. The cost is that an outline can be emitted as several paths, which shows as darker joints if the color is translucent.

**Known limits.** Filled shapes are never split, so shapes that intersect or weave through each other cannot be drawn correctly. The pairwise step is O(n²) in the number of pieces; fine for illustrations, not for thousands of shapes.

## Rendering

**Core produces a `Frame`; renderers only paint it.** (settled)
`compileScene` returns projected, sorted 2D draw items. The SVG renderer is a small function over that list, and a canvas renderer can reuse it unchanged.

**SVG output is deterministic.** (settled)
Coordinates are rounded to a fixed precision (default 2), negative zero is never printed, and nothing depends on time, randomness or the environment, so output is safe for snapshot tests and server rendering.

**Dots are emitted as `<circle>`.** (settled)
Zero-length stroked paths render inconsistently across SVG renderers.

**Node ids are not emitted into the SVG.** (open)
Ids would collide when several images share a page. A `data-` attribute or class hook can be added when animation needs it.

## Tooling

- **pnpm**: already installed here and runs cleanly on the local Node version, where npm prints an unsupported-engine warning.
- **tsc only, no bundler**: the library is a handful of ESM files; `tsc` emits JavaScript and `.d.ts` directly.
- **Biome** for lint and format: one dev dependency instead of ESLint plus Prettier.
- **Vitest** for tests.
- Source imports use `.ts` extensions (rewritten to `.js` on build) so Node can run the examples without a build step.
