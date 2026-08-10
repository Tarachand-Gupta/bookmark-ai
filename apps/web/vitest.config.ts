import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for the framework-free server modules (MCP token crypto, rate-limit
 * window math, the JSON-RPC dispatcher). Deliberately NOT a Next.js test setup:
 * there is no jsdom, no React, and nothing here boots the app — anything that
 * needs a request scope or a live DB is covered by the smoke tests in
 * docs/features/mcp.md instead.
 *
 * The `@/` alias mirrors tsconfig's paths so the modules under test resolve the
 * same way they do under next dev.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
