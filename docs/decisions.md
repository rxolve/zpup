# Design decisions

Short notes on the choices where there was a real fork in the road. Each has a status: **settled** (follows from the project goals) or **open** (a default was picked; easy to revisit before 1.0).

## Scene format

**The scene is a plain JSON tree; helpers are optional sugar.** (settled)
`group()`, `ellipse()` and friends only add a `type` field, as the first key, so their output serialized as JSON reads like a hand-written scene. Nothing is a class instance, so scenes can be generated, diffed, stored and sent over the wire. This is what "AI-friendly" means in practice.

**Vectors are objects with optional keys, not arrays.** (open)
`{ x: 10 }` is self-describing and partial; `[10, 0, 0]` is shorter but easy to get wrong. Accepting only one form keeps validation and error messages simple.

**Unknown options are errors.** (settled)
A typo such as `colour` fails with a "did you mean" hint instead of being silently ignored. All problems in a scene are reported at once.

**Any node may have children.** (open)
A shape can carry children (eyes on a head) without a wrapping group. `group` is a node that draws nothing.

**`path` is open by default; `rect`, `ellipse` and `polygon` are closed.** (open)
Zdog closes paths by default. Open reads more naturally for "a line from A to B".

**Colors are validated CSS color strings.** (settled)
Hex, functional notation, and named colors pass; anything else is rejected, and all text is escaped on output, so a scene from an untrusted source cannot inject markup. A bare word must be one of the 148 CSS color names, `transparent` or `currentColor` (in any case); `"blu"` is an error with "Did you mean "blue"?", where it used to pass and draw in the browser's default color. The names are the table the solid shading already needed, so checking them added about 1 KB (0.35 KB gzipped) of code.

**Issues carry their path as segments and their message without it.** (settled)
`path` (`scene.children[0].stroke`) and `message` (path, node id, then the text) are for people. `pathSegments` (`["scene", "children", 0, "stroke"]`) and `detail` (the text alone) are for tools that show the location on their own, such as the playground; the string form cannot be split back reliably when a key contains a dot or a bracket.

**Option errors are validation errors.** (settled)
`renderSvg`, `frameToSvg` and `renderSpinSvg` all report bad or unknown options as `ZpupValidationError` issues with paths such as `options.precision`, together with any scene problems, rather than as `RangeError`. One error type means one `catch` for everything a caller passed in.

**A node with the wrong type is still checked.** (open)
When the intended type is clear (`circle`, a typo such as `cilinder`, `cube`), the other options are checked as that type, but options it requires are not demanded, since they may have been meant under other names. When the node has to be written differently (`sphere`, `line`, `triangle`), only the options every node shares are checked, and the hint shows what to write. Either way one round of fixes should be enough, which matters for a language model repairing its own output.

**Warnings are a separate function.** (open)
`checkSceneWarnings` reports what is valid but probably unintended: angles that look like radians, shapes entirely outside the image (the usual sign of top-left coordinates), a scene that draws nothing, solids whose color cannot be shaded, and shapes of different colors that pass through each other. A severity field on `checkScene`'s issues would have broken every caller that reads "no issues" as "valid", including the benchmark's checker. The warnings use the same issue fields and message form. They are conservative: whole numbers never count as radians (`90`, `5`, `0`), one small angle on its own only counts when it is close to a common radian value such as π/4, and a shape only counts as off-screen when no part of it, stroke included, is inside the image.

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

## Solids

