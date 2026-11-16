# zpup

A modern, AI-friendly pseudo-3D engine for the web, inspired by [Zdog](https://zzz.dog/).

Pronounced "zee-pup".

![A small sitting pup drawn with zpup](examples/pup.svg)

## Status

Early work in progress. The core (scene tree, transforms, orthographic projection, depth sorting) and the SVG string renderer work and are tested, but the API may still change. The `0.0.0` package on npm only reserves the name; nothing usable is published yet.

Not built yet: a canvas renderer, animation, and framework bindings.

## Install

Until the first release, install from GitHub (this needs a build step, so clone and build):

```bash
git clone https://github.com/rxolve/zpup.git
cd zpup
pnpm install
pnpm build
```

Once published it will be `npm install zpup`. zpup is ESM-only and has no runtime dependencies.

## Usage

A scene is a plain object tree. `renderSvg` turns it into an SVG string, with no DOM, so it works on a server and the first paint needs no JavaScript.

```ts
import { dot, ellipse, renderSvg } from 'zpup';

const svg = renderSvg({
  width: 120,
  height: 120,
  rotate: { x: -20, y: 30 },
  children: [
    dot({ stroke: 40, color: '#e62' }), // a thick dot is a sphere
    ellipse({ diameter: 70, stroke: 5, color: '#636', rotate: { x: 90 } }), // a ring around it
  ],
});
```

The helpers only add a `type` field, so the same scene can be written, stored and sent as JSON:

```json
{
  "width": 120,
  "height": 120,
  "rotate": { "x": -20, "y": 30 },
  "children": [
    { "type": "path", "path": [{}], "stroke": 40, "color": "#e62" },
    { "type": "ellipse", "diameter": 70, "stroke": 5, "color": "#636", "rotate": { "x": 90 } }
  ]
}
```

### The basics

- **Axes:** x right, y down, z toward the viewer. The origin is the center of the image.
- **Angles:** degrees. Positive `rotate.z` turns clockwise on screen.
- **Nodes:** `group`, `path`, `ellipse`, `rect`, `polygon`. Every node takes `translate`, `rotate`, `scale`, `visible` and `children`; children inherit their parent's transform.
- **Shapes:** `color`, `stroke` (round-capped width; thick strokes give volume) and `fill`.
- **Errors:** an invalid scene throws a `ZpupValidationError` that lists every problem with its path, what was expected and how to fix it. `checkScene(scene)` returns the same list without throwing.

There is no lighting and no perspective, by design. See [docs/decisions.md](docs/decisions.md) for the reasoning behind these and other choices, and [llms.txt](llms.txt) for a compact reference written for AI coding tools.

## Goals

- Round, flat, designer-friendly pseudo-3D illustrations, in the spirit of Zdog
- TypeScript and ESM from the start
- A declarative API that is easy for both people and AI coding tools to write correctly
- SVG output that can be rendered on the server
- Depth sorting that holds up when shapes overlap

## Development

Requires Node.js 22.18 or later (the example script runs TypeScript directly) and [pnpm](https://pnpm.io/).

```bash
pnpm install
pnpm test        # unit and snapshot tests
pnpm typecheck
pnpm lint
pnpm build       # writes dist/
pnpm example     # writes examples/pup.svg
```

## Credits

zpup is inspired by [Zdog](https://github.com/metafizzy/zdog) by David DeSandro. It is a new implementation that shares no code with Zdog. It is an independent project and is not affiliated with Zdog or Metafizzy.

## License

MIT
