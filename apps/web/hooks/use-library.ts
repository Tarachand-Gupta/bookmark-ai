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
  ForbiddenError,
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
  /**
   * The signed-in account isn't on the API allowlist (server 403). Set alongside
   * `error`, but the UI branches on this first to show a distinct "no access /
   * switch account" state instead of the generic "check you're signed in" error.
   */
  forbidden: boolean;
}

/**
 * A fresh signup lands here milliseconds after the Clerk redirect, so the first
 * requests can beat tenant provisioning (~10-15s for a new Turso DB) and 503.
 * That is a normal part of signup, not an error, so we poll it out: re-fire the
 * SAME failed request every RETRY_MS for up to MAX_MS, then give up and fall back
 * to the ordinary error path so a permanently broken account can't spin forever.
 * While it polls, every consumer of these hooks reports `provisioning` and the
 * page shows one branded screen (components/library/account-setup.tsx).
 *
 * 2s is the interval the provisioning screen is written around — fast enough that
 * the app appears the moment the DB lands, slow enough that a 15s wait is ~7
 * requests, not 10.
 */
const PROVISION_RETRY_MS = 2_000;
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

/**
 * An in-memory (per page load) last-good value for a hook, so a component that
 * REMOUNTS can paint immediately and revalidate behind it. Only used for /api/meta
 * today: the sidebar shell is shared by the dashboard (/app) and the library
 * (/app/library), and each route mounts its own copy — without this the facet
 * counts flashed back to skeletons on every Home ↔ Library hop.
 *
 * Deliberately module scope, not localStorage: it's a same-session paint
 * optimization, never persisted state, so it can't go stale across visits or leak
 * between accounts.
 */
interface MemoryCache<T> {
  get(): T | null;
  set(value: T): void;
}

function useAsync<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  cache?: MemoryCache<T>,
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    // Empty on the first ever mount (and therefore identical on server and
    // client, so this can't hydration-mismatch); populated only on a remount
    // after a successful fetch earlier in the same page load.
    data: cache?.get() ?? null,
    loading: true,
    error: null,
    provisioning: false,
    forbidden: false,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null, provisioning: false, forbidden: false }));

    void (async () => {
      const deadline = Date.now() + PROVISION_MAX_MS;
      for (;;) {
        try {
          const data = await fetcher(controller.signal);
          if (controller.signal.aborted) return;
          cache?.set(data);
          setState({ data, loading: false, error: null, provisioning: false, forbidden: false });
          return;
        } catch (err) {
          const e = err as Error;
          if (e.name === "AbortError") return;
          if (e instanceof ProvisioningError && Date.now() < deadline) {
            setState((s) => ({ ...s, loading: true, error: null, provisioning: true, forbidden: false }));
            if (!(await delay(PROVISION_RETRY_MS, controller.signal))) return;
            continue;
          }
          setState({
            data: null,
            loading: false,
            error: e.message,
            provisioning: false,
            forbidden: e instanceof ForbiddenError,
          });
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

/** Last-good facets for this page load — see MemoryCache. */
let metaCache: MetaResponse | null = null;

export function useMeta(refreshKey: number): AsyncState<MetaResponse> {
  return useAsync((signal) => getMeta(signal), [refreshKey], {
    get: () => metaCache,
    set: (value) => {
      metaCache = value;
    },
  });
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
  /** See AsyncState.forbidden — the account isn't on the API allowlist. */
  forbidden: boolean;
  /**
   * The list on screen was fetched with a DIFFERENT filter set than the one now
   * requested (a facet click), so it's about to be replaced wholesale rather than
   * refreshed — the caller shows a skeleton instead of dimming stale rows. True
   * on the very render the filters change, before the fetch effect has even run,
   * which is what makes the skeleton land on the same frame as the click.
   */
  freshFilter: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

/** Stable identity of a filter set — key order independent, so it only changes
 * when a facet value actually changes. */
function filterKey(filters: LibraryFilters): string {
  return Object.keys(filters)
    .sort()
    .map((k) => `${k}=${filters[k as keyof LibraryFilters]}`)
    .join("&");
}

export function useBookmarks(filters: LibraryFilters, refreshKey: number): BookmarkListState {
  const key = filterKey(filters);
  const [state, setState] = useState<
    Pick<
      BookmarkListState,
      "bookmarks" | "total" | "loading" | "loadingMore" | "error" | "provisioning" | "forbidden"
    > & {
      /** Filter key the settled `bookmarks` belong to; null until the first load. */
      loadedKey: string | null;
    }
  >({
    bookmarks: null,
    total: 0,
    loading: true,
    loadingMore: false,
    error: null,
    provisioning: false,
    forbidden: false,
    loadedKey: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback(
    (offset: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState((s) =>
        offset === 0
          ? { ...s, loading: true, error: null, provisioning: false, forbidden: false }
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
              forbidden: false,
              loadedKey: key,
            }));
            return;
          } catch (err) {
            const e = err as Error;
            if (e.name === "AbortError") return;
            if (e instanceof ProvisioningError && Date.now() < deadline) {
              // Only reachable on the first page in practice — a not-yet-created
              // account has nothing to page past — so leave "load more" alone.
              setState((s) =>
                offset === 0
                  ? { ...s, loading: true, error: null, provisioning: true, forbidden: false }
                  : s,
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
                    forbidden: e instanceof ForbiddenError,
                    // Settle the key even on failure, so the error surface isn't
                    // stuck behind a "new filter loading" skeleton.
                    loadedKey: key,
                  }
                : // Keep the loaded pages; the button stays visible as the retry affordance.
                  { ...s, loadingMore: false },
            );
            return;
          }
        }
      })();
    },
    [filters, key],
  );

  useEffect(() => {
    fetchPage(0);
    return () => abortRef.current?.abort();
  }, [fetchPage, refreshKey]);

  const loaded = state.bookmarks?.length ?? 0;
  const hasMore = state.bookmarks !== null && loaded < state.total;
  const { loadedKey, ...rest } = state;

  return {
    ...rest,
    freshFilter: loadedKey !== null && loadedKey !== key,
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
