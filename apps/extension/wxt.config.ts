import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

/**
 * THREE side-by-side build targets, each with its OWN pinned CRX key so the
 * three installs get DISTINCT, stable Chrome extension ids and can coexist in
 * one Chrome profile without clobbering each other (see CLAUDE.md → Build
 * targets). The target is chosen by WXT's env `mode` (see `TARGETS` below).
 * All keys are PUBLIC halves — safe to commit; the matching private keys are
 * NOT in the repo (prod: .keys/crx-key.pem, gitignored; dev/local: generated
 * out-of-tree — only needed to pack a .crx, never to load unpacked).
 *
 * Each id is registered in the Clerk instance's allowed_origins and in
 * apps/web/lib/authorized-parties.ts — auth breaks if an id rotates.
 *   prod  → ffhbgpgebpmofjkehpjcemepbgcmoelp
 *   dev   → ljlfmaknohecakpdolffabmjdfikfjed
 *   local → joillpelifndeefomeimoomlgoimbkei
 */
const CRX_KEYS = {
  prod: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxZao/ni4uukRy+6xGGy8DZqMWUzz+rYS/7+3IjLrp9RnrAipUTiqZcxqy+cVEtIiz5ZonMenarOSygvkIh5PG8gVx9eZm97Pcn96J7wIMwMIx3Lacve9RVsDTomSGsdZH/U83ad+6ZXPQGBMMQjSe60cu2Zsays5owt2zXyjKlUvLL4NgkiDNS/YGIruPSvVJg5lzEym7IKSl5WlDZgZ5Hqu3m36D3dKDy1RkiXpNANTWRtcbeoPXt0gf7vFPLnyyVh9mvJSpixD9aRbIRJU5M6ABao9pfnaJYmvdjpF1+8himJ1bYug4RZcLJxkQFqoyqVQaiDEIA7V5AjSo9xU4QIDAQAB",
  dev: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4BwVAsb+pQScMBBNirykrxv2N8OS6cA5ibAQZLQtTjU4r4b1pP5cO4Wk6zbaODmBbk863mss1GhkdmWJMfI544/q+E19cIxNOUI0YikIHlHYcBfrjSXP7B9Q8jJSi6b1BmgoJ5grN4XLYKBy/YbGk45JoQRKkYW9ER362w0emu+xzb/uGpOiVq4qd1GG5oKkq/7QKWUQKR/iCX6oAF5/d4SK5uCOwHW9Yc8hjYWFXtNpixO21FltRzHDyK9avnph0F3W+18fmH60JVj2nfJBCce79oweJcxYQps7u5KS3kSmKxoY/ARBpv2hacTQO+/Ktj7XktsixSnf+9AKNLb8LQIDAQAB",
  local: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAt9Qd9/bjr0gAnz3fgxK4bzP1hwxJ83E4A02ctmBk/6V82VYnyG3piyY9tjOrjcLqphvJEqD3fgrJ95mOj0mVI1yJLp2xdKxpLW8pXR98r1krKoDOxwp/n8Sz8hTO6vlY41zQAs8wT5ozQcACdymHW1t+lCj7MLb97tVZAvQ8VM2/yqmi7j9tcx7sJX5rRO23B4FL9hMZw1C4+HUPrOSbGoq/Lkx6deNl4+qwmfp/FM2zlp9s2sskzLpuf/4ofVgScIlRmBIbWANilkAeJtMbC3TMZcpI4CzLtEjrw4/E6FeFX/qLq84OnQoenSfNpbKE1dX16zItC06r9t1QeWnfGQIDAQAB",
} as const;

/**
 * Per-target identity, keyed by WXT env `mode`. `pnpm dev` and `build:local`
 * run in `development` mode (LOCAL target); `build:dev` in `dev-remote`;
 * `pnpm build` in `production`. Anything else (e.g. a Firefox/Safari build,
 * which defaults to production mode) falls back to prod.
 *   - name/iconDir/key make the three installs visually + structurally distinct
 *     (black plate / green plate / red plate, distinct ids).
 */
