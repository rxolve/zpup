import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The MCP server imports the library by its package name. Tests run it
    // against the source, so they need no build first.
    alias: { '@zpup/core': fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
  },
});
