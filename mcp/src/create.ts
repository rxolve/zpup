import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { packageVersion, readReference } from './reference.ts';
import { checkSceneTool, getReference, renderScene, renderSpin } from './tools.ts';

export const REFERENCE_URI = 'zpup://reference';

const scene = z
  .union([z.record(z.string(), z.unknown()), z.string()])
  .describe(
    'The scene: an object with width, height and children (JSON text of the same is accepted). Call get_reference for the full format.',
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
  'A scene is plain JSON: { width, height, rotate?, children: [...] } with shapes such as dot, path, ellipse, rect, polygon, box, pyramid, cylinder, cone and hemisphere placed with translate and rotate (degrees). x is right, y is down, z is toward the viewer. Call get_reference once before writing a first scene.';

/** Builds the server with its tools and the reference resource. It is not connected to anything yet. */
export function createServer(): McpServer {
  const server = new McpServer({ name: 'zpup', version: packageVersion() });

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
    (args) => checkSceneTool(args),
  );

  server.registerTool(
    'render_scene',
    {
      title: 'Draw a Zpup scene',
      description: `Draws a small 3D scene as a flat SVG picture and returns a PNG of it to look at, the SVG text, and any warnings. An invalid scene draws nothing and returns every error with its path and how to fix it. Pass views to see the same scene from several angles in one call, which is the quickest way to find a shape that is in the wrong place. ${FORMAT_NOTE}`,
      inputSchema: {
        scene,
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
      annotations: { idempotentHint: true, openWorldHint: false },
    },
    (args) => renderScene(args),
  );

  server.registerTool(
    'render_spin',
    {
      title: 'Make a turning Zpup SVG',
      description: `Makes an SVG that turns the scene forever about one axis, with no JavaScript in the file, so it plays inside an <img> tag or a README. Returns PNG stills at even steps of the turn, so you can see what the animation shows. These files are large (tens to hundreds of KB), so pass save_to; the SVG text comes back only when it is small. ${FORMAT_NOTE}`,
      inputSchema: {
        scene,
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
      annotations: { idempotentHint: true, openWorldHint: false },
    },
    (args) => renderSpin(args),
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
