/**
 * Every link the dashboard can produce, in ONE place.
 *
 * The dashboard owns no data views of its own — each card hands off to the
 * library, which reads all of its state from the URL. Keeping the builders here
 * means the whole click-through contract is auditable at a glance (and testable
 * by QA against docs/features/dashboard.md) instead of scattered as string
 * literals across the cards.
 *
 * There are exactly FIVE destinations now, one per card plus the omnibox's two:
 * live, sessions, all bookmarks, a category filter, and search/Ask AI. Facet
 * builders for tag/browser/device went with the cards that used them — the
 * sidebar owns those filters.
 */

/** The library grid — what used to live at bare `/app`. */
export const LIBRARY_PATH = "/app/library";
/** The dashboard itself. */
export const DASHBOARD_PATH = "/app";

function href(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return search.size ? `${LIBRARY_PATH}?${search}` : LIBRARY_PATH;
}

/** All bookmarks, unfiltered. */
export const allBookmarksHref = (): string => LIBRARY_PATH;

/** Hybrid search results for `q` (the omnibox). */
export const searchHref = (q: string): string => href({ q: q.trim() });

/** The library with the Ask AI dock open and EMPTY — the chat deliberately does
 * not auto-fire a question (see library-page's AI_PARAM comment). */
export const askAiHref = (): string => href({ ai: "1" });

export const categoryHref = (category: string): string => href({ category });

/** Live open tabs from every device (library `?section=live`). */
export const liveHref = (): string => href({ section: "live" });
/** Saved sessions (library `?section=sessions`). */
export const sessionsHref = (): string => href({ section: "sessions" });
