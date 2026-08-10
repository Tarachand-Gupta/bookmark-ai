#!/usr/bin/env node
/**
 * Compiles src/css/demos.src.css → src/css/demos.css with the Tailwind CLI.
 *
 * The docs site renders the product's real demo animations (see
 * src/components/Demo.tsx), which are Tailwind-class components living in
 * @bookmark-ai/ui. Docusaurus has no Tailwind pipeline, so instead of adding one
 * site-wide we compile the handful of utilities those components use into a
 * single stylesheet and hand Docusaurus plain CSS.
 *
 * Runs from `start` and `build`, so a fresh clone and a Vercel build both work
 * without a committed build artifact. The output is gitignored.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const input = join(siteDir, "src", "css", "demos.src.css");
const output = join(siteDir, "src", "css", "demos.css");

// Resolved rather than shelled through `npx`, so a missing dependency is an
// explicit error instead of a network fetch of some other version.
const cli = join(siteDir, "node_modules", "@tailwindcss", "cli", "dist", "index.mjs");
if (!existsSync(cli)) {
  console.error(
    "[docs] @tailwindcss/cli is not installed — run `pnpm install` at the repo root.",
  );
  process.exit(1);
}

execFileSync(process.execPath, [cli, "--input", input, "--output", output, "--minify"], {
  cwd: siteDir,
  stdio: "inherit",
});

console.log(`[docs] wrote ${output}`);
