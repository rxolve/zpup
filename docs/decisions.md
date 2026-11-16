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
2. For each pair whose screen bounds overlap, samples points that both shapes cover (outline points, crossings, the middle of the overlap between nearby strokes, and, where a round stroke reaches over the edge of a filled area, a point inside that area) and compares surface depth there.
3. Topologically sorts the resulting "paint before" constraints. Unconstrained shapes fall back to mean depth, then tree order. Cycles are broken at the shape with the lowest mean depth.

Depth model: a round stroke is a tube and a single point is a sphere, so their surfaces bulge toward the viewer by the stroke radius; a filled area is a flat sheet at its plane. This lets a line or dot sit on a coplanar filled shape and still win.

**Sample points must lie inside the overlap, not on an edge.** (settled)
A point on a filled area's outline is inside or outside it depending on rounding. A dot whose center sat just outside a filled area was once compared only at such points, so as the view turned the answer alternated between "dot in front" and "unclear", and "unclear" fell back to mean depth. In the turning pup this flipped the shadow over the paws 330 times per turn, mostly for half a degree at a time. The extra sample inside the area fixed it: over a full turn in half-degree steps, flips between overlapping pieces went from 370 to 40, every one of them a real change of sides, and a dense grid of depth samples agrees with every answer.

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

## Turning animation

**`renderSpinSvg` animates geometry with SMIL and switches paint order in epochs.** (open in details)
The goal is a 3D illustration that moves inside a GitHub README, where scripts and CSS in SVG files are stripped or ignored but SMIL plays. How it works:

1. Every piece (a filled shape, a dot, or one segment of an outline) is defined once in `<defs>`. Its `d` (or `cx` and `cy` for a dot) is animated through keyframes at evenly spaced angles, 36 by default. Orthographic projection is affine, so a piece has the same path commands at every angle and only the numbers change; the browser interpolates linearly between keyframes.
2. SVG cannot animate paint order. The turn is checked every half degree: at each step the still renderer's depth sort gives an order, and every pair of pieces that overlap on screen yields a "paint before" constraint. The turn is then cut into epochs, each with one order that satisfies every constraint for its whole length. Each epoch is a group of `<use>` elements whose `visibility` is switched with a discrete animation.
3. An order is kept for as long as it stays valid. When it breaks, the next order is the one that satisfies as many upcoming steps as possible at once (the longest stretch whose combined constraints have no cycle), and among those the closest to the previous order. Taking the longest stretch each time gives the fewest epochs for the given steps.
4. The first epoch uses the still renderer's order, and every element's attributes hold the first keyframe, so a renderer without SMIL shows the same picture as `renderSvg`.

Ids carry a four-character hash of the content, so two different animations inlined in one HTML page do not use each other's shapes.

**Measurements for the pup** (19 pieces, 240 by 240):

| Approach                                          | Epochs or frames | Bytes   | Gzipped |
| ------------------------------------------------- | ---------------- | ------- | ------- |
| `renderSpinSvg`, 36 keyframes                     | 38 epochs        | 54,308  | 10,895  |
| Prototype: same idea, epochs with hysteresis only | 52 epochs        | 57,751  | 11,012  |
| Flipbook: 36 whole frames shown in turn           | 36 frames        | 76,656  | 12,167  |
| Flipbook: 60 whole frames                         | 60 frames        | 127,701 | 20,217  |
| Still picture (`renderSvg`)                       | 1                | 2,290   | 864     |

A flipbook also jumps from frame to frame, while the keyframed version moves smoothly. Before the depth-sorting fix above, the prototype needed 55 epochs and a filter that ignored order changes lasting under 4 degrees. In a check of the prototype, the animation paused at 16 moments matched the still renderer at the same angles, with at most 0.006% of pixels clearly different. It plays inside `<img>` in Chromium.

**Limits.** Only a constant turn about one axis; nothing else moves and there is no interaction. SMIL cannot read `prefers-reduced-motion`, so the page embedding the image has to offer the still picture. Outlines are drawn per segment, so translucent colors show seams. File size grows with pieces times epochs, and epochs grow with overlapping pairs, so large scenes get big fast. Planning compiles and depth-sorts the scene at 720 angles, which takes about 150 ms for the pup.

**Possible size reduction, not done.** The `<use>` lists are about a quarter of the file (722 references for the pup). Adjacent epochs usually differ by one swapped pair, so one sequence of references that contains every epoch's order as a subsequence (a common supersequence) would need only about 75 references for the pup. Each reference that is not always visible would then need its own visibility animation, roughly 100 bytes each, so the raw saving would be around 6 KB and the gzipped saving smaller, since the repeated lists compress well. Not worth the extra complexity yet.

## Tooling

- **pnpm**: already installed here and runs cleanly on the local Node version, where npm prints an unsupported-engine warning.
- **tsc only, no bundler**: the library is a handful of ESM files; `tsc` emits JavaScript and `.d.ts` directly.
- **Biome** for lint and format: one dev dependency instead of ESLint plus Prettier.
- **Vitest** for tests.
- Source imports use `.ts` extensions (rewritten to `.js` on build) so Node can run the examples without a build step.
