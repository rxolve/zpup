import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { packageVersion, readReference } from './reference.ts';
import {
  checkSceneTool,
  getReference,
  getScene,
  type Memory,
  renderScene,
  renderSpin,
  renderSprites,
} from './tools.ts';

export const REFERENCE_URI = 'zpup://reference';

const scene = z
  .union([z.record(z.string(), z.unknown()), z.string()])
  .optional()
  .describe(
    'The scene: an object with width, height and children (JSON text of the same is accepted). Call get_reference for the full format. Leave it out to use the scene from the last valid call.',
  );

const change = z
  .object({
    op: z
      .enum(['set', 'remove', 'insert', 'append', 'copy'])
      .describe(
        'set: put value at path, replacing what is there. remove: delete what is at path. insert: put value into a list before the item at path. append: add value to the end of the list at path. copy: add a copy of the shape at path to the end of the list it is in, with the keys of value (an object, such as a new id, translate, scale or color) put over the copy; the copy and the shapes inside it lose their ids.',
      ),
    path: z
      .string()
      .describe(
        'Where, in the form the errors use: "children[2].color", "children[0].translate.y", "rotate". A shape that has an id can be named by it in place of counting: "#roof.color", "#tree.children[0].length", or "#tree" alone for the shape itself. For append, the list itself: "children" or "#tree.children".',
      ),
    value: z
      .unknown()
      .optional()
      .describe('The new value. Not used by remove. For copy, what differs in the copy.'),
  })
  .strict();

const changes = z
  .array(change)
  .min(1)
  .max(100)
  .optional()
  .describe(
    'Edits to the remembered scene (or to scene, when both are passed), applied in order, so that a small fix does not need the whole scene again. Example: [{ "op": "set", "path": "children[2].translate.y", "value": -30 }, { "op": "append", "path": "children", "value": { "type": "dot", "stroke": 8, "color": "#333" } }, { "op": "copy", "path": "#tree", "value": { "id": "tree2", "translate": { "x": 60 }, "scale": 0.7 } }]. After a remove or insert, later items in that list have a different index, so give shapes an id and use "#id" paths. If the result is not valid, nothing is changed.',
  );

const pose = z
  .array(change)
  .max(100)
  .optional()
  .describe(
    'Changes to draw with but not to keep, in the form of changes: the picture shows the scene in this pose, and the remembered scene stays as it is. Use it with views to check one pose of a sprite sheet large and from several sides before making the sheet.',
  );

const poses = z
  .array(z.array(change).max(100))
  .min(1)
  .max(16)
  .optional()
  .describe(
    'Poses of the scene, for a walk or any other motion: each pose is a list of changes, in the form of changes, applied to the scene on its own, and an empty list is the scene as it is. The sheet then has one row per direction and one column per pose. Give each part that moves an id and put it in a group at its joint, so that a pose only sets rotate: [[], [{ "op": "set", "path": "#leg-front.rotate", "value": { "x": 25 } }, { "op": "set", "path": "#leg-back.rotate", "value": { "x": -25 } }], [], [{ "op": "set", "path": "#leg-front.rotate", "value": { "x": -25 } }, { "op": "set", "path": "#leg-back.rotate", "value": { "x": 25 } }]]. Poses do not build on each other and are not remembered. At most 16, and at most 128 cells in all.',
  );

const angle = z
  .object({
    x: z.number().optional().describe('Degrees. Negative looks down from above.'),
    y: z.number().optional().describe('Degrees. Turns the scene about its vertical axis.'),
    z: z.number().optional().describe('Degrees. Positive is clockwise on screen.'),
  })
  .strict();

const previewSize = z
  .number()
  .min(64)
  .max(1024)
  .optional()
  .describe('Longer side of the PNG in pixels. Default 512.');

const FORMAT_NOTE =
  'A scene is plain JSON: { width, height, rotate?, children: [...] } with shapes such as dot, path, ellipse, rect, polygon, box, pyramid, cylinder, cone and hemisphere placed with translate and rotate (degrees). x is right, y is down, z is toward the viewer. Call get_reference once before writing a first scene. The server remembers the last valid scene: a later call can leave scene out to draw it again, or pass changes to edit it.';

