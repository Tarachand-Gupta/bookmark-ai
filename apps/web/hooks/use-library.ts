"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Bookmark,
  HealthResponse,
  ListSessionsResponse,
  MetaResponse,
  SearchMode,
  SearchResponse,
} from "@bookmark-ai/types";
import {
  getHealth,
  getMeta,
  getSessions,
  listBookmarks,
  searchBookmarks,
  type LibraryFilters,
} from "@/lib/api";

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function useAsync<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null });

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher(controller.signal)
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          setState({ data: null, loading: false, error: err.message });
        }
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

/** Bump to refetch everything after a mutation (save/delete). */
export function useRefresh(): [number, () => void] {
  const [key, setKey] = useState(0);
  const refresh = useCallback(() => setKey((k) => k + 1), []);
  return [key, refresh];
}

export function useMeta(refreshKey: number): AsyncState<MetaResponse> {
  return useAsync((signal) => getMeta(signal), [refreshKey]);
}

/** Real AI availability from /api/health — /api/meta succeeding says nothing about it. */
export function useHealth(refreshKey: number): AsyncState<HealthResponse> {
  return useAsync((signal) => getHealth(signal), [refreshKey]);
}

export function useSessions(refreshKey: number): AsyncState<ListSessionsResponse> {
  return useAsync((signal) => getSessions(signal), [refreshKey]);
}

const PAGE_SIZE = 100;

export interface BookmarkListState {
  bookmarks: Bookmark[] | null;
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
}

export function useBookmarks(filters: LibraryFilters, refreshKey: number): BookmarkListState {
  const [state, setState] = useState<
    Pick<BookmarkListState, "bookmarks" | "total" | "loading" | "loadingMore" | "error">
  >({ bookmarks: null, total: 0, loading: true, loadingMore: false, error: null });
  const abortRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback(
    (offset: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState((s) =>
        offset === 0 ? { ...s, loading: true, error: null } : { ...s, loadingMore: true },
      );
      listBookmarks(filters, { limit: PAGE_SIZE, offset }, controller.signal)
        .then((res) =>
          setState((s) => ({
            bookmarks: offset === 0 ? res.bookmarks : [...(s.bookmarks ?? []), ...res.bookmarks],
            total: res.total,
            loading: false,
            loadingMore: false,
            error: null,
          })),
        )
        .catch((err: Error) => {
          if (err.name === "AbortError") return;
          setState((s) =>
            offset === 0
              ? {
                  bookmarks: null,
                  total: 0,
                  loading: false,
                  loadingMore: false,
                  error: err.message,
                }
              : // Keep the loaded pages; the button stays visible as the retry affordance.
                { ...s, loadingMore: false },
          );
        });
    },
    [filters],
  );

  useEffect(() => {
    fetchPage(0);
    return () => abortRef.current?.abort();
  }, [fetchPage, refreshKey]);

  const loaded = state.bookmarks?.length ?? 0;
  const hasMore = state.bookmarks !== null && loaded < state.total;

  return {
    ...state,
    hasMore,
    loadMore: () => {
      if (!state.loading && !state.loadingMore && hasMore) fetchPage(loaded);
    },
  };
}

const EMPTY_SEARCH: SearchResponse = { mode: "text", results: [] };

export function useSearch(
  q: string,
  mode: SearchMode,
  refreshKey: number,
): AsyncState<SearchResponse> {
  const trimmed = q.trim();
  return useAsync(
    async (signal) => {
      if (!trimmed) return EMPTY_SEARCH;
      // Debounce: hybrid search embeds the query server-side, so don't
      // spend a Gemini call on every keystroke.
      await new Promise((r) => setTimeout(r, 350));
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      return searchBookmarks(trimmed, mode, signal);
    },
    [trimmed, mode, refreshKey],
  );
}
