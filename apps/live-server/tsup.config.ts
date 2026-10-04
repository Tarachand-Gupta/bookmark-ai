import { defineConfig } from "tsup";

// The workspace package @bookmark-ai/types ships raw TS (no build output), so it
// must be bundled INTO the server output — `noExternal` pulls it in. Everything
// else (fastify, ioredis, @clerk/backend) stays external and is installed via
// `pnpm deploy --prod` in the Docker runtime stage.
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: true,
  // Bundled workspace dependencies include CommonJS (for example undici).
  // Their built-in requires need a Node resolver in the emitted ESM module.
  banner: {
    js: 'import { createRequire as createNodeRequire } from "node:module"; const require = createNodeRequire(import.meta.url);',
  },
  noExternal: [/^@bookmark-ai\//],
  // Keep native bindings and CommonJS dependency-relative resolution in their
  // own installed packages instead of relocating them into dist/server.js.
  external: ["@libsql/client", "undici"],
});
