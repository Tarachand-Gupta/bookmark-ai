#!/usr/bin/env node
/**
 * Watchdog wrapper for one-shot wxt commands (`prepare`, `build`, `zip`).
 *
 * WHY: importing the background entrypoint pulls in @clerk/chrome-extension,
 * which opens a module-scope handle that keeps the Node event loop alive —
 * wxt prints "✔ Finished" and then NEVER EXITS. Locally that leaves zombie
 * builds deadlocking .output; on Vercel the extension's postinstall hangs the
 * whole deploy until the 45-minute build timeout (verified 2026-08-10 against
 * two production deploys and reproduced with a minimal entrypoint importing
 * only `createClerkClient`). Until the upstream handle is fixed, we watch for
 * wxt's own success line and put the process down ourselves.
 *
 * NEVER use this for `wxt dev` — dev is supposed to stay alive.
 */
import { spawn } from "node:child_process";

const args = process.argv.slice(2);

// Vercel builds only need apps/web; extension type-generation is dead weight
// there and is exactly the command that wedges the deploy. Skip outright.
if (process.env.VERCEL && args[0] === "prepare") {
  console.log("[wxt-run] VERCEL detected — skipping `wxt prepare` (not needed for the web build)");
  process.exit(0);
}

const child = spawn("wxt", args, {
  stdio: ["inherit", "pipe", "pipe"],
  shell: process.platform === "win32",
});

// Success marker → grace period → force-exit if wxt is still lingering.
const GRACE_MS = 1500;
let finished = false;
function watch(stream, out) {
  stream.on("data", (chunk) => {
    out.write(chunk);
    if (!finished && /Finished in/.test(String(chunk))) {
      finished = true;
      setTimeout(() => {
        // Child completed its work; a live handle is the only thing left.
        child.kill("SIGKILL");
        process.exit(0);
      }, GRACE_MS).unref();
    }
  });
}
watch(child.stdout, process.stdout);
watch(child.stderr, process.stderr);

child.on("exit", (code) => process.exit(code ?? 0));
