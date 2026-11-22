/**
 * Builds the playground into playground/dist/, a folder any static server
 * (or GitHub Pages) can serve as it is:
 *
 *   index.html     the page, with the examples and a first picture written in
 *   style.css
 *   *.js           the page's modules, compiled from playground/src
 *   lib/*.js       the library, copied from dist/ (run `pnpm build` first)
 *   llms.txt
 *   game/          the sprite demo, copied from playground/game as it is
 *
 * The examples are taken from examples/*.ts at build time, so the page
 * always shows the same scenes as the repository.
 *
 * Run with `pnpm playground:build`, which builds the library first.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hello } from '../examples/hello.ts';
import { lighthouse } from '../examples/lighthouse.ts';
import { pup } from '../examples/pup.ts';
import { renderSvg, type Scene } from '../src/index.ts';
import { formatJson } from './src/json.ts';

const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const out = root('playground/dist');

if (!existsSync(root('dist/index.js'))) {
  throw new Error('dist/ is missing: run `pnpm build` first (or use `pnpm playground:build`).');
}

rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/lib`, { recursive: true });

// The page's modules.
execFileSync(root('node_modules/.bin/tsc'), ['-p', root('playground/tsconfig.build.json')], {
  stdio: 'inherit',
});

// The library: only the JavaScript, not type declarations or source maps.
for (const file of readdirSync(root('dist'))) {
  if (file.endsWith('.js')) copyFileSync(root(`dist/${file}`), `${out}/lib/${file}`);
}

copyFileSync(root('playground/style.css'), `${out}/style.css`);
copyFileSync(root('llms.txt'), `${out}/llms.txt`);

// The sprite demo: a static page with its sheets, served at game/.
mkdirSync(`${out}/game`);
for (const file of readdirSync(root('playground/game'))) {
  copyFileSync(root(`playground/game/${file}`), `${out}/game/${file}`);
}

const scenes: Record<string, Scene> = { hello, pup, lighthouse };
const examples: Record<string, string> = {};
for (const [name, scene] of Object.entries(scenes)) {
  examples[name] = formatJson(scene);
}
const first = 'hello';

const escapeHtml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
// Inside <script type="application/json">, only "<" needs care ("</script>").
const scriptJson = JSON.stringify(examples).replaceAll('<', '\\u003c');

const template = readFileSync(root('playground/index.html'), 'utf8');
const page = template
  .replace('{{EDITOR_TEXT}}', () => escapeHtml(examples[first] ?? ''))
  .replace('{{PREVIEW_SVG}}', () => renderSvg(scenes[first] as Scene).trimEnd())
  .replace(
    '<script type="application/json" id="examples">{}</script>',
    () => `<script type="application/json" id="examples">${scriptJson}</script>`,
  );
writeFileSync(`${out}/index.html`, page);

console.log(`wrote ${out}`);
