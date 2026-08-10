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
  /** Chip/sheet behavior: tapping the value that's already active clears it. */
  setFilter: (key: keyof LibraryFilters, value: string | undefined) => void;
  /**
   * Set a filter to exactly this value, with no toggle. For programmatic
   * arrivals (Home's "Reading queue → See all"), where `setFilter` would clear
   * the filter whenever the same tag happened to be active already.
   */
  setFilterExact: (key: keyof LibraryFilters, value: string | undefined) => void;
  clearFilters: () => void;
  refresh: () => void;
  loadMore: () => void;
}

/** Refetch on tab focus once the data is older than this — same constant Home
 * uses, so "See all" from Home can never land on staler data than Home shows. */
const STALE_AFTER_MS = 60_000;

/** The Library tab's data story: meta facets + filtered, paginated list.
 * (Search lives in its own tab — see useSearch.)
 * @param active whether Library is the foreground tab (gates the staleness
 * refetch; screens stay mounted behind the tab switcher, so mount-only
 * fetching went stale the moment another tab saved a bookmark). */
export function useLibrary(active: boolean): LibraryState {
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
  const fetchedAt = useRef(0);
  // A focus-triggered reload keeps the current list on screen (no skeleton
  // flash) — the flag is consumed by the load effect below.
  const silentReload = useRef(false);

  useEffect(() => {
    getMeta()
      .then(setMeta)
      .catch(() => {});
  }, [reloadKey, serverTarget]);

  // Focus staleness: arriving on the tab with old data refetches quietly.
  useEffect(() => {
    if (!active) return;
    if (Date.now() - fetchedAt.current < STALE_AFTER_MS) return;
    silentReload.current = true;
    setReloadKey((k) => k + 1);
  }, [active]);

  useEffect(() => {
    const id = ++loadId.current;
    offsetRef.current = 0;
    const silent = silentReload.current;
    silentReload.current = false;
    if (!silent) setLoading(true);
    listBookmarks(filters, { limit: PAGE_SIZE, offset: 0 })
      .then((data) => {
        if (loadId.current !== id) return;
        fetchedAt.current = Date.now();
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

  const setFilterExact = useCallback((key: keyof LibraryFilters, value: string | undefined) => {
    setFilters((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
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
    setFilterExact,
    clearFilters,
    refresh,
    loadMore,
  };
}
