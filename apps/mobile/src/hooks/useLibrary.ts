import { useCallback, useEffect, useRef, useState } from "react";
import type { Bookmark, MetaResponse, SearchMode } from "@bookmark-ai/types";
import { getMeta, listBookmarks, searchBookmarks, type LibraryFilters } from "../api";

const PAGE_SIZE = 30;

export interface LibraryState {
  meta: MetaResponse | null;
  bookmarks: Bookmark[];
  total: number;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** Non-empty query switches the list to search results (like the web app). */
  query: string;
  mode: SearchMode;
  searching: boolean;
  setQuery: (q: string) => void;
  setMode: (m: SearchMode) => void;
  filters: LibraryFilters;
  setFilter: (key: keyof LibraryFilters, value: string | undefined) => void;
  refresh: () => void;
  loadMore: () => void;
}

/** One hook = the library's data story: meta facets, filtered pagination,
 * debounced text/AI search. Mirrors apps/web's library-page behavior. */
export function useLibrary(): LibraryState {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("text");
  const [searching, setSearching] = useState(false);
  const [filters, setFilters] = useState<LibraryFilters>({});
  const [reloadKey, setReloadKey] = useState(0);
  // Guards stale async writes: only the latest load may touch state.
  const loadId = useRef(0);
  const offsetRef = useRef(0);
  const loadingMoreRef = useRef(false);

  const loadMeta = useCallback(() => {
    getMeta()
      .then(setMeta)
      .catch(() => {});
  }, []);

  useEffect(loadMeta, [loadMeta, reloadKey]);

  useEffect(() => {
    const id = ++loadId.current;
    const q = query.trim();
    offsetRef.current = 0;

    if (!q) {
      setSearching(false);
      setLoading(true);
      listBookmarks(filters, { limit: PAGE_SIZE, offset: 0 })
        .then((data) => {
          if (loadId.current !== id) return;
          setBookmarks(data.bookmarks);
          setTotal(data.total);
          setError(null);
        })
        .catch((err: unknown) => {
          if (loadId.current === id) setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (loadId.current === id) {
            setLoading(false);
            setRefreshing(false);
          }
        });
      return;
    }

    // Debounced search; AI mode waits a touch longer (embedding round-trip).
    setSearching(true);
    const timer = setTimeout(
      () => {
        searchBookmarks(q, mode)
          .then((data) => {
            if (loadId.current !== id) return;
            setBookmarks(data.results.map((r) => r.bookmark));
            setTotal(data.results.length);
            setError(null);
          })
          .catch((err: unknown) => {
            if (loadId.current === id) setError(err instanceof Error ? err.message : String(err));
          })
          .finally(() => {
            if (loadId.current === id) {
              setSearching(false);
              setRefreshing(false);
            }
          });
      },
      mode === "ai" ? 450 : 250,
    );
    return () => clearTimeout(timer);
  }, [query, mode, filters, reloadKey]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setReloadKey((k) => k + 1);
  }, []);

  const loadMore = useCallback(() => {
    if (query.trim() || loadingMoreRef.current) return;
    const nextOffset = offsetRef.current + PAGE_SIZE;
    if (nextOffset >= total) return;
    loadingMoreRef.current = true;
    offsetRef.current = nextOffset;
    listBookmarks(filters, { limit: PAGE_SIZE, offset: nextOffset })
      .then((data) => {
        setBookmarks((prev) => {
          const seen = new Set(prev.map((b) => b.id));
          return [...prev, ...data.bookmarks.filter((b) => !seen.has(b.id))];
        });
        setTotal(data.total);
      })
      .catch(() => {
        offsetRef.current = nextOffset - PAGE_SIZE;
      })
      .finally(() => {
        loadingMoreRef.current = false;
      });
  }, [filters, query, total]);

  const setFilter = useCallback((key: keyof LibraryFilters, value: string | undefined) => {
    setFilters((prev) => ({ ...prev, [key]: prev[key] === value ? undefined : value }));
  }, []);

  return {
    meta,
    bookmarks,
    total,
    loading,
    refreshing,
    error,
    query,
    mode,
    searching,
    setQuery,
    setMode,
    filters,
    setFilter,
    refresh,
    loadMore,
  };
}
