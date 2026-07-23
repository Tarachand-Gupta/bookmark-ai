/**
 * The ONLY safe way to turn a stored/remote URL into an anchor `href`.
 *
 * Bookmark, saved-session, and live-tab URLs are permissive `z.string()` in the
 * type contracts (XSS is defended here, at the render layer, not at ingest), so
 * a crafted `javascript:`/`data:` URL can reach a tab list via import or a raw
 * POST. Anything but http(s) returns `undefined` — callers must render plain
 * text (not a link) when this returns undefined, never fall back to the raw URL.
 */
export function safeHref(url: string): string | undefined {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}
