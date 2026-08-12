import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatConversation } from "@bookmark-ai/types";
import { deleteChatConversation, listChatConversations } from "../api";
import { usePreferences } from "../context/PreferencesContext";

export interface ChatConversationsState {
  conversations: ChatConversation[];
  /** First load with nothing to paint yet — render skeleton rows, not "empty". */
  loading: boolean;
  refreshing: boolean;
  /** Set only while the list is empty: a failed refresh over rendered rows stays quiet. */
  error: string | null;
  refresh: () => void;
  /** Refetch WITHOUT the pull-to-refresh spinner — for coming back from a thread,
   * where rows are already on screen and a spinner would read as a jump. */
  revalidate: () => void;
  /** Optimistic delete — the row is gone immediately, restored if the API rejects. */
  remove: (id: string) => Promise<void>;
}

/**
 * The Ask AI tab's history list (`GET /api/chat/conversations`). Same load /
 * refresh / stale-revalidate shape as useSessions + useDashboard.
 *
 * @param active whether Ask AI is the foreground tab — the first fetch waits for
 *   it (the screen is mounted from launch, like every other tab), and returning
 *   after `STALE_AFTER_MS` silently revalidates.
 */
const STALE_AFTER_MS = 30_000;

export function useChatConversations(active: boolean): ChatConversationsState {
  const { serverTarget } = usePreferences(); // switching servers refetches
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Guards stale async writes: only the newest fetch may touch state.
  const runId = useRef(0);
  /** When the last successful fetch landed; 0 = none yet. */
  const fetchedAt = useRef(0);
  /** Flips true the first time the tab is opened and never back — the fetch
   * effect keys off THIS, not `active`, so leaving and re-entering the tab
   * doesn't re-run it (returning is handled by the staleness effect below). */
  const [armed, setArmed] = useState(active);
  useEffect(() => {
    if (active) setArmed(true);
  }, [active]);

  useEffect(() => {
    if (!armed) return;
    const id = ++runId.current;
    listChatConversations()
      .then((data) => {
        if (runId.current !== id) return;
        fetchedAt.current = Date.now();
        setConversations(data.conversations);
        setError(null);
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
  }, [reloadKey, serverTarget, armed]);

  // Coming back to the tab after a while (or after a conversation was closed —
  // its first exchange created it server-side) revalidates without a spinner.
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

  const revalidate = useCallback(() => setReloadKey((k) => k + 1), []);

  const remove = useCallback(async (id: string) => {
    let removed: ChatConversation | undefined;
    setConversations((prev) => {
      removed = prev.find((c) => c.id === id);
      return prev.filter((c) => c.id !== id);
    });
    try {
      await deleteChatConversation(id);
    } catch (err) {
      // Put it back where it was (the list is sorted by updatedAt, so re-sorting
      // after the splice keeps the row in its own place instead of at the top).
      if (removed) {
        const restored = removed;
        setConversations((prev) =>
          [...prev, restored].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        );
      }
      throw err;
    }
  }, []);

  return { conversations, loading, refreshing, error, refresh, revalidate, remove };
}