**`box`, `cylinder`, `cone` and `hemisphere`, with Zdog's conventions.** (open)
Option names follow the flat shapes (`diameter`, `width`, `height`, `color`, `stroke`) and Zdog (`length`, `frontFace`, `backface`, `rearFace`, `topFace` and so on), since language models write Zdog habits. Round solids point along local z, as in Zdog: a cylinder is centered with its `frontFace` at +z, a cone and a hemisphere have their flat side at z = 0 and point toward +z. `rotate: { x: 90 }` stands any of them up. Solids are always filled; `fill: false` and face options set to `false` (Zdog's way of leaving a face out) are rejected, because an open solid would show its inside, which Zpup does not draw.

**One color, fixed shades per face.** (open)
With no lighting, a box in one color is a flat hexagon. So each face gets a lighter or darker version of `color` chosen by the direction the face points in the scene (after the node's own transforms, before the view): up is 25% toward white, down 30% toward black, and left and right are lighter and darker in proportion to how far they face sideways (up to 12%), so the two sides a box shows at any turn always differ. A round surface uses the direction perpendicular to its axis that faces most toward the front and slightly up, so an upright cylinder's side keeps `color` exactly and a cylinder pointing at the viewer gets a lighter side than its front end. This does not conflict with "no lighting": nothing depends on the view, a face keeps its color as the scene turns, and the result is the same as painting each face by hand. Near-white colors cannot get lighter and near-black ones cannot get darker, so for them the scale is moved and narrowed (the top of a white box stays white, the other faces get darker in half steps). Face options give a face an exact color, unshaded; `shade: false` paints every face in `color`. Colors that Zpup cannot parse (`currentColor`, `oklch()`) are drawn unshaded, with a warning.

**Faces turned away are left out of the still picture but kept in the animation.** (settled)
A solid is convex and closed, so its faces turned away from the viewer are always covered by its other faces. The still renderer drops them. The turning animation needs them, since they come into view, so it keeps them and requires only that they be painted before their own solid's other faces; wherever they are in the order otherwise, they are covered. This keeps them from adding paint-order changes.

**Round surfaces get their outline from the view.** (settled in approach)
A cylinder's side, a cone's side and a hemisphere's dome are not fixed outlines: their edge on screen is the contour where the surface turns away from the viewer. Each is built as one closed path from 3D points on the surface: the contour lines and the needed halves of the rims for a cylinder (commands `M L C C L C C Z`), the two lines from the rim to the tip and the far part of the rim for a cone (`M L L C C C C Z`), half of the rim and half of the sphere's contour circle for a hemisphere (`M C C C C Z`). The curves are arcs of circles in the solid's local space, so they stay exact under any transform, including non-uniform scale. The commands are the same at every view angle, which the turning animation needs. Where the choice of rim half switches (when an end is seen edge-on), both choices project to the same line, so the outline changes smoothly. The flat ends are ordinary fixed outlines drawn on top of the round surface.

When a cone's tip is inside its base on screen, there are no contour lines; the path runs to the tip and back along one line, which is covered by the same color. When the axis points straight at the viewer, the contour direction is undefined and a fixed fallback is used.

**Round outlines get extra keyframes where they need them.** (open)
The animation interpolates every coordinate in a straight line between keyframes. That is close for fixed 3D points (at most 0.38 pixels in the lighthouse with 36 keyframes) but not for an outline that is rebuilt from the view. So a round outline is checked at a quarter, half and three quarters of each interval, and the interval is split until the interpolated outline is within 0.5 pixels of the exact one (measured as the larger distance from any point of one outline to the other). Such a piece then gets its own `keyTimes`. Measured, with 36 keyframes and a full turn about y:

| Scene                                       | Before splitting | After | Extra keyframes |
| ------------------------------------------- | ---------------- | ----- | --------------- |
| Lighthouse (upright solids, 10 round faces) | 0.25 px          | same  | 0               |
| Cylinder along z, view tilted 20 degrees    | 1.3 px           | 0.48  | 8               |
| Cone along z, tilted 20 degrees             | 4.0 px           | 0.49  | 28              |
| Hemisphere along z, tilted 5 degrees        | 7.8 px           | 0.39  | 24              |

Upright solids on a turntable keep their outline, so they cost nothing. The worst case is an axis that passes exactly through the line of sight (no tilt): there the contour direction turns half a circle at once and the outline is rebuilt from the opposite side. Splitting confines that jump to 0.005 degrees, twice per turn, about 0.1 milliseconds each in an 8-second turn. In Chromium, frames paused around such a pass look right.

## Depth sorting of solids

**Faces of one solid are ordered by rule, not by depth.** (settled)
Comparing faces that share edges is a tie that flips back and forth as the view turns. Within a solid, the round surface is painted before the flat faces, which is always right for a convex solid (a visible flat end lies on top of the round surface next to it), and flat faces that both face the viewer only share edges, so their order does not matter and creates no constraint.

**Round surfaces have an exact depth.** (settled)
A plane fitted to a round surface's outline is wrong by up to its radius. Instead the line of sight through a screen point is followed into the solid's local space, where the solid has its plain shape, and its front surface is found exactly (a quadratic for the cylinder, cone or sphere, cut by the flat ends).

**A cylinder's side is only what can be seen of it.** (settled)
The side used to cover the whole silhouette, the end that faces the viewer included, since that end is painted on top. That is harmless for a cylinder alone and wrong for a ring around a post: the ring's side then covers the post where only the ring's lid lies between them. The side now ends at the near half of the rim at both ends, which is exactly its visible part. The path keeps its commands, and the outline no longer depends on which end faces the viewer.

**A solid is in front of or behind whatever lies wholly outside one of its flat faces.** (settled)
Two cylinders of one width stacked end to end have sides that share half a rim. Depth samples along that shared edge differ by rounding and by the half-pixel rounded edges, and the answer flipped at dozens of angles per turn. A solid lies on the inner side of each of its flat faces, so when the other shape (a whole solid, by its exact extent along the face's normal, or a flat shape or line, by its points and stroke) lies on the outer side of one, that plane separates them and the side the viewer is on decides, for every face of the solid at once. This also settles a detail that rests on a face.

**Against a round surface, the larger share of the overlap wins.** (open)
A flat detail on a round wall (a door on a tower) can be partly in front of the wall and partly behind it as it passes the wall's edge, where the wall's depth changes steeply; both parts are inside the overlap, so no single order is right. The order that is right for more of the area both cover (strokes included) wins, estimated on a 12 by 12 grid over the common bounds. Counting sample points instead flipped the door four times in the lighthouse, because most samples sat on the thin stroke at the edge.

**Measured.** Over a full turn in half-degree steps, no overlapping pair flips back within 2 degrees in the lighthouse (34 pieces, 111 overlapping pairs), a mug with a handle touching its side and a saucer, a robot of seven boxes touching face to face, or (checked once, not kept as a test) a rocket with fins. The first three are regression tests.

**Known limits.**

- Solids that cut into each other (a tower sunk into a dome) cannot be drawn correctly; rest them on flat faces.
- Faces cannot be removed, so open boxes and cups cannot be built from a solid; draw the opening as a darker ellipse.
- A cone or hemisphere seen exactly along its axis is a plain disc: without lighting there is nothing else to show.
- Not new, but seen while testing: a curved `path` lying exactly in the plane of view (a mug handle with no tilt) has its two halves trade places hundreds of times per turn. Both halves are one color, so nothing changes on screen, but it adds paint-order changes to the animation.

## Projection

**Orthographic only; no perspective and no lighting.** (settled)
These are what would turn Zpup into a weaker three.js. Orthographic projection is also affine, which keeps Bezier curves and ellipses exact after projection. The fixed face shades of solids (see above) are not lighting: they do not change with the view.

## Depth sorting

**Compare overlapping shapes where they overlap, then sort topologically.** (settled in approach, open in details)
Zdog sorts by one center point per shape, which flips the order of shapes that overlap away from their centers. Zpup instead:

1. Flattens each shape to line segments in screen space.
2. For each pair whose screen bounds overlap, samples points that both shapes cover (outline points, crossings, the middle of the overlap between nearby strokes, and, where a round stroke reaches over the edge of a filled area, a point inside that area) and compares surface depth there.
3. Topologically sorts the resulting "paint before" constraints. Unconstrained shapes fall back to mean depth, then tree order. Cycles are broken where it shows least (see below).

Depth model: a round stroke is a tube and a single point is a sphere, so their surfaces bulge toward the viewer by the stroke radius; a filled area is a flat sheet at its plane. This lets a line or dot sit on a coplanar filled shape and still win.

**A cycle is broken at the shape that loses the least area.** (open)
Shapes that pass through each other can each be in front of the next, all the way round, and then no order is right. Breaking the cycle at the shape with the lowest mean depth, as before, sometimes picked the worst place: a red band around a white tower (a wider, shorter cylinder on the same axis) came out with the tower painted over the band's whole front, 1,498 wrong pixels of a 400 by 400 picture. Now, for each shape in the cycle, the area where it is in front of the shapes that should go before it is measured on a grid, and the shape that would lose the least goes first. Only shapes in a cycle that waits for nothing outside itself are candidates (found with Tarjan's algorithm), so a shape that merely waits for the cycle is never painted early. The measuring only runs when a cycle exists.

**Warn about shapes that pass through each other.** (open)
`checkSceneWarnings` looks at the scene from its own view and seven more turns about the vertical axis, and for each pair of pieces of different colors measures the area where one is in front and the area where the other is. The smaller of the two is wrong whichever is painted last. A pair of nodes is reported when that area reaches a thousandth of the image, with the area and the turn at which it shows most. Same colors are left alone: the wrong order cannot be seen there, and joints such as a leg entering a body are built that way on purpose. On the 48 scenes a small model wrote for the benchmark, the warning fires on 19, including 9 of the 10 whose turn error is above 1%. It is not sent back to the model in the benchmark: the other formats have nothing like it, so it would not be a fair comparison.

**Sample points must lie inside the overlap, not on an edge.** (settled)
A point on a filled area's outline is inside or outside it depending on rounding. A dot whose center sat just outside a filled area was once compared only at such points, so as the view turned the answer alternated between "dot in front" and "unclear", and "unclear" fell back to mean depth. In the turning pup this flipped the shadow over the paws 330 times per turn, mostly for half a degree at a time. The extra sample inside the area fixed it: over a full turn in half-degree steps, flips between overlapping pieces went from 370 to 40, every one of them a real change of sides, and a dense grid of depth samples agrees with every answer.

**Unfilled outlines are sorted per segment.** (open)
Each line segment (and each half of a Bezier segment) is sorted on its own, and consecutive pieces that end up adjacent are joined back into one path. This lets a ring pass behind and in front of a sphere. The cost is that an outline can be emitted as several paths, which shows as darker joints if the color is translucent.

**Known limits.** Filled shapes are never split, so shapes that intersect or weave through each other cannot be drawn correctly. The pairwise step is O(n²) in the number of pieces; fine for illustrations, not for thousands of shapes.

**Speed without changing answers.** (settled)
The sorter runs 720 times per turning animation, so its speed matters. Profiled on the lighthouse, 97% of `renderSpinSvg` was in those sorts, mostly in depth queries from the area grid of round surfaces (8 million per animation). These were made cheaper without changing a single result: each shape keeps its stroke segments and outline edges in horizontal bands so a query only looks at the ones that can reach it; the area grid is evaluated a row at a time; pairs from different solids that cannot cover a common point are not compared (the overlap test that `renderSpinSvg` already ran is shared with the sorter); and hot functions stop allocating. The output is byte for byte the same. Median of five runs on a laptop:

| Scene      | Before   | After  |
| ---------- | -------- | ------ |
| hello      | 63 ms    | 56 ms  |
| pup        | 114 ms   | 89 ms  |
| lighthouse | 1,717 ms | 579 ms |

What is left is the area grid itself (12 by 12 points for each pair against a round surface, at every step) and the overlap tests. Checking the order at fewer angles and bisecting where it changes would be faster still, but it can miss a pair that overlaps for less than the coarse step, so the half-degree check stays. A test counts sorts and comparisons instead of timing them, so a regression fails on any machine.

**A detail on a plane that faces the viewer is in front of whatever lies behind that plane.** (settled)
Every flat shape whose points lie in its local x/y plane (all ellipses, rects and polygons, and paths with z = 0) passes that plane to the sorter. Before sampling, a pair is checked against it: if all of the other shape, stroke included, lies behind the plane by at least this shape's stroke radius, a parallel plane separates them and this shape is in front wherever they overlap. This was added for details on a sphere (see below). Filled ellipses on a plane half a unit outside a sphere already sorted right at every half degree, but an open curve with a stroke of 1 there was put behind the sphere at 8 to 22 of the 720 angles per turn, in runs of a few degrees near the sphere's outline, where the sphere's depth changes steeply and most samples fell on the inner edge of the stroke. With the plane test, every case in the test (filled with and without a stroke, and an open curve; facing front, sideways, up and diagonally; three view tilts; 720 angles each) sorts the detail after the sphere while it faces the viewer. A stroke that cuts into the sphere (a curve of stroke 3 half a unit outside) still fails near the outline, which is right: the two then intersect. The examples render byte for byte as before, and the pup's turn got faster (86 to 71 ms), since separated pairs skip sampling.

## Flat shapes seen from behind

**`backface` on flat shapes, with Zdog's meaning.** (settled)
`true` (default) draws both sides, `false` leaves the shape out while its front faces away, a color paints the back in that color. Zdog's option of the same name does the same on its shapes. Solids keep `backface` as a face color, which is also Zdog's (`Cylinder.backface`, `Cone.backface`, `Hemisphere.backface`), and `box` keeps `rearFace`; groups draw nothing and do not take it.

Why it is needed. In a turning character, an eye drawn as a dot on a head flickered as it went round: the sorter paints whole shapes, so the eye must switch from in front of the head to behind it, and the switch happened while the eye still overlapped the head's outline, so the overlapping area changed color in one frame, and every feature did it in turn. Making the eye a flat piece on the head's tangent plane shrinks the area at the switch to almost nothing, but the moment it moves behind the head still depends on the depth samples and can come a little early or late. With `backface: false` the piece is not drawn at all once it faces away, and it faces away exactly when it is edge-on, where it covers nothing; the order no longer decides.

**The front is the local +z side, carried as a normal.** (settled)
The front direction is local +z transformed by the inverse transpose of the node's whole transform (view included), with the sign kept under mirroring, as solids already do for their faces. Transforming +z as a direction instead (Zdog moves a `front` point with the shape) points it off the plane under a non-uniform scale with a rotation, and the shape would then disappear while it still had area. As a normal it turns edge-on exactly with the shape. Mirroring in x or y keeps the front; a negative z scale moves it to the other side, as in Zdog. Exactly edge-on counts as facing away, and so does a shape flattened to a line by a zero scale, which has no front.

**The still picture leaves hidden shapes out of the depth sort, not only out of the output.** (settled)
They have no area to compare, and an unneeded constraint could only bend the order of the rest.

**The turning animation switches at the exact angle.** (settled)
The turning angle enters one rotation about one axis, so the depth component of a front normal is `a cos θ + b sin θ + c`. Zpup reads it at 0, 90 and 180 degrees, solves it in closed form, and adds both roots to the epoch boundaries; in a test across all three axes, both directions, mirrored and tilted shapes, the roots agree with bisection on the compiled pieces to under 0.000001 degrees, and key times are written with six digits (0.00036 degrees). The stretch that starts at such a root is depth-sorted in its middle, where the shape has some area; whole steps are sorted as before. An epoch ends where a shape turns even if its order stays valid, and the next keeps that order. A shape with a back color is defined twice, the same geometry in two colors, and each epoch refers to the one it shows; a shape that never shows is not defined. When a shape turns exactly at angle 0, the epoch at 0 keeps its still-picture side for a millionth of the turn, so a renderer without SMIL still shows `renderSvg`'s picture. A scene without the option plans and renders byte for byte as before.

Measured on the test face (a ball with two eyes and a mouth, all filled, no stroke, `backface: false`): 8 epochs, all from the three features turning, with one order throughout; 14 KB. In Chromium, frames paused about 0.05 degrees before and after an eye and the mouth disappear and reappear show no jump: the piece is a sliver of under a pixel on either side. The lighthouse, which does not use the option, went from about 550 to 570 ms (median of five, measured before and after on one laptop).

**Strokes stay visible edge-on.** (settled)
A stroke is a tube, so a stroked flat piece is still a line when it is edge-on and pops when it goes. The guidance is to give surface details no stroke (or a thin one, placed half the stroke farther out so it does not cut into the surface). Zdog has the same limit.

**No warning for `backface: false` on an open line.** (settled)
An unfilled open path with `backface: false` does vanish at angles that surprise someone who did not think of its local +z, but the same scene is also the right way to draw a smile on a head. A warning could not tell the two apart, so there is none. The one warning added is for a scene where every shape is hidden this way.

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

1. Every piece (a filled shape, a face of a solid, a dot, or one segment of an outline) is defined once in `<defs>`. Its `d` (or `cx` and `cy` for a dot) is animated through keyframes at evenly spaced angles, 36 by default. Orthographic projection is affine, so a piece has the same path commands at every angle and only the numbers change; the browser interpolates linearly between keyframes. Round surfaces of solids keep their commands too but not their points, so they may get extra keyframes (see Solids).
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

**Limits.** Only a constant turn about one axis; nothing else moves and there is no interaction. SMIL cannot read `prefers-reduced-motion`, so the page embedding the image has to offer the still picture. Outlines are drawn per segment, so translucent colors show seams. File size grows with pieces times epochs, and epochs grow with overlapping pairs, so large scenes get big fast. Planning compiles and depth-sorts the scene at 720 angles, which takes about 90 ms for the pup and 0.6 s for the lighthouse (see Depth sorting).

**No `AbortSignal` option.** (settled)
`renderSpinSvg` is synchronous. A signal can only become aborted when other code runs on the same thread, which cannot happen while the function runs, so checking `signal.aborted` inside it would never see a change; making it asynchronous to give the signal a chance would complicate a pure function for the sake of scenes that now take under a second. A caller that needs to stop a long build runs it in a worker and terminates the worker, as the playground does.

**One level of `<use>` only.** Each piece is defined once and placed with `<use>` in every paint order. A piece that soft shading paints as several shapes (a tube's layered strokes, or a tilted round side drawn once per gradient) repeats its moving outline in each of them. Sharing one outline through a second `<use>` would be smaller, and Chrome and Firefox draw it, but WebKit does not redraw a moving shape reached through two levels of `<use>`: in Safari the tubes stood still while the rest turned. The cost is size: the soft pup's turning picture is 87 KB instead of 48 KB.

**Browsers.** The example pictures were compared in Chromium 141, WebKit 26 (Safari's engine) and Firefox 142, still and turning; they draw the same. The soft pup turning ran at about 22 frames a second in headless Firefox, where every other picture kept the full rate: many gradients moving at once are slow there.

**Possible size reduction, not done.** The `<use>` lists are about a quarter of the file (722 references for the pup). Adjacent epochs usually differ by one swapped pair, so one sequence of references that contains every epoch's order as a subsequence (a common supersequence) would need only about 75 references for the pup. Each reference that is not always visible would then need its own visibility animation, roughly 100 bytes each, so the raw saving would be around 6 KB and the gzipped saving smaller, since the repeated lists compress well. Not worth the extra complexity yet.

## Tooling

- **pnpm**: already installed here and runs cleanly on the local Node version, where npm prints an unsupported-engine warning.
- **tsc only, no bundler**: the library is a handful of ESM files; `tsc` emits JavaScript and `.d.ts` directly.
- **Biome** for lint and format: one dev dependency instead of ESLint plus Prettier.
- **Vitest** for tests.
- Source imports use `.ts` extensions (rewritten to `.js` on build) so Node can run the examples without a build step.
