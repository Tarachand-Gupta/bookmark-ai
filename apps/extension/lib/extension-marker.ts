/**
 * DOM presence marker — how the web app detects the extension on browsers where
 * a PAGE CANNOT MESSAGE AN EXTENSION AT ALL.
 *
 * Chrome pings the background over `externally_connectable`
 * (`chrome.runtime.sendMessage(id, {type: BOOKMARK_AI_PING})`). That channel does
 * not exist everywhere:
 *   - **Firefox** does not implement `externally_connectable` — neither
 *     `runtime.sendMessage` nor `runtime.connect` is exposed to web pages
 *     (Firefox bug 1319168). There is nothing to ping.
 *   - **Safari** partitions the extension from the page hard enough that we
 *     already run a content script there (`bridge.content.ts`), so a marker is
 *     both cheaper and more certain than a messaging handshake.
 *
 * So on those two targets a tiny content script stamps an attribute on
 * `<html>` and the web app reads it synchronously. Attribute name/value are
 * MIRRORED in `apps/web/lib/extension-detect.ts` (`EXTENSION_MARKER_ATTR`) —
 * change one, change the other or detection silently goes dark.
 *
 * Kept free of `wxt/browser`/`#imports` so it is unit-testable in plain Node.
 */

export const EXTENSION_MARKER_ATTR = "data-bookmark-ai-extension";
export const EXTENSION_MARKER_VALUE = "1";

/** How long to keep re-asserting the marker after injection. A content script
 * can land BEFORE React hydrates, and hydrating the document root is the one
 * case where React may drop an attribute it doesn't know about — so we watch
 * briefly and put it back rather than trusting the first write. */
export const MARKER_REASSERT_MS = 10_000;

/** Minimal shape we need from a `Document` — keeps the unit test dependency-free. */
export interface MarkerRoot {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

/**
 * Stamp the marker on the document root. Idempotent: returns `true` only when
 * it actually had to write, so a caller can tell a fresh mark from a re-run
 * (double-injected content script) without reading the DOM twice.
 */
export function markExtensionPresent(root: MarkerRoot | null | undefined): boolean {
  if (!root) return false;
  if (root.getAttribute(EXTENSION_MARKER_ATTR) === EXTENSION_MARKER_VALUE) return false;
  root.setAttribute(EXTENSION_MARKER_ATTR, EXTENSION_MARKER_VALUE);
  return true;
}

/**
 * Mark now, then re-mark if something strips the attribute within
 * `MARKER_REASSERT_MS` (see above). Returns a stop function; the observer also
 * stops itself once the window elapses, so the page carries no long-lived work.
 * Degrades to a single mark where `MutationObserver` is unavailable.
 */
export function keepExtensionMarked(doc: Document, windowMs = MARKER_REASSERT_MS): () => void {
  markExtensionPresent(doc.documentElement);

  const Observer = (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver;
  if (!Observer) return () => {};

  const observer = new Observer(() => markExtensionPresent(doc.documentElement));
  observer.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: [EXTENSION_MARKER_ATTR],
  });
  const timer = setTimeout(() => observer.disconnect(), windowMs);
  return () => {
    clearTimeout(timer);
    observer.disconnect();
  };
}
