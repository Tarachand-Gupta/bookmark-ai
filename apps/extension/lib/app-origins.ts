/**
 * Bookmark AI web-app page origins, as match patterns — the ONE list of "pages
 * that are allowed to talk to this extension".
 *
 * Imported by BOTH `wxt.config.ts` (Chrome `externally_connectable.matches`) and
 * `entrypoints/marker.content.ts` (the presence-marker content script), so the
 * two detection channels can never drift apart. Keep it dependency-free: the WXT
 * config loader imports this module outside the extension bundle, so it must not
 * pull in `wxt/browser`, `#imports` or anything else browser-flavored.
 *
 * Ports are ignored in match patterns, so `http://localhost/*` covers the web dev
 * server on :3000. The vercel aliases are the preview/dev deployments.
 */
export const APP_PAGE_MATCHES = [
  "http://localhost/*",
  "https://bookmark-ai-theta.vercel.app/*",
  "https://bookmark-ai-dev.vercel.app/*",
  "https://bookmark-ai.cloud/*",
  "https://www.bookmark-ai.cloud/*",
] as const;
