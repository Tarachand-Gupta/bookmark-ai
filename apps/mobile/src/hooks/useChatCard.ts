import { useCallback, useMemo, useState } from "react";
import { LayoutAnimation } from "react-native";
import type { ToolPageMeta } from "@bookmark-ai/types";
import {
  CARD_COLLAPSED_ROWS,
  CARD_EXPAND_CHUNK,
  filterByText,
  foldState,
  nextFoldShown,
} from "../lib/chatCards";

/**
 * The three bits of state a chat tool card owns — thin `useState` wrappers
 * over the pure fold/filter/page logic in `@bookmark-ai/types`, so a card here
 * folds, filters and pages exactly like its web counterpart
 * (apps/web/components/library/chat-card-parts.tsx).
 */

/** Animate the next layout pass (fold/expand, load more). Cosmetic only — a
 * platform that refuses is silently fine. */
export function animateNextLayout(): void {
  try {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  } catch {
    // cosmetic only
  }
}

/**
 * A group of `total` rows that starts at 10 and opens 25 at a time; "Show
 * less" snaps back to the collapsed size.
 */
export function useFold(total: number, limit = CARD_COLLAPSED_ROWS, chunk = CARD_EXPAND_CHUNK) {
  const [shown, setShown] = useState(limit);
  const { visibleCount, hidden, expanded, nextChunk } = foldState(total, shown, limit, chunk);
  const toggle = useCallback(() => {
    animateNextLayout();
    setShown((n) => nextFoldShown(total, n, limit, chunk));
  }, [total, limit, chunk]);
  return { visibleCount, hidden, expanded, nextChunk, toggle };
}

/** Case-insensitive substring filter over whatever the card has loaded. */
export function useTextFilter<T>(items: readonly T[], haystack: (item: T) => string) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? filterByText(items, haystack, q) : [...items]),
    // `haystack` is an inline closure at every call site; the result depends on the data + query only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, q],
  );
  return { query, setQuery, filtered, active: q.length > 0 };
}

/**
 * "Load next N" for a page of tool results: `fetchPage` hits the same HTTP
 * route the tool used (no model turn), rows accumulate, and the latest page
 * meta drives the footer. A no-op while loading or at the end.
 */
export function useToolPaging<T>(
  initialRows: readonly T[],
  initialPage: ToolPageMeta | undefined,
  fetchPage: (offset: number, limit: number) => Promise<{ rows: T[]; page: ToolPageMeta }>,
) {
  const [rows, setRows] = useState<T[]>(() => [...initialRows]);
  const [page, setPage] = useState<ToolPageMeta | undefined>(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMore = useCallback(async () => {
    if (!page?.hasMore || page.nextOffset === null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchPage(page.nextOffset, page.limit);
      animateNextLayout();
      setRows((prev) => [...prev, ...next.rows]);
      setPage(next.page);
    } catch (err) {
      setError((err as Error).message || "Could not load more.");
    } finally {
      setLoading(false);
    }
  }, [fetchPage, loading, page]);

  return { rows, page, loading, error, loadMore, canLoadMore: page?.hasMore === true };
}
