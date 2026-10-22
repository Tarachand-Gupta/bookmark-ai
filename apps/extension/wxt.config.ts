import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";
import { appPageMatchesFor, hostPermissionsFor } from "./lib/app-origins";

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
  supabaseQa: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvYL1vdGdg0WEPeSvFaEa20cahB9rpwxvsK7O0IR+/ME5XbwDT9pyURFr3PpwvbBJTKJaf75d0ipj19S2Fspxu6Puae1w5JRPFYK2v+iFl1LaimLxH8lL6PMnYd8d0trPLV9AY1ptBeptwdi8gmp2D6kikWuYFhZsquZ0nR3FIyr171pHwZOaNqADBiBQ1iCBqugbKEzsSA5H7ULT4PH4GNhOthrSB9aX8S2IoBTSmQMFJ0tshoqPOzZ6cQzUiV3KqsaxkEnp4Bt70YFWwyzXYfBZyc2pXiuLgK3TEBEbt4ucsJUBBjqXCRq84ClJEw1RE9Vzt9Hty8oE8lFB9vJexwIDAQAB",
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
  "supabase-qa": { key: CRX_KEYS.supabaseQa, name: "Bookmark AI Supabase QA", iconDir: "icon-dev" },
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

export default defineConfig({
  ...(process.env.BOOKMARK_BUILD_VARIANT === "supabase-qa" ? {
    outDir: ".output-supabase-qa",
  } : {}),
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
    ...(process.env.BOOKMARK_BUILD_VARIANT === "supabase-qa" ? { cacheDir: ".cache-supabase-qa/vite" } : {}),
  }),
  zip: {
    // WXT's own `-sources.zip` (Firefox default) holds only apps/extension —
    // no packages/types, no lockfile — so a reviewer can't rebuild from it.
    // `scripts/store-zip.mjs` (`pnpm zip:store`) writes the real AMO sources
    // archive under the same name; keep WXT from racing it.
    zipSources: false,
  },
  manifest: ({ browser, manifestVersion, mode }) => {
    if (mode === "supabase-qa" && (!process.env.BOOKMARK_QA_STAGE_ROOT || process.env.BOOKMARK_BUILD_VARIANT !== "supabase-qa")) {
      throw new Error("Supabase QA extension must use scripts/supabase-qa.mjs");
    }
    const qa = mode === "supabase-qa";
    const production = mode === "production" && process.env.BOOKMARK_BUILD_VARIANT === "supabase-production";
    if (production && (!process.env.BOOKMARK_PRODUCTION_STAGE_ROOT || process.env.WXT_AUTH_PROVIDER !== "supabase" || process.env.WXT_API_URL !== "https://www.bookmark-ai.cloud" || process.env.WXT_LIVE_URL !== "https://live.bookmark-ai.cloud" || process.env.WXT_SUPABASE_URL !== "https://xogqaqtyacmecdbmgqqd.supabase.co")) {
      throw new Error("Production Supabase extension requires validated frozen production staging");
    }
    const supabase = qa || production;
    const qaHosts = [process.env.WXT_API_URL, process.env.WXT_LIVE_URL, process.env.WXT_SUPABASE_URL]
      .filter((url): url is string => !!url).map((url) => `${new URL(url).origin}/*`);
    const qaPages = [`${new URL(process.env.WXT_API_URL || "http://localhost:3100").origin}/*`];
    return ({
    name: targetFor(mode).name,
    icons: iconsFor(mode),
    // WXT generates the toolbar action from the popup entrypoint with only
    // default_title/default_popup; these explicit sizes are the AMO
    // listing-icon fix (Bugzilla 1842447 — no default_icon, no listing icon).
    // MV2 (Firefox) keys it browser_action, MV3 action — same split as
    // `commands` below.
    ...(manifestVersion === 2
      ? { browser_action: { default_icon: iconsFor(mode) } }
      : { action: { default_icon: iconsFor(mode) } }),
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
    // `bookmarks` is optional: importing and future mirroring have separate consent.
    // Safari exposes no bookmarks API and never declares it.
    // `readingList` (Chrome 120-only) mirrors Reading List additions.
    // `nativeMessaging` (Safari-only) lets the background tell the Mac companion
    // app who is signed in (lib/native-auth-report.ts →
    // safari-app/Extension/SafariWebExtensionHandler.swift → App Group suite);
    // identity only, never a token. Chrome/Firefox manifests are unchanged.
    permissions: [
      "activeTab",
      "tabs",
      "storage",
      "alarms",
      ...(!supabase ? ["cookies"] : []),
      ...(supabase && browser !== "safari" ? ["identity"] : []),
      ...(browser === "chrome" ? ["readingList", "tabGroups"] : []),
      // `webRequest`/`webRequestBlocking` (Firefox-only, MV2): the ONE thing
      // they are used for is stripping the `Origin` header off the extension's
      // OWN requests to the Clerk frontend API — Firefox stamps
      // `Origin: moz-extension://<per-install UUID>` on every non-GET background
      // fetch and Clerk 400s an un-allowlisted Origin, which killed session-JWT
      // minting (and therefore live tabs) on the production instance. The
      // listener is filtered to the Clerk FAPI host alone and reads nothing;
      // see lib/clerk-origin-strip.ts. Chrome's extension id IS allowlisted, so
      // neither permission is requested there.
      ...(browser === "firefox" ? [...(!supabase ? ["webRequest", "webRequestBlocking"] : [])] : []),
      ...(browser === "safari" ? ["scripting", "nativeMessaging"] : []),
    ],
    optional_permissions: browser === "safari" ? [] : ["bookmarks"],
    // MODE-AWARE (lib/app-origins.ts): a `production` build — every store zip —
    // lists ONLY the four prod origins (apex + www, prod Clerk FAPI, live);
    // `development`/`dev-remote` add localhost, the dev deployment and the dev
    // Clerk FAPI. On the MV2 (Firefox) target WXT folds these into
    // `permissions`, where Firefox expects host patterns in MV2;
    // `lib/manifest-shim.ts` re-derives a `host_permissions` view from whatever
    // host patterns are present at runtime for the Clerk SDK.
    host_permissions: supabase ? qaHosts : [...hostPermissionsFor(mode)],
    ...(browser === "chrome" && {
      // Per-target key → distinct, stable id per install (prod/dev/local).
      key: targetFor(mode).key,
      // Lets the web app hand off "restore session" — a page on these origins
      // may message the extension (background onMessageExternal), which opens
      // one window containing every tab. window.open can't do this (popup
      // blockers allow a single tab per click). The same channel answers the
      // web app's installed-check ping (BOOKMARK_AI_PING).
      // CHROME ONLY, and it has to stay that way:
      //   - Firefox implements NO web-page→extension messaging (the key is
      //     ignored, `runtime.sendMessage`/`connect` are never exposed to pages
      //     — Firefox bug 1319168), so declaring it there would ship a channel
      //     that cannot work.
      //   - Safari would accept the key, but the extension already runs a
      //     content script on these origins.
      // Both of those targets get `entrypoints/marker.content.ts` instead, which
      // stamps a `<html>` attribute the page reads synchronously.
      // Mode-aware like host_permissions: production = apex + www only.
      externally_connectable: { matches: supabase ? qaPages : [...appPageMatchesFor(mode)] },
    }),
    ...(browser === "firefox" && {
      browser_specific_settings: {
        gecko: {
          id: qa ? "bookmark-ai-supabase-qa@bookmark-ai.cloud" : "bookmark-ai@bookmark-ai.cloud",
          // Firefox 140 introduced the desktop built-in data-consent UI that
          // renders `data_collection_permissions`; AMO asks new submissions
          // declaring any collection to require it. Android gained the same UI
          // in 142, so its separate floor below must not inherit 140.
          strict_min_version: "140.0",
          // TRUTHFUL declaration — AMO rejects a new add-on whose declaration
          // understates what it does (mandatory since Nov 2025). Each category
          // maps to a real code path:
          // - authenticationInfo: the background mirrors the user's Clerk
          //   sign-in (createClerkClient syncHost + lib/native-session.ts
          //   `__client` cookie) and mints/stores a device token
          //   (lib/device-token.ts) that authenticates every API call.
          // - bookmarksInfo: saving the current tab (entrypoints/background.ts
          //   SAVE_BOOKMARK → POST /api/bookmarks) and mirroring native bookmark
          //   add/remove into the library (lib/native-sync.ts).
          // - browsingActivity: whole-window tab snapshots (SAVE_SESSION →
          //   POST /api/sessions) and, opt-in only, streaming the window's open
          //   tabs as a live session (lib/live-*.ts, LIVE_SET_ENABLED).
          // Server-observed product counts are optional analytics. The native
          // install/about:addons control is checked on every main API request;
          // missing/denied consent disables Firefox product events server-side.
          data_collection_permissions: {
            required: ["authenticationInfo", "bookmarksInfo", "browsingActivity"],
            optional: ["technicalAndInteraction"],
          },
        },
        gecko_android: {
          strict_min_version: "142.0",
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
  });
  },
  hooks: {
    "build:manifestGenerated": (_wxt, manifest) => {
      if (!["supabase-qa", "supabase-production"].includes(process.env.BOOKMARK_BUILD_VARIANT || "")) return;
      // QA presence/auth bridges must never inject into an existing production tab.
      const page = `${new URL(process.env.WXT_API_URL!).origin}/*`;
      for (const script of manifest.content_scripts ?? []) script.matches = [page];
    },
  },
  // NO MV2 `host_permissions` re-add hook — it used to patch the written
  // firefox-mv2/manifest.json with a top-level `host_permissions` key so that
  // @clerk/chrome-extension's validateManifest (which demands the key when
  // syncHost is set) would pass. It never could: Firefox's
  // `runtime.getManifest()` returns the NORMALIZED manifest, and normalization
  // drops keys the manifest version doesn't support, so the SDK still threw
  // "Missing host_permissions" on Firefox (verified 2026-09-03 via the
  // background diag with the key present in the file). The runtime fix lives
  // in lib/manifest-shim.ts (background.ts, firefox target only); the popup no
  // longer mounts a Clerk client at all (entrypoints/popup/main.tsx). Safari is
  // built as MV3 (`build:safari --mv3` — Safari 26 no longer starts MV2
  // background pages) and keeps the key natively.
});
