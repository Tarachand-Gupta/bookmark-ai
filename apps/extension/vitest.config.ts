import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

/**
 * WXT's Vitest plugin resolves the `#imports` virtual module (so `storage`-backed
 * modules like lib/device-token.ts are testable), aliases `@/`, and inlines the
 * `import.meta.env.BROWSER`/`WXT_*` build constants — none of which exist in a
 * bare Vitest run, which is why the earliest tests could only cover pure modules.
 * `storage` is backed by @webext-core/fake-browser (in-memory, per-file), so a
 * test that wants a clean slate calls `fakeBrowser.reset()` in `beforeEach`.
 */
export default defineConfig({
  // The cast is pure version skew, not a real mismatch: WXT's plugin is typed
  // against the Vite copy WXT depends on, while Vitest brings its own newer one,
  // so two structurally identical `PluginOption` types refuse to unify. Runtime
  // is unaffected.
  plugins: [WxtVitest() as unknown as never],
  test: {
    // The device-token / auth-retry tests mock global fetch; restore it (and every
    // spy) between cases so no test inherits another's stubbed network.
    restoreMocks: true,
    unstubGlobals: true,
  },
});
