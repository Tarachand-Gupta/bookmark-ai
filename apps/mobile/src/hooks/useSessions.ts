import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@bookmark-ai/types";
import { deleteSession, listSessions } from "../api";
import { usePreferences } from "../context/PreferencesContext";

export interface SessionsState {
  sessions: Session[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
  remove: (id: string) => Promise<void>;
}

/** The Sessions tab's data story — same load/refresh pattern as useLibrary. */
export function useSessions(): SessionsState {
  const { serverTarget } = usePreferences(); // switching servers refetches
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Guards stale async writes: only the latest load may touch state.
  const loadId = useRef(0);

  useEffect(() => {
    const id = ++loadId.current;
    setLoading(true);
    listSessions()
      .then((data) => {
        if (loadId.current !== id) return;
        setSessions(data.sessions);
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
  }, [reloadKey, serverTarget]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setReloadKey((k) => k + 1);
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return { sessions, loading, refreshing, error, refresh, remove };
}
