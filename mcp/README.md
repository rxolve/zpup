# @zpup/mcp

An [MCP](https://modelcontextprotocol.io/) server for [Zpup](https://github.com/rxolve/zpup). An AI model writes a small 3D scene as JSON, gets its mistakes back as errors that say where they are and how to fix them, and sees the picture it made.

Zpup turns the scene into a flat SVG from any angle. The server adds a PNG of each picture so the model can look at its own work and correct it.

## Set up

Add it to your MCP client's configuration:

```json
{
  "mcpServers": {
    "zpup": {
      "command": "npx",
      "args": ["-y", "@zpup/mcp"]
    }
  }
}
```

In Claude Code:

```bash
claude mcp add zpup -- npx -y @zpup/mcp
```

It needs Node 20 or later and runs offline, over standard input and output.

## Tools

| Tool            | What it does                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_reference` | Returns how to write a scene: the format, every shape and its options, and the conventions for axes and angles.                                   |
| `check_scene`   | Checks a scene without drawing it. Returns every error with its path and a fix, and warnings for things that are valid but probably not intended. |
| `render_scene`  | Draws the scene. Returns a PNG to look at, the SVG text, and any warnings. `views` draws the same scene from up to six angles in one call.        |
| `render_spin`   | Makes an SVG that turns the scene forever, with no JavaScript in the file. Returns PNG stills at even steps of the turn.                          |
| `get_scene`     | Returns the scene the server remembers, as JSON.                                                                                                  |

The reference is also available as the resource `zpup://reference`.

### The remembered scene

The server keeps the last scene that was valid, so a model sends a scene once and then only what changes. `render_scene`, `render_spin` and `check_scene` can leave `scene` out to use it again, for example to look from other angles. `render_scene` and `render_spin` also take `changes`, a list of edits applied in order:

```json
{
  "changes": [
    { "op": "set", "path": "children[2].translate.y", "value": -30 },
    {
      "op": "append",
      "path": "children",
      "value": { "type": "dot", "stroke": 8, "color": "#333" }
    },
    { "op": "remove", "path": "children[0]" }
  ]
}
```

| `op`     |                                                                     |
| -------- | ------------------------------------------------------------------- |
| `set`    | Puts `value` at `path`, replacing what is there.                    |
| `remove` | Deletes what is at `path`.                                          |
| `insert` | Puts `value` into a list before the item at `path` (`children[2]`). |
| `append` | Adds `value` to the end of the list at `path` (`children`).         |

A path is written the way the errors write it, `children[2].color`, with or without `scene.` in front. A shape that has an `id` can be named by it in place of counting: `#roof.color`, `#tree.children[0].length`, or `#tree` alone for the shape itself, wherever it is in the tree. The id has to belong to exactly one shape.

After a `remove` or `insert`, the items behind it in that list have a different index, which is one more reason to use ids; `get_scene` returns the scene as it now is.

If a change cannot be applied, or the changed scene is not valid, nothing is changed and the answer says why. A scene that is not valid is not remembered. The memory lasts as long as the server process and is not written anywhere.

### `render_scene`

| Argument       |                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `scene`        | The scene, as an object or as JSON text. Leave it out to use the remembered scene.                                                |
| `changes`      | Edits to the remembered scene, or to `scene` when both are passed.                                                                |
| `views`        | Up to six view angles in degrees, `{ x, y, z }`, each used in place of the scene's own `rotate`.                                  |
| `svg`          | Whether to send the SVG text back. Default `true`.                                                                                |
| `preview_size` | Longer side of the PNG in pixels, 64 to 1024. Default 512.                                                                        |
| `save_to`      | Absolute path ending in `.svg` or `.png` to write the picture to. With several views, `-1`, `-2` and so on are added to the name. |

An invalid scene draws nothing. The answer lists every problem:

```
The scene has 3 problems. Nothing was drawn. Fix them and call again.

- scene.children[0].colour: unknown option "colour". Did you mean "color"? ...
- scene.children[0].height: expected a number of at least 0, received nothing. For example 20.
- scene.children[0].depth: expected a number of at least 0, received nothing. For example 20.
```

The PNG has white painted behind a scene that has no background, so a model does not see a transparent picture as black. A PNG written with `save_to` keeps its transparency.

The summary also says how the drawing sits in the image, for each view:

```
Space around the drawing, in pixels: left 85, right -5, top -10, bottom 70. It is cut off at the right by 5 and the top by 10.
```

SVG text is sent back only up to 30 KB in all. Past that, pass `save_to`.

### `render_spin`

| Argument         |                                                                              |
| ---------------- | ---------------------------------------------------------------------------- |
| `scene`          | The scene, as an object or as JSON text, or left out as in `render_scene`.   |
| `changes`        | Edits to the remembered scene, as in `render_scene`.                         |
| `axis`           | Which view angle turns: `"x"`, `"y"` or `"z"`. Default `"y"`, a turntable.   |
| `duration`       | Seconds for one full turn. Default 8.                                        |
| `keyframes`      | Angles computed exactly, 4 to 720. Default 36.                               |
| `direction`      | `"positive"` or `"negative"`.                                                |
| `preview_frames` | How many stills to send back, at even steps of the turn, 1 to 8. Default 4.  |
| `preview_size`   | Longer side of each still in pixels. Default 256, or 512 for a single still. |
| `save_to`        | Absolute path ending in `.svg`.                                              |

A model cannot play the animation, so the stills show it what the turn looks like: by default the scene at 0, 90, 180 and 270 degrees.

Turning files are large, 43 KB for a small pup and 129 KB for a lighthouse, so the text comes back only when it is under 30 KB. Pass `save_to` to get the file.

## What it writes

The server reads no files of yours and makes no network requests. The remembered scene is held in memory only. It writes a file only when a call passes `save_to`, at exactly that path, creating the folders above it if they are missing.

## Limits

The limits are Zpup's: stills and one kind of turn, no perspective, no text shape, and shapes that cut deep into each other are not drawn correctly. See [the main README](https://github.com/rxolve/zpup#readme).

## License

MIT