const TARGETS = {
  production: { key: CRX_KEYS.prod, name: "Bookmark AI", iconDir: "icon" },
  "dev-remote": { key: CRX_KEYS.dev, name: "Bookmark AI (Dev)", iconDir: "icon-dev" },
  development: { key: CRX_KEYS.local, name: "Bookmark AI (Local)", iconDir: "icon-local" },
} as const;

function targetFor(mode: string): (typeof TARGETS)[keyof typeof TARGETS] {
  return TARGETS[mode as keyof typeof TARGETS] ?? TARGETS.production;
}

function iconsFor(mode: string): Record<string, string> {
  const dir = targetFor(mode).iconDir;
  return Object.fromEntries(
    [16, 32, 48, 96, 128].map((s) => [String(s), `${dir}/${s}.png`]),
  );
}

/**
 * Hosts the extension needs to reach. Shared between the manifest function's
 * `host_permissions` and the MV2 re-add hook below so the two never drift.
 * A static SUPERSET so ONE manifest shape covers all three build targets.
 * - `http://localhost/*` — match patterns ignore ports, so this covers the web
 *   dev server at localhost:3000 (both Clerk syncHost and the local /api base) —
 *   the LOCAL target.
 * - `bookmark-ai.cloud` apex + www — production web app (prod target: API base +
 *   Clerk syncHost).
 * - `bookmark-ai-dev.vercel.app` — the dedicated DEV deployment (the `build:dev`
 *   app origin + its Clerk syncHost).
 * - Clerk frontend APIs the extension talks to directly — production (default)
 *   first, dev instance kept for the dev + local targets.
 * - `live.bookmark-ai.cloud` — the dedicated Live Sessions server (Fastify,
 *   separate from the Vercel-hosted /api/*). `http://localhost/*` above
 *   already covers a local live server for dev.
 */
