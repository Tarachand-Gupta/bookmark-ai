import { useCallback, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type ChatStatus, type UIMessage } from "ai";
// RN's own fetch cannot stream a response body (whatwg-fetch buffers into
// `responseText`), so the transport MUST use expo/fetch — its FetchResponse
// exposes `body` as a real ReadableStream. Expo SDK 57 also installs it as the
// global `fetch`, but the transport takes the explicit import so a future
// EXPO_PUBLIC_USE_RN_FETCH=1 (or an RN fetch polyfill) can't silently break
// streaming. Everything the AI SDK needs on top of that ships with SDK 57's
// WinterCG runtime — TextDecoder/TextDecoderStream, structuredClone, URL,
// ReadableStream (see expo/src/winter/runtime.native.ts) — so no polyfills.
import { fetch as expoFetch } from "expo/fetch";
import { authHeaders, getChatApiUrl } from "../api";

interface ErrorBody {
  error?: string;
  usedTokens?: number;
  limitTokens?: number;
}

/**
 * Read a failed response's JSON WITHOUT consuming the body the SDK will read for
 * its own error message — hence `clone()`, wrapped because a body that's already
 * been touched makes clone() throw, and losing a paywall's details must never
 * turn into a rejected fetch.
 */
async function readJsonBody(res: Response): Promise<ErrorBody | null> {
  try {
    return (await res.clone().json()) as ErrorBody;
  } catch {
    return null;
  }
}

/** The 402 body when the shared (server-key) weekly AI budget is exhausted. */
export interface FreeLimitInfo {
  usedTokens?: number;
  limitTokens?: number;
}

export interface AiChatState {
  messages: UIMessage[];
  status: ChatStatus;
  /** Stream/network failure — the inline retry affordance's trigger. */
  error: Error | undefined;
  /** Non-null once a send came back 402 (weekly free AI limit). */
  limit: FreeLimitInfo | null;
  /** The server's message for a 429 daily chat quota. */
  quota: string | null;
  /** The conversation this thread is bound to (server-minted on the first turn). */
  conversationId: string | null;
  send: (text: string) => void;
  stop: () => void;
  /** Clear the failure and re-run the last turn. */
  retry: () => void;
}

export interface UseAiChatOptions {
  /** Transcript to hydrate a stored conversation with (empty for a new chat).
   * Read ONCE, when the underlying Chat is constructed — mount this hook's owner
   * with a key per conversation, never swap the array underneath it. */
  initialMessages: UIMessage[];
  /** Existing conversation id, or null for "the server mints one". */
  conversationId: string | null;
  /** Fired when a conversation id is adopted from the response header. MUST be
   * stable (useCallback): the underlying Chat captures the transport — and with
   * it this callback — once, at construction. */
  onConversationId?: (id: string) => void;
  /** Fired when a turn finishes streaming (the history list is now stale). Also
   * captured once — keep it stable. */
  onFinish?: () => void;
}

/**
 * `useChat` wired to THIS app's /api/chat: expo/fetch for streaming, the Clerk
 * bearer token, and the same wire format the web client pins
 * (`{ messages, conversationId }` + the `X-Conversation-Id` response header), so
 * a thread started on the phone keeps working in the browser and vice versa.
 *
 * The custom fetch is also where paywalls are read: 402 (weekly free AI budget)
 * and 429 (daily chat quota) carry a JSON body that the SDK would otherwise
 * flatten into an opaque stream error, so they're captured here and surfaced as
 * their own states for inline cards.
 */
export function useAiChat({
  initialMessages,
  conversationId,
  onConversationId,
  onFinish,
}: UseAiChatOptions): AiChatState {
  // A ref, so each request body reads the CURRENT id without rebuilding the
  // transport (which would drop the in-flight stream).
  const conversationIdRef = useRef<string | null>(conversationId);
  const [activeId, setActiveId] = useState<string | null>(conversationId);
  const [limit, setLimit] = useState<FreeLimitInfo | null>(null);
  const [quota, setQuota] = useState<string | null>(null);

  const chatFetch = useCallback<typeof globalThis.fetch>(
    async (input, init) => {
      const headers = {
        ...(init?.headers as Record<string, string> | undefined),
        ...(await authHeaders()),
      };
      const res = (await (expoFetch as unknown as typeof globalThis.fetch)(input, {
        ...init,
        headers,
      })) as Response;

      const cid = res.headers.get("X-Conversation-Id");
      if (cid && conversationIdRef.current !== cid) {
        conversationIdRef.current = cid;
        setActiveId(cid);
        onConversationId?.(cid);
      }

      if (res.status === 402 || res.status === 429) {
        const body = await readJsonBody(res);
        if (res.status === 402 && body?.error === "free-limit-exceeded") {
          setLimit({ usedTokens: body.usedTokens, limitTokens: body.limitTokens });
        } else if (res.status === 429) {
          // Two different 429s reach here: the daily per-account chat quota
          // ("Daily limit reached (chats)…") and the coarse IP rate limiter
          // ("Too many requests"). Pass the server's own words through — the
          // notice picks its title from them.
          setQuota(body?.error ?? "Daily chat limit reached — try again tomorrow.");
        }
      }
      return res;
    },
    [onConversationId],
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: getChatApiUrl(),
        fetch: chatFetch,
        // Pin the wire format: full history + the (optional) conversation id, so
        // the server appends to this thread or mints a new one. Identical to
        // apps/web/components/library/ai-chat.tsx.
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages, conversationId: conversationIdRef.current ?? undefined },
        }),
      }),
    [chatFetch],
  );

  const chat = useChat({
    transport,
    messages: initialMessages,
    onFinish: () => onFinish?.(),
  });

  /** Clears any stale paywall card — a fresh 402/429 re-raises it. */
  const clearWalls = useCallback(() => {
    setLimit(null);
    setQuota(null);
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      clearWalls();
      chat.clearError();
      void chat.sendMessage({ text: trimmed });
    },
    [chat, clearWalls],
  );

  const stop = useCallback(() => {
    void chat.stop();
  }, [chat]);

  const retry = useCallback(() => {
    clearWalls();
    chat.clearError();
    void chat.regenerate();
  }, [chat, clearWalls]);

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    limit,
    quota,
    conversationId: activeId,
    send,
    stop,
    retry,
  };
}
