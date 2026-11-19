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
| `render_spin`   | Makes an SVG that turns the scene forever, with no JavaScript in the file. Returns a PNG of the first frame.                                      |

The reference is also available as the resource `zpup://reference`.

### `render_scene`

| Argument       |                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `scene`        | The scene, as an object or as JSON text.                                                                                          |
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

SVG text is sent back only up to 30 KB in all. Past that, pass `save_to`.

### `render_spin`

| Argument       |                                                                            |
| -------------- | -------------------------------------------------------------------------- |
| `scene`        | The scene, as an object or as JSON text.                                   |
| `axis`         | Which view angle turns: `"x"`, `"y"` or `"z"`. Default `"y"`, a turntable. |
| `duration`     | Seconds for one full turn. Default 8.                                      |
| `keyframes`    | Angles computed exactly, 4 to 720. Default 36.                             |
| `direction`    | `"positive"` or `"negative"`.                                              |
| `preview_size` | As above.                                                                  |
| `save_to`      | Absolute path ending in `.svg`.                                            |

Turning files are large, 43 KB for a small pup and 129 KB for a lighthouse, so the text comes back only when it is under 30 KB. Pass `save_to` to get the file.

## What it writes

The server reads no files of yours and makes no network requests. It writes a file only when a call passes `save_to`, at exactly that path, creating the folders above it if they are missing.

## Limits

The limits are Zpup's: stills and one kind of turn, no perspective, no text shape, and shapes that cut deep into each other are not drawn correctly. See [the main README](https://github.com/rxolve/zpup#readme).

## License

MIT
