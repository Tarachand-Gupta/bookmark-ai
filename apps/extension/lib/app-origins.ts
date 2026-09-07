/**
 * Origins per BUILD TARGET — the one place that decides which hosts a build may
 * reach (`host_permissions`) and which web-app pages may talk to it
 * (`externally_connectable.matches` on Chrome, the presence-marker content
 * script's `matches` on Firefox/Safari).
 *
 * Imported by `wxt.config.ts` (manifest) AND `entrypoints/marker.content.ts`
 * (content-script options), so the channels can never drift apart. Keep it
 * dependency-free: the WXT config loader imports this module outside the
 * extension bundle, so it must not pull in `wxt/browser`, `#imports`,
 * `import.meta.env` or anything else browser-flavored — callers pass `mode` in.
 *
 * STORE RULE: a `production` build (`pnpm build` / `build:firefox` /
 * `build:safari`, the zips that go to the Chrome Web Store, AMO and the Safari
 * wrapper) requests ONLY the four production origins. Every other mode
 * (`development` = LOCAL target, `dev-remote` = DEV target) gets the full
 * superset, because those installs need localhost + the dev deployment + the
 * dev Clerk instance. Reviewers read every host pattern as a data-access claim,
 * so a dev origin in the store manifest is both a review risk and a lie.
 *
 * Ports are ignored in match patterns, so `http://localhost/*` covers the web
 * dev server on :3000 (and a local live server on :8091).
 */

/** Production web-app pages (what `.env.production`'s WXT_APP_URL and the Clerk
 * syncHost point at — www is canonical, the apex 308s to it). */
export const PROD_APP_PAGE_MATCHES = [
  "https://bookmark-ai.cloud/*",
  "https://www.bookmark-ai.cloud/*",
] as const;

/** Every web-app origin any build target is served from — the dev/local
 * superset. The vercel aliases are the preview/dev deployments. */
export const APP_PAGE_MATCHES = [
  "http://localhost/*",
  "https://bookmark-ai-theta.vercel.app/*",
  "https://bookmark-ai-dev.vercel.app/*",
  ...PROD_APP_PAGE_MATCHES,
] as const;

/**
 * Hosts a PRODUCTION build needs — exactly what `.env.production` points at:
 * - `bookmark-ai.cloud` apex + www — API base (`WXT_APP_URL`) + Clerk syncHost
 *   (`WXT_CLERK_SYNC_HOST`); the apex is kept because the syncHost cookie read
 *   and the 308 → www hop both touch it.
 * - `clerk.bookmark-ai.cloud` — the production Clerk frontend API
 *   (`lib/native-session.ts` reads the `__client` cookie there).
 * - `live.bookmark-ai.cloud` — the Live Sessions server (`WXT_LIVE_API_URL`).
 */
export const PROD_HOST_PERMISSIONS = [
  "https://bookmark-ai.cloud/*",
  "https://www.bookmark-ai.cloud/*",
  "https://clerk.bookmark-ai.cloud/*",
  "https://live.bookmark-ai.cloud/*",
] as const;

/**
 * Hosts the DEV (`dev-remote`) and LOCAL (`development`) targets need — the
 * production set plus:
 * - `http://localhost/*` — the web dev server on :3000 (API base + Clerk
 *   syncHost) and a local live server on :8091.
 * - `bookmark-ai-dev.vercel.app` — the dedicated DEV deployment (`build:dev`
 *   app origin + its Clerk syncHost).
 * - `darling-baboon-13.clerk.accounts.dev` — the dev Clerk instance's frontend API.
 */
export const DEV_HOST_PERMISSIONS = [
  "http://localhost/*",
  "https://bookmark-ai-dev.vercel.app/*",
  "https://darling-baboon-13.clerk.accounts.dev/*",
  ...PROD_HOST_PERMISSIONS,
] as const;

/** WXT env mode of a store build. `wxt build` / `wxt zip` default to it. */
export const PRODUCTION_MODE = "production";

/** Web-app pages allowed to talk to a build in `mode` (see file header). */
export function appPageMatchesFor(mode: string): readonly string[] {
  return mode === PRODUCTION_MODE ? PROD_APP_PAGE_MATCHES : APP_PAGE_MATCHES;
}

/** Hosts a build in `mode` may reach (see file header). */
export function hostPermissionsFor(mode: string): readonly string[] {
  return mode === PRODUCTION_MODE ? PROD_HOST_PERMISSIONS : DEV_HOST_PERMISSIONS;
}
