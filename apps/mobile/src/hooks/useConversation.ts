import { useCallback, useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import type { ChatConversation } from "@bookmark-ai/types";
import { getChatConversation } from "../api";

export interface ConversationState {
  conversation: ChatConversation | null;
  /** The stored transcript, ready to seed `useChat` (empty for a new chat). */
  messages: UIMessage[];
  /** True while the transcript is being fetched — the thread shows a skeleton. */
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * Load one stored conversation (`GET /api/chat/conversations/[id]`) so its
 * transcript can seed a thread. `id === null` = a brand-new chat: nothing to
 * fetch, no loading state, an empty transcript.
 *
 * Stored messages are UIMessage-compatible by contract (`{id, role, parts}` —
 * see packages/types/src/chat.ts, where `parts` is deliberately `unknown[]`
 * because the AI SDK owns those shapes), so the structural cast here is the same
 * seam the web client uses.
 */
export function useConversation(id: string | null): ConversationState {
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [loading, setLoading] = useState(id !== null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Guards stale async writes: only the newest fetch may touch state.
  const runId = useRef(0);

  useEffect(() => {
    const run = ++runId.current;
    if (id === null) {
      setConversation(null);
      setMessages([]);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getChatConversation(id, controller.signal)
      .then((data) => {
        if (runId.current !== run) return;
        setConversation(data.conversation);
        setMessages(data.messages as unknown as UIMessage[]);
      })
      .catch((err: unknown) => {
        if (runId.current !== run) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (runId.current === run) setLoading(false);
      });
    return () => controller.abort();
  }, [id, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  return { conversation, messages, loading, error, retry };
}
