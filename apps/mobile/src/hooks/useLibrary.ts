import { useCallback, useEffect, useRef, useState } from "react";
import type { Bookmark, MetaResponse } from "@bookmark-ai/types";
import { getMeta, listBookmarks, type LibraryFilters } from "../api";
import { usePreferences } from "../context/PreferencesContext";

const PAGE_SIZE = 30;

export interface LibraryState {
  meta: MetaResponse | null;
  bookmarks: Bookmark[];
  total: number;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  filters: LibraryFilters;
  activeFilterCount: number;
  setFilter: (key: keyof LibraryFilters, value: string | undefined) => void;
  clearFilters: () => void;
  refresh: () => void;
  loadMore: () => void;
}

/** The Library tab's data story: meta facets + filtered, paginated list.
 * (Search lives in its own tab — see useSearch.) */
export function useLibrary(): LibraryState {
  const { serverTarget } = usePreferences(); // switching servers refetches
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<LibraryFilters>({});
  const [reloadKey, setReloadKey] = useState(0);
  // Guards stale async writes: only the latest load may touch state.
  const loadId = useRef(0);
  const offsetRef = useRef(0);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    getMeta()
      .then(setMeta)
      .catch(() => {});
  }, [reloadKey, serverTarget]);

  useEffect(() => {
    const id = ++loadId.current;
    offsetRef.current = 0;
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
  }, [filters, reloadKey, serverTarget]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setReloadKey((k) => k + 1);
  }, []);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current) return;
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
  }, [filters, total]);

  const setFilter = useCallback((key: keyof LibraryFilters, value: string | undefined) => {
    setFilters((prev) => ({ ...prev, [key]: prev[key] === value ? undefined : value }));
  }, []);

  const clearFilters = useCallback(() => setFilters({}), []);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return {
    meta,
    bookmarks,
    total,
    loading,
    refreshing,
    error,
    filters,
    activeFilterCount,
    setFilter,
    clearFilters,
    refresh,
    loadMore,
  };
}
