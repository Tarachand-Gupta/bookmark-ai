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
  ProvisioningError,
  searchBookmarks,
  type LibraryFilters,
} from "@/lib/api";

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /**
   * The account's DB is still being created and we're polling for it. Never true
   * at the same time as `error` — the UI shows a calm "setting up" state instead.
   */
  provisioning: boolean;
}

/**
 * A fresh signup lands here milliseconds after the Clerk redirect, so the first
 * requests can beat tenant provisioning (~1-2s) and 503. That is a normal part
 * of signup, not an error, so we poll it out: retry every RETRY_MS for up to
 * MAX_MS, then give up and fall back to the ordinary error path so a permanently
 * broken account can't spin forever.
 */
const PROVISION_RETRY_MS = 1_500;
const PROVISION_MAX_MS = 60_000;

/** Abort-aware sleep. Resolves false when the signal fired → caller must stop
 * (this is what keeps a retry loop from outliving its unmount/re-render). */
function delay(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function useAsync<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
    provisioning: false,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null, provisioning: false }));

    void (async () => {
      const deadline = Date.now() + PROVISION_MAX_MS;
      for (;;) {
        try {
          const data = await fetcher(controller.signal);
          if (controller.signal.aborted) return;
          setState({ data, loading: false, error: null, provisioning: false });
          return;
        } catch (err) {
          const e = err as Error;
          if (e.name === "AbortError") return;
          if (e instanceof ProvisioningError && Date.now() < deadline) {
            setState((s) => ({ ...s, loading: true, error: null, provisioning: true }));
            if (!(await delay(PROVISION_RETRY_MS, controller.signal))) return;
            continue;
          }
          setState({ data: null, loading: false, error: e.message, provisioning: false });
          return;
        }
      }
    })();

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
  /** See AsyncState.provisioning — the account's DB is still being created. */
  provisioning: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

export function useBookmarks(filters: LibraryFilters, refreshKey: number): BookmarkListState {
  const [state, setState] = useState<
    Pick<
      BookmarkListState,
      "bookmarks" | "total" | "loading" | "loadingMore" | "error" | "provisioning"
    >
  >({
    bookmarks: null,
    total: 0,
    loading: true,
    loadingMore: false,
    error: null,
    provisioning: false,
  });
  const abortRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback(
    (offset: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState((s) =>
        offset === 0
          ? { ...s, loading: true, error: null, provisioning: false }
          : { ...s, loadingMore: true },
      );

      void (async () => {
        const deadline = Date.now() + PROVISION_MAX_MS;
        for (;;) {
          try {
            const res = await listBookmarks(filters, { limit: PAGE_SIZE, offset }, controller.signal);
            if (controller.signal.aborted) return;
            setState((s) => ({
              bookmarks: offset === 0 ? res.bookmarks : [...(s.bookmarks ?? []), ...res.bookmarks],
              total: res.total,
              loading: false,
              loadingMore: false,
              error: null,
              provisioning: false,
            }));
            return;
          } catch (err) {
            const e = err as Error;
            if (e.name === "AbortError") return;
            if (e instanceof ProvisioningError && Date.now() < deadline) {
              // Only reachable on the first page in practice — a not-yet-created
              // account has nothing to page past — so leave "load more" alone.
              setState((s) =>
                offset === 0 ? { ...s, loading: true, error: null, provisioning: true } : s,
              );
              if (!(await delay(PROVISION_RETRY_MS, controller.signal))) return;
              continue;
            }
            setState((s) =>
              offset === 0
                ? {
                    bookmarks: null,
                    total: 0,
                    loading: false,
                    loadingMore: false,
                    error: e.message,
                    provisioning: false,
                  }
                : // Keep the loaded pages; the button stays visible as the retry affordance.
                  { ...s, loadingMore: false },
            );
            return;
          }
        }
      })();
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
