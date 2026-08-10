import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DashboardResponse } from "@bookmark-ai/types";
import { getDashboard, SERVER_TARGET } from "../api";
import { usePreferences } from "../context/PreferencesContext";

/**
 * Snapshot cache (docs/features/dashboard.md §5 — stale-while-revalidate).
 * Keyed by server target so a dev build never paints the production snapshot
 * (or vice versa) for the first frame.
 */
const CACHE_KEY = `bookmark-ai:dashboard:${SERVER_TARGET}`;

/** Home stays mounted as the landing tab; returning to it after this long
 * refetches silently (the "did my share-sheet save land?" loop). */
const STALE_AFTER_MS = 60_000;

export interface DashboardState {
  data: DashboardResponse | null;
  /** First load with nothing to paint yet — render skeletons, not empty state. */
  loading: boolean;
  /** Pull-to-refresh in flight. */
  refreshing: boolean;
  /**
   * Set ONLY while there is nothing on screen. A refresh that fails over a
   * rendered snapshot stays silent: a slightly stale dashboard beats an error
   * screen on the landing tab.
   */
  error: string | null;
  refresh: () => void;
}

/**
 * The Home tab's data story: one aggregated `GET /api/dashboard`, painted from
 * the last AsyncStorage snapshot instantly and revalidated behind it.
 *
 * @param active whether Home is the foreground tab (gates the staleness refetch).
 */
export function useDashboard(active: boolean): DashboardState {
  const { serverTarget } = usePreferences(); // switching servers refetches
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Guards stale async writes: only the newest fetch may touch state.
  const runId = useRef(0);
  /** When the last successful fetch landed; 0 = none yet (first still in flight). */
  const fetchedAt = useRef(0);

  // Cached snapshot → instant first paint. `fetchedAt` makes the live response
  // always win: a slow storage read can never clobber data that already arrived.
  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(CACHE_KEY).then((raw) => {
      if (cancelled || raw === null || fetchedAt.current > 0) return;
      try {
        setData(JSON.parse(raw) as DashboardResponse);
        setLoading(false);
      } catch {
        // Corrupt entry — ignore it; the in-flight fetch fills the screen.
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = ++runId.current;
    getDashboard()
      .then((next) => {
        if (runId.current !== id) return;
        fetchedAt.current = Date.now();
        setData(next);
        setError(null);
        void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next)).catch(() => {});
      })
      .catch((err: unknown) => {
        if (runId.current !== id) return;
        if (fetchedAt.current === 0) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (runId.current !== id) return;
        setLoading(false);
        setRefreshing(false);
      });
  }, [reloadKey, serverTarget]);

  // Coming back to Home after a while: refetch WITHOUT the spinner, so the
  // visible snapshot never blanks or jumps.
  useEffect(() => {
    if (!active) return;
    if (fetchedAt.current === 0) return; // first fetch still in flight
    if (Date.now() - fetchedAt.current < STALE_AFTER_MS) return;
    setReloadKey((k) => k + 1);
  }, [active]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setReloadKey((k) => k + 1);
  }, []);

  return { data, loading, refreshing, error, refresh };
}
