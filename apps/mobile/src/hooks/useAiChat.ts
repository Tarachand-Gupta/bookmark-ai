import { useCallback, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type ChatStatus, type FileUIPart, type UIMessage } from "ai";
import {
  AI_NOTE_HEADER,
  AI_SOURCE_HEADER,
  ATTACHMENT_REJECTED_MESSAGE,
  ATTACHMENTS_TOO_LARGE_MESSAGE,
  ATTACHMENTS_TOO_MANY_MESSAGE,
  type ChatAiNote,
} from "@bookmark-ai/types";
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
import { sendPayload } from "../lib/chatAttachments";

interface ErrorBody {
  error?: string;
  usedTokens?: number;
  limitTokens?: number;
  limitBytes?: number;
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

/** Which key answered a turn — the `X-Ai-Source` response header. */
export type AiSource = "included" | "own" | "own-fallback";

function parseAiSource(value: string | null): AiSource | null {
  return value === "included" || value === "own" || value === "own-fallback" ? value : null;
}

/** `X-Ai-Note` — a per-reply advisory. Only one value exists today: the user's
 * saved key has no model chosen, so the turn ran on the included AI instead. */
export type AiNote = ChatAiNote;

function parseAiNote(value: string | null): AiNote | null {
  return value === "own-key-incomplete" ? value : null;
}

/** The server's attachment refusals (its re-check of the rules the client already
 * applies) → the shared copy. Unknown codes fall through to the generic error card. */
function attachmentRejection(status: number, code: string | undefined): string | null {
  switch (code) {
    case "attachment-type-not-allowed":
      return ATTACHMENT_REJECTED_MESSAGE;
    case "attachments-too-large":
      return ATTACHMENTS_TOO_LARGE_MESSAGE;
    case "too-many-attachments":
      return ATTACHMENTS_TOO_MANY_MESSAGE;
    case "attachment-url-not-allowed":
      return "Attachments have to be the file itself — a link to a file can't be attached.";
    default:
      return status === 413 || status === 415 ? "The server refused those attachments." : null;
  }
}

/** The IANA zone the prompt uses for "today" — omitted if the runtime can't say. */
function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
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
  /** 413/415: the server's own re-check refused the attachments — the copy to show. */
  rejected: string | null;
  /** Which key answered the current/last turn (null until a response arrives). */
  aiSource: AiSource | null;
  /** A per-reply advisory from the server (`X-Ai-Note`), or null. */
  aiNote: AiNote | null;
  /** The conversation this thread is bound to (server-minted on the first turn). */
  conversationId: string | null;
  send: (text: string, files?: FileUIPart[]) => void;
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
 * bearer token, and the wire protocol the clients share — the first turn sends
 * `{ messages }`, every later turn sends ONLY the new message as
 * `{ message, conversationId }` (history lives on the server, so a turn with
 * attachments never re-uploads earlier ones), plus the device `timezone`; the
 * `X-Conversation-Id` header binds the thread and `X-Ai-Source` says which key
 * answered.
 *
 * The custom fetch is also where paywalls are read: 402 (weekly free AI budget),
 * 429 (daily chat quota) and 413/415 (attachment re-check) carry a JSON body
 * that the SDK would otherwise flatten into an opaque stream error, so they're
 * captured here and surfaced as their own states for inline cards.
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
  const [rejected, setRejected] = useState<string | null>(null);
  const [aiSource, setAiSource] = useState<AiSource | null>(null);
  const [aiNote, setAiNote] = useState<AiNote | null>(null);

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
      const source = parseAiSource(res.headers.get(AI_SOURCE_HEADER));
      if (source !== null) setAiSource(source);
      setAiNote(parseAiNote(res.headers.get(AI_NOTE_HEADER)));

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
      } else if (res.status === 400 || res.status === 413 || res.status === 415) {
        // The client already enforces the allowlist and caps; this is the server's
        // belt-and-braces re-check disagreeing (a stale build, a hand-crafted part).
        // A 400 is only an attachment refusal when its code says so — any other
        // 400 stays a generic, retryable error.
        const body = await readJsonBody(res);
        const rejection = attachmentRejection(res.status, body?.error);
        if (rejection !== null) setRejected(rejection);
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
        prepareSendMessagesRequest: ({ messages, trigger }) => {
          const cid = conversationIdRef.current ?? undefined;
          const timezone = deviceTimezone();
          // Later turns send ONLY the new user message; the server appends it to
          // the stored history. A regenerate keeps the legacy full-list shape (the
          // server uses the array as-is): its last message is the user turn that
          // is ALREADY stored, and appending it again would duplicate it.
          if (cid && trigger === "submit-message") {
            return { body: { message: messages[messages.length - 1], conversationId: cid, timezone } };
          }
          return { body: { messages, conversationId: cid, timezone } };
        },
      }),
    [chatFetch],
  );

  const chat = useChat({
    transport,
    messages: initialMessages,
    onFinish: () => onFinish?.(),
  });

  /** Clears any stale paywall/rejection card — a fresh 402/429/413 re-raises it. */
  const clearWalls = useCallback(() => {
    setLimit(null);
    setQuota(null);
    setRejected(null);
  }, []);

  const send = useCallback(
    (text: string, files?: FileUIPart[]) => {
      // Files with no question go out as file parts only — no empty text part
      // (see sendPayload). Null means there was nothing to send.
      const payload = sendPayload(text, files);
      if (payload === null) return;
      clearWalls();
      chat.clearError();
      // The note under a reply describes THIS turn's source, not the last one's.
      setAiSource(null);
      setAiNote(null);
      void chat.sendMessage(payload);
    },
    [chat, clearWalls],
  );

  const stop = useCallback(() => {
    void chat.stop();
  }, [chat]);

  const retry = useCallback(() => {
    clearWalls();
    chat.clearError();
    setAiSource(null);
    setAiNote(null);
    void chat.regenerate();
  }, [chat, clearWalls]);

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    limit,
    quota,
    rejected,
    aiSource,
    aiNote,
    conversationId: activeId,
    send,
    stop,
    retry,
  };
}
