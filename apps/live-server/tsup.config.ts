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
  noExternal: [/^@bookmark-ai\//],
});
