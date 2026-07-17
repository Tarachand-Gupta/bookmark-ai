import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

/**
 * Pinned CRX public key → stable Chrome extension id
 * `ffhbgpgebpmofjkehpjcemepbgcmoelp`, registered in the Clerk instance's
 * allowed_origins (auth breaks if the id rotates). Public key — safe to
 * commit; the private key sits in .keys/crx-key.pem (gitignored).
 */
const CRX_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxZao/ni4uukRy+6xGGy8DZqMWUzz+rYS/7+3IjLrp9RnrAipUTiqZcxqy+cVEtIiz5ZonMenarOSygvkIh5PG8gVx9eZm97Pcn96J7wIMwMIx3Lacve9RVsDTomSGsdZH/U83ad+6ZXPQGBMMQjSe60cu2Zsays5owt2zXyjKlUvLL4NgkiDNS/YGIruPSvVJg5lzEym7IKSl5WlDZgZ5Hqu3m36D3dKDy1RkiXpNANTWRtcbeoPXt0gf7vFPLnyyVh9mvJSpixD9aRbIRJU5M6ABao9pfnaJYmvdjpF1+8himJ1bYug4RZcLJxkQFqoyqVQaiDEIA7V5AjSo9xU4QIDAQAB";

/**
 * Hosts the extension needs to reach. Shared between the manifest function's
 * `host_permissions` and the MV2 re-add hook below so the two never drift.
 * - `http://localhost/*` — match patterns ignore ports, so this covers the web
 *   dev server at localhost:3000 (both Clerk syncHost and the local /api base).
 * - `bookmark-ai.cloud` apex + www — production web app (default API base + prod
 *   Clerk syncHost).
 * - Clerk frontend APIs the extension talks to directly — production (default)
 *   first, dev instance kept for local development.
 */
const HOST_PERMISSIONS = [
  "http://localhost/*",
  "https://bookmark-ai.cloud/*",
  "https://www.bookmark-ai.cloud/*",
  "https://clerk.bookmark-ai.cloud/*",
  "https://darling-baboon-13.clerk.accounts.dev/*",
];

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ browser, manifestVersion }) => ({
    name: "Bookmark AI",
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
    // `tabGroups` (Chrome-only) lets session restore title/color the group.
    permissions: [
      "activeTab",
      "tabs",
      "storage",
      "cookies",
      ...(browser === "chrome" ? ["tabGroups"] : []),
    ],
    host_permissions: HOST_PERMISSIONS,
    ...(browser === "chrome" && {
      key: CRX_PUBLIC_KEY,
      // Lets the web app hand off "restore session" — a page on these origins
      // may message the extension (background onMessageExternal), which opens
      // one window containing every tab. window.open can't do this (popup
      // blockers allow a single tab per click).
      externally_connectable: {
        matches: [
          "http://localhost/*",
          "https://bookmark-ai-theta.vercel.app/*",
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
    // @clerk/chrome-extension validateManifest requires a top-level
    // host_permissions key even on MV2 (when syncHost is set); without it the
    // SDK throws inside ClerkProvider's effect and React blanks the popup on
    // Firefox/Safari. MV2 has no native host_permissions, so WXT folds those
    // hosts into `permissions` and DELETES the top-level key. Crucially, that
    // fold (generateManifest -> moveHostPermissionsToPermissions) runs AFTER
    // the build:manifestGenerated hook, so re-adding the key there never
    // survives — verified empirically. We instead patch the written manifest in
    // build:done, which fires after writeManifest. Firefox/Safari treat the
    // unknown MV2 key as a harmless warning, and the SDK only checks that the
    // key exists (its contents are never read). MV3 already keeps the key, so
    // this is scoped to MV2.
    "build:done": (wxt) => {
      if (wxt.config.manifestVersion !== 2) return;
      const manifestPath = resolve(wxt.config.outDir, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.host_permissions) return;
      manifest.host_permissions = [...HOST_PERMISSIONS];
      // Match WXT's own writer: minified in production, pretty otherwise.
      const json =
        wxt.config.mode === "production"
          ? JSON.stringify(manifest)
          : JSON.stringify(manifest, null, 2);
      writeFileSync(manifestPath, json);
    },
  },
});