/** Builds the server with its tools and the reference resource. It is not connected to anything yet. */
export function createServer(): McpServer {
  const server = new McpServer({ name: 'zpup', version: packageVersion() });
  // One server serves one client, so one remembered scene is enough.
  const memory: Memory = {};

  server.registerTool(
    'get_reference',
    {
      title: 'Zpup scene reference',
      description:
        'Returns the reference for writing a Zpup scene: the scene format, every shape and its options, conventions for axes and angles, and common mistakes. Read it once before writing a scene.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    () => getReference(),
  );

  server.registerTool(
    'check_scene',
    {
      title: 'Check a Zpup scene',
      description: `Checks a scene without drawing it. Returns every error with its path and how to fix it, and warnings for things that are valid but probably not intended (angles in radians, shapes outside the image, shapes of different colors passing through each other). ${FORMAT_NOTE}`,
      inputSchema: { scene },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) => checkSceneTool(args, memory),
  );

  server.registerTool(
    'get_scene',
    {
      title: 'Read the remembered Zpup scene',
      description:
        'Returns the scene the server remembers, as JSON: the last valid scene sent, with every change applied since. Use it to see the current indexes after several edits, or to keep the scene.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    () => getScene(memory),
  );

  server.registerTool(
    'render_scene',
    {
      title: 'Draw a Zpup scene',
      description: `Draws a small 3D scene as a flat SVG picture and returns a PNG of it to look at, the SVG text, and any warnings. An invalid scene draws nothing and returns every error with its path and how to fix it. Pass views to see the same scene from several angles in one call, which is the quickest way to find a shape that is in the wrong place. views and pose change only this picture: an angle or a pose set with changes stays in the remembered scene. ${FORMAT_NOTE}`,
      inputSchema: {
        scene,
        changes,
        pose,
        views: z
          .array(angle)
          .min(1)
          .max(6)
          .optional()
          .describe(
            "View angles to draw, each used in place of the scene's own rotate. Omit to draw the scene as written.",
          ),
        svg: z
          .boolean()
          .optional()
          .describe(
            'Whether to send the SVG text back. Default true. Set false while iterating on the look to save space.',
          ),
        preview_size: previewSize,
        save_to: z
          .string()
          .optional()
          .describe(
            'Absolute path ending in .svg or .png to write the picture to. With several views, -1, -2 and so on are added to the name.',
          ),
      },
      annotations: { idempotentHint: false, openWorldHint: false },
    },
    (args) => renderScene(args, memory),
  );

  server.registerTool(
    'render_spin',
    {
      title: 'Make a turning Zpup SVG',
      description: `Makes an SVG that turns the scene forever about one axis, with no JavaScript in the file, so it plays inside an <img> tag or a README. Returns PNG stills at even steps of the turn, so you can see what the animation shows. These files are large (tens to hundreds of KB), so pass save_to; the SVG text comes back only when it is small. ${FORMAT_NOTE}`,
      inputSchema: {
        scene,
        changes,
        axis: z
          .enum(['x', 'y', 'z'])
          .optional()
          .describe('Which view angle turns. Default "y", a turntable.'),
        duration: z.number().optional().describe('Seconds for one full turn. Default 8.'),
        keyframes: z
          .number()
          .optional()
          .describe('Angles computed exactly, 4 to 720. More is smoother and larger. Default 36.'),
        direction: z.enum(['positive', 'negative']).optional(),
        preview_frames: z
          .number()
          .int()
          .min(1)
          .max(8)
          .optional()
          .describe(
            'How many stills to send back, at even steps of the turn. Default 4 (0, 90, 180 and 270 degrees). Their default size is 256.',
          ),
        preview_size: previewSize,
        save_to: z
          .string()
          .optional()
          .describe('Absolute path ending in .svg to write the file to.'),
      },
      annotations: { idempotentHint: false, openWorldHint: false },
    },
    (args) => renderSpin(args, memory),
  );

  server.registerTool(
    'render_sprites',
    {
      title: 'Make a sprite sheet of a Zpup scene',
      description: `Draws one scene from every side, turned in equal steps about its vertical axis, and lays the pictures out as one transparent PNG sprite sheet for a game: the same object in 4, 8 or 16 directions, all from one scene, so they agree with each other. With poses it draws every direction in every pose, for a walk cycle: one row per direction, one column per pose. With save_to it also writes the frame list next to the PNG as JSON, in the form TexturePacker writes (JSON hash) and Phaser, PixiJS and other engines read. Returns the sheet to look at. Every cell has the scene's own frame, so check that nothing is cut off as the object turns, or pass fit to have the frame set for you. Keep the scene's own view angle for the tilt: rotate x around -30 for a view from above. ${FORMAT_NOTE}`,
      inputSchema: {
        scene,
        changes,
        directions: z
          .number()
          .int()
          .min(2)
          .max(32)
          .optional()
          .describe('How many directions to draw, at even steps of a full turn. Default 8.'),
        cell_size: z
          .number()
          .min(16)
          .max(1024)
          .optional()
          .describe('Longer side of each cell in pixels. Default 128.'),
        columns: z
          .number()
          .int()
          .min(1)
          .max(32)
          .optional()
          .describe(
            'Cells per row. Default: all directions in one row, up to 8. Not used with poses, where a row is one direction.',
          ),
        poses,
        fit: z
          .boolean()
          .optional()
          .describe(
            "Set to true to have the frame set for you: every cell shows the same part of the scene, enlarged so that the drawing fills the cell in the direction and pose where it reaches furthest. Nothing is cut off and no space is wasted, and the scene is not changed. Default false, which uses the scene's own frame.",
          ),
        preview_direction: z
          .number()
          .int()
          .min(0)
          .max(31)
          .optional()
          .describe(
            'A direction, counted from 0, to send back on its own as a second, larger picture: its poses in a row, to judge the motion from one pose to the next. 2 is the side view when there are 8 directions.',
          ),
        save_to: z
          .string()
          .optional()
          .describe(
            'Absolute path ending in .png to write the sheet to. The frame list is written next to it with the same name ending in .json.',
          ),
      },
      annotations: { idempotentHint: false, openWorldHint: false },
    },
    (args) => renderSprites(args, memory),
  );

  server.registerResource(
    'reference',
    REFERENCE_URI,
    {
      title: 'Zpup scene reference',
      description: 'How to write a Zpup scene. The same text get_reference returns.',
      mimeType: 'text/markdown',
    },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readReference() }],
    }),
  );

  return server;
}