const HOST_PERMISSIONS = [
  "http://localhost/*",
  "https://bookmark-ai.cloud/*",
  "https://www.bookmark-ai.cloud/*",
  "https://bookmark-ai-dev.vercel.app/*",
  "https://clerk.bookmark-ai.cloud/*",
  "https://darling-baboon-13.clerk.accounts.dev/*",
  "https://live.bookmark-ai.cloud/*",
];

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ browser, manifestVersion, mode }) => ({
    name: targetFor(mode).name,
    icons: iconsFor(mode),
    description:
      "Save the current tab to Bookmark AI for automatic categorization and tagging.",
    // No `incognito` key on purpose — the default ("spanning") stands, and
    // private tabs are excluded in code by lib/session-filter.ts instead.
    //   - "not_allowed" would be structural, but it also kills bookmarking a
    //     single page from a private window. That save is explicit per-URL
    //     consent (open popup on that page, click Save); a session snapshot
    //     sweeps every tab and is not. Only the sweep needs blocking.
    //   - "split" spawns a second worker with its own storage, which perturbs
    //     the Clerk cookie sync in lib/clerk.ts — and it still wouldn't stand
    //     alone, since the incognito worker can see incognito windows anyway.
    // The filter is what enforces this; session-filter.test.ts is what keeps
    // it enforced. Deleting the filter turns those tests red.
    // `cookies` lets Clerk's syncHost read the web app's session cookie.
    // `alarms` drives the live-tabs heartbeat/backstop (§4.5) and the native-sync
    // settings refresh — a non-warning permission, which is exactly why
    // live-tabs must be opt-in (§5.1).
    // `tabGroups` (Chrome-only) lets session restore title/color the group.
    // `scripting` (Safari-only) lets the background re-inject the session
    // bridge into app tabs that predate the current install — a manifest
    // content script only reaches tabs opened AFTER install, and Safari's
    // whole auth path dies with an orphaned bridge.
    // `bookmarks` (Chrome/Firefox — Safari exposes no bookmarks API) mirrors
    // native bookmark add/remove into the library (lib/native-sync.ts).
    // `readingList` (Chrome 120-only) mirrors Reading List additions.
    permissions: [
      "activeTab",
      "tabs",
      "storage",
      "alarms",
      "cookies",
      ...(browser === "chrome" ? ["bookmarks", "readingList", "tabGroups"] : []),
      ...(browser === "firefox" ? ["bookmarks"] : []),
      ...(browser === "safari" ? ["scripting"] : []),
    ],
    host_permissions: HOST_PERMISSIONS,
    ...(browser === "chrome" && {
      // Per-target key → distinct, stable id per install (prod/dev/local).
      key: targetFor(mode).key,
      // New Tab Canvas: manifest-sandboxed frame page — the ONLY Chrome
      // document whose CSP may allow inline template scripts. The `sandbox` CSP
      // directive (allow-scripts, NO allow-same-origin) keeps the frame an
      // opaque-origin, chrome.*-less, network-less world regardless
      // (docs/features/newtab-canvas.md §5; why NOT srcdoc: see
      // public/newtab-frame.html's header).
      sandbox: { pages: ["newtab-frame.html"] },
      content_security_policy: {
        sandbox:
          "sandbox allow-scripts; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: https:; connect-src 'none'; object-src 'none'; base-uri 'none';",
      },
      // Lets the web app hand off "restore session" — a page on these origins
      // may message the extension (background onMessageExternal), which opens
      // one window containing every tab. window.open can't do this (popup
      // blockers allow a single tab per click).
      externally_connectable: {
        matches: [
          "http://localhost/*",
          "https://bookmark-ai-theta.vercel.app/*",
          "https://bookmark-ai-dev.vercel.app/*",
          "https://bookmark-ai.cloud/*",
          "https://www.bookmark-ai.cloud/*",
        ],
      },
    }),
    ...(browser === "firefox" && {
      browser_specific_settings: {
        gecko: {
          id: "bookmark-ai@purecode.ai",
          data_collection_permissions: { required: ["none"] },
        },
      },
    }),
    commands: {
      // MV2 (Firefox/Safari targets) uses the legacy browser_action command name.
      [manifestVersion === 2 ? "_execute_browser_action" : "_execute_action"]: {
        suggested_key: { default: "Alt+Shift+S" },
        description: "Open the Bookmark AI popup",
      },
    },
  }),
  hooks: {
    // Patches applied to the WRITTEN manifest (build:done fires after
    // writeManifest — WXT's own MV2 config fold and entrypoint-derived keys
    // are final by then, so only a post-write patch survives).
    "build:done": (wxt) => {
      const manifestPath = resolve(wxt.config.outDir, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      let mutated = false;

      // New Tab Canvas is CHROME-ONLY for now (design §4.9/§10): WXT auto-maps
      // entrypoints/newtab/ to chrome_url_overrides.newtab for every browser,
      // and the sandbox frame page is chrome-only by construction (its
      // `sandbox`/`content_security_policy.sandbox` keys are only added for
      // the chrome target — strip our map-added override key on the others).
      if (wxt.config.browser !== "chrome" && manifest.chrome_url_overrides) {
        delete manifest.chrome_url_overrides;
        mutated = true;
      }
      if (wxt.config.browser !== "chrome" && manifest.sandbox) {
        delete manifest.sandbox;
        delete manifest.content_security_policy?.sandbox;
        mutated = true;
      }

      // @clerk/chrome-extension validateManifest requires a top-level
      // host_permissions key even on MV2 (when syncHost is set); without it the
      // SDK throws inside ClerkProvider's effect and React blanks the popup on
      // Firefox. MV2's fold-and-delete runs AFTER build:manifestGenerated, so
      // this re-add only survives when patched into the WRITTEN manifest here.
      // Covers the Firefox MV2 output only (Safari builds MV3 and keeps the key).
      if (wxt.config.manifestVersion === 2 && !manifest.host_permissions) {
        manifest.host_permissions = [...HOST_PERMISSIONS];
        mutated = true;
      }

      if (!mutated) return;
      // Match WXT's own writer: minified in production, pretty otherwise.
      const json =
        wxt.config.mode === "production"
          ? JSON.stringify(manifest)
          : JSON.stringify(manifest, null, 2);
      writeFileSync(manifestPath, json);
    },
  },
});
