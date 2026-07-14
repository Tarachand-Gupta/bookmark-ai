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

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ browser, manifestVersion }) => ({
    name: "Bookmark AI",
    description:
      "Save the current tab to Bookmark AI for automatic categorization and tagging.",
    // `cookies` lets Clerk's syncHost read the web app's session cookie.
    // `tabGroups` (Chrome-only) lets session restore title/color the group.
    permissions: [
      "activeTab",
      "tabs",
      "storage",
      "cookies",
      ...(browser === "chrome" ? ["tabGroups"] : []),
    ],
    host_permissions: [
      // Match patterns ignore ports, so this one entry covers the web dev
      // server at localhost:3000 — both Clerk syncHost and the local /api base.
      "http://localhost/*",
      // Clerk frontend API (dev instance) — the extension talks to it directly.
      "https://darling-baboon-13.clerk.accounts.dev/*",
    ],
    ...(browser === "chrome" && {
      key: CRX_PUBLIC_KEY,
      // Lets the web app hand off "restore session" — a page on these origins
      // may message the extension (background onMessageExternal), which opens
      // one window containing every tab. window.open can't do this (popup
      // blockers allow a single tab per click).
      externally_connectable: {
        matches: ["http://localhost/*", "https://bookmark-ai-theta.vercel.app/*"],
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
});
