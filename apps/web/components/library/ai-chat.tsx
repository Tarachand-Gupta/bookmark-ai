"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type ToolUIPart, type UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  ChevronDown,
  Copy,
  Database,
  ExternalLink,
  FileText,
  Folder,
  Globe,
  Layers,
  Link2,
  Maximize2,
  Minimize2,
  Plus,
  Radio,
  RotateCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Loader } from "@/components/ai-elements/loader";
import { safeHref } from "@/lib/safe-href";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { deviceFreshness, formatDeviceAge } from "@/lib/live-format";
import {
  authHeaders,
  deleteChatConversation,
  getChatConversation,
  getSettings,
  listChatConversations,
  type ChatConversationSummary,
  type LibraryFilters,
} from "@/lib/api";
import { AiSetupCard } from "./ai-setup-card";
import { ConversationHistory } from "./chat-conversation-history";
import { ChatLimitCard, type ChatLimitInfo } from "./chat-limit-card";
import { ChatThreadSkeleton } from "./chat-thread-skeleton";

interface BookmarkHit {
  id: string;
  title: string;
  url: string;
  category: string;
  tags: string[];
  day: string;
  score: number;
}

interface SearchToolOutput {
  mode: string;
  fallback: boolean;
  results: BookmarkHit[];
}

interface SqlToolOutput {
  columns?: string[];
  rows?: unknown[][];
  rowCount?: number;
  truncated?: boolean;
  error?: string;
}

interface WebSearchOutput {
  results: { title: string; url: string; snippet: string }[];
}

interface FetchUrlOutput {
  url?: string;
  title?: string | null;
  text?: string;
  truncated?: boolean;
  error?: string;
}

interface SessionHit {
  id: string;
  name: string;
  tabCount: number;
  browser: string;
  savedAt: string;
  tabs: { title: string; url: string }[];
}

interface SessionsToolOutput {
  total: number;
  sessions: SessionHit[];
}

interface LiveDeviceHit {
  label: string;
  browser: string;
  lastSeenAgeSeconds: number;
  tabCount: number;
  hiddenTabCount: number;
  windows: { tabs: { title: string; url: string }[] }[];
}

/** listLiveTabs output: `{enabled:false}` = sharing off, `{error}` = unavailable,
 * else the compacted live devices. Discriminated by which field is present. */
interface LiveTabsToolOutput {
  enabled?: boolean;
  error?: string;
  devices?: LiveDeviceHit[];
}

export interface AiChatProps {
  /** Seeds the conversation with the header search query, sent once on mount. */
  initialQuery?: string;
  onClose: () => void;
  /** Jump back to the library with a facet applied (the page closes the chat). */
  onFilter?: (filters: LibraryFilters) => void;
}

/**
 * Conversational search over the library. The agent (see app/api/chat/route.ts)
 * decides between the full-text and semantic search tools; every tool call
 * renders as a status header + always-visible bookmark result cards.
 */
export function AiChat({ initialQuery, onClose, onFilter }: AiChatProps) {
  // The adopted conversation id — a ref so the transport reads the CURRENT value
  // when building each request body without re-instantiating the transport.
  const conversationIdRef = useRef<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [limitInfo, setLimitInfo] = useState<ChatLimitInfo | null>(null);

  // Custom fetch = the persistence + budget hook. It attaches auth (matching the
  // rest of lib/api), adopts the server-minted conversation id from the
  // X-Conversation-Id response header, and detects the 402 free-limit body
  // before the SDK turns it into an opaque stream error.
  const chatFetch = useCallback<typeof fetch>(async (input, init) => {
    const headers = {
      ...(init?.headers as Record<string, string> | undefined),
      ...(await authHeaders()),
    };
    const res = await fetch(input, { ...init, headers });
    const cid = res.headers.get("X-Conversation-Id");
    if (cid && conversationIdRef.current !== cid) {
      conversationIdRef.current = cid;
      setActiveId(cid);
    }
    if (res.status === 402) {
      const body = (await res
        .clone()
        .json()
        .catch(() => null)) as
        | { error?: string; usedTokens?: number; limitTokens?: number }
        | null;
      if (body?.error === "free-limit-exceeded") {
        setLimitInfo({ usedTokens: body.usedTokens, limitTokens: body.limitTokens });
      }
    }
    return res;
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: chatFetch,
        // Pin the wire format: full history + the (optional) conversation id so
        // the server appends to an existing thread or mints a new one.
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages, conversationId: conversationIdRef.current ?? undefined },
        }),
      }),
    [chatFetch],
  );

  // ── History list ────────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Title for a just-loaded thread until the list refresh carries its own.
  const [pendingTitle, setPendingTitle] = useState<string | null>(null);
  // Loading a stored conversation: the GET + setMessages can take a few seconds,
  // so we show an immediate title swap + ghost-bubble skeleton meanwhile. A load
  // failure surfaces `loadError` and restores the previous thread.
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshConversations = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { conversations } = await listChatConversations();
      setConversations(conversations);
    } catch {
      // History is a convenience layer — a failed list never blocks chatting.
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const { messages, sendMessage, setMessages, regenerate, clearError, status, error } = useChat({
    transport,
    // A finished turn may have created the conversation (or renamed it) — pull
    // the fresh list so the header title + history reflect it.
    onFinish: () => {
      void refreshConversations();
    },
  });

  const seeded = useRef(false);

  // Offer "bring your own AI provider" when the user hasn't set a key: the server
  // may still answer via its own key, so this is an opt-in, dismissible upsell —
  // not a blocker. "Not configured" = no user API key saved (apiKeySet false).
  const [showSetup, setShowSetup] = useState(false);
  const [setupDismissed, setSetupDismissed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then(({ settings }) => {
        if (!cancelled) setShowSetup(!settings.apiKeySet);
      })
      .catch(() => {
        // Leave the card hidden if settings can't load — don't block the chat.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    const q = initialQuery?.trim();
    if (q && !seeded.current) {
      seeded.current = true;
      void sendMessage({ text: q });
    }
  }, [initialQuery, sendMessage]);

  const handleSubmit = (message: PromptInputMessage) => {
    const text = message.text?.trim();
    if (!text) return;
    // A new send clears any stale limit card; a fresh 402 re-raises it.
    setLimitInfo(null);
    void sendMessage({ text });
  };

  // ── Thread lifecycle: new / load / delete ─────────────────────────────────────
  const startNewConversation = useCallback(() => {
    setHistoryOpen(false);
    conversationIdRef.current = null;
    setActiveId(null);
    setPendingTitle(null);
    setLimitInfo(null);
    setLoadError(null);
    setLoadingConversation(false);
    setMessages([]);
    clearError();
  }, [setMessages, clearError]);

  const loadConversation = useCallback(
    async (id: string) => {
      // Snapshot the current thread so a failed load can restore it instead of
      // leaving a dead empty panel.
      const prev = {
        messages,
        conversationId: conversationIdRef.current,
        activeId,
        pendingTitle,
      };

      // IMMEDIATE feedback on click: close the popover, adopt the row's known
      // title, clear the thread, and show the skeleton — the network round-trip
      // then swaps real messages in (or restores `prev` on failure).
      setHistoryOpen(false);
      setLimitInfo(null);
      setLoadError(null);
      clearError();
      const knownTitle = conversations.find((c) => c.id === id)?.title ?? null;
      conversationIdRef.current = id;
      setActiveId(id);
      setPendingTitle(knownTitle);
      setMessages([]);
      setLoadingConversation(true);

      try {
        const { conversation, messages: loaded } = await getChatConversation(id);
        conversationIdRef.current = conversation.id;
        setActiveId(conversation.id);
        setPendingTitle(conversation.title);
        // Stored messages are UIMessage-compatible ({id, role, parts}); the
        // structural cast is the seam until packages/types/chat.ts is wired in.
        setMessages(loaded as unknown as UIMessage[]);
      } catch {
        conversationIdRef.current = prev.conversationId;
        setActiveId(prev.activeId);
        setPendingTitle(prev.pendingTitle);
        setMessages(prev.messages);
        setLoadError("Couldn't load that conversation. Check your connection and try again.");
      } finally {
        setLoadingConversation(false);
      }
    },
    [messages, activeId, pendingTitle, conversations, setMessages, clearError],
  );

  const handleDeleteConversation = useCallback(
    (id: string) => {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (id === conversationIdRef.current) {
        conversationIdRef.current = null;
        setActiveId(null);
        setPendingTitle(null);
        setMessages([]);
        clearError();
      }
      deleteChatConversation(id).catch(() => {
        // Re-sync if the server rejected the delete (row reappears).
        void refreshConversations();
      });
    },
    [setMessages, clearError, refreshConversations],
  );

  // After the user saves their own key from the limit card, retry the send —
  // their key is unmetered, so the same last message now succeeds.
  const handleKeySaved = useCallback(() => {
    setShowSetup(false);
    if (limitInfo) {
      setLimitInfo(null);
      clearError();
      void regenerate();
    }
  }, [limitInfo, clearError, regenerate]);

  const headerTitle =
    conversations.find((c) => c.id === activeId)?.title ?? pendingTitle ?? "New conversation";

  const history = (variant: "popover" | "panel") => (
    <ConversationHistory
      conversations={conversations}
      activeId={activeId}
      loading={historyLoading}
      variant={variant}
      onSelect={loadConversation}
      onNew={startNewConversation}
      onDelete={handleDeleteConversation}
    />
  );

  // Header: title+chevron history popover on the left, new/expand/close on the right.
  const header = (
    <div className="flex shrink-0 items-center gap-1 border-b px-2 py-2">
      <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted"
            aria-label="Conversation history"
          >
            <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="line-clamp-1 text-sm font-medium [overflow-wrap:anywhere]">
              {headerTitle}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden p-0"
        >
          {history("popover")}
        </PopoverContent>
      </Popover>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={startNewConversation}
          aria-label="New conversation"
          title="New conversation"
        >
          <Plus className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse chat" : "Expand chat"}
          title={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? (
            <Minimize2 className="size-4" aria-hidden />
          ) : (
            <Maximize2 className="size-4" aria-hidden />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onClose}
          aria-label="Close chat"
          title="Close"
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );

  const setupBlock = showSetup && !setupDismissed && (
    <div className="shrink-0 border-b p-3">
      <AiSetupCard onSaved={handleKeySaved} onDismiss={() => setSetupDismissed(true)} />
    </div>
  );

  const thread = (
    <Conversation className="flex-1">
      <ConversationContent>
        {/* Load failure: inline, dismissible, and the previous thread is already
            restored underneath — never a dead empty panel. */}
        {loadError && (
          <div className="not-prose mb-2 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.05] px-3 py-2 text-xs text-destructive">
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{loadError}</span>
            <button
              type="button"
              onClick={() => setLoadError(null)}
              aria-label="Dismiss"
              className="shrink-0 rounded p-1 transition-colors hover:bg-destructive/10"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        )}
        {loadingConversation ? (
          // Immediate feedback while the GET + setMessages round-trips.
          <ChatThreadSkeleton />
        ) : (
          <>
        {messages.length === 0 && (
          <ConversationEmptyState
            icon={<Sparkles className="size-8" aria-hidden />}
            title="Ask anything about your bookmarks"
            description="The agent searches your library, runs SQL for counts and trends, and can search the web — then answers with citations."
          />
        )}
        {messages.map((message) => (
          <Message from={message.role} key={message.id}>
            {/* w-full (not w-fit) so wide tool cards truncate instead of
                propagating their intrinsic width and stretching the page. */}
            <MessageContent className={message.role === "assistant" ? "w-full" : undefined}>
              {message.parts.map((part, i) => {
                if (part.type === "text") {
                  // Assistant answers are markdown (incl. GFM tables); user
                  // messages stay verbatim plain text.
                  return message.role === "assistant" ? (
                    <Markdown key={`${message.id}-${i}`}>{part.text}</Markdown>
                  ) : (
                    <span key={`${message.id}-${i}`} className="whitespace-pre-wrap">
                      {part.text}
                    </span>
                  );
                }
                if (part.type === "tool-searchBookmarks") {
                  const tool = part as ToolUIPart;
                  return <SearchToolCall key={tool.toolCallId} part={tool} onFilter={onFilter} />;
                }
                if (part.type === "tool-queryDatabase") {
                  const tool = part as ToolUIPart;
                  return <SqlToolCall key={tool.toolCallId} part={tool} />;
                }
                if (part.type === "tool-webSearch") {
                  const tool = part as ToolUIPart;
                  return <WebSearchToolCall key={tool.toolCallId} part={tool} />;
                }
                if (part.type === "tool-fetchUrl") {
                  const tool = part as ToolUIPart;
                  return <FetchUrlToolCall key={tool.toolCallId} part={tool} />;
                }
                if (part.type === "tool-listSessions") {
                  const tool = part as ToolUIPart;
                  return <SessionsToolCall key={tool.toolCallId} part={tool} />;
                }
                if (part.type === "tool-listLiveTabs") {
                  const tool = part as ToolUIPart;
                  return <LiveTabsToolCall key={tool.toolCallId} part={tool} />;
                }
                return null;
              })}
            </MessageContent>
          </Message>
        ))}
        {/* Free-budget wall: the inline card replaces the opaque stream error. */}
        {limitInfo && (
          <ChatLimitCard
            info={limitInfo}
            onConfigure={() => {
              setSetupDismissed(false);
              setShowSetup(true);
            }}
          />
        )}
        {/* Non-limit failures get a small retry affordance (limit has its own card). */}
        {error && !limitInfo && (
          <div className="not-prose flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.05] px-3 py-2 text-xs text-destructive">
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              Something went wrong. Try again.
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0"
              onClick={() => {
                clearError();
                void regenerate();
              }}
            >
              <RotateCw className="size-3.5" aria-hidden />
              Retry
            </Button>
          </div>
        )}
        {status === "submitted" && <Loader />}
          </>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );

  const composer = (
    <div className="shrink-0 border-t p-2">
      <PromptInput onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea placeholder="Ask a follow-up…" />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputSubmit status={status} className="ml-auto" />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );

  const chatColumn = (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
      {header}
      {setupBlock}
      {thread}
      {composer}
    </div>
  );

  // Expanded: a floating near-fullscreen panel with a small margin. On ≥640px a
  // persistent history rail sits to the left (the two-pane screenshot layout);
  // below that it collapses to a single large column (history via the popover),
  // so nothing overflows at 390px. useChat state lives in this component, so
  // swapping the wrapper never drops the conversation. MUST portal to <body>:
  // the docked shell lives inside the sidebar layout whose ancestors form
  // stacking contexts, which would trap this `fixed` overlay underneath the
  // sidebar and top bar.
  if (expanded) {
    return createPortal(
      <div className="fixed inset-0 z-[60] flex" role="dialog" aria-modal="true">
        <button
          type="button"
          aria-label="Collapse chat"
          onClick={() => setExpanded(false)}
          className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        />
        <div className="relative m-auto flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-hidden rounded-xl border bg-card shadow-2xl sm:h-[calc(100dvh-3rem)] sm:w-[calc(100vw-3rem)]">
          <aside className="hidden w-64 shrink-0 flex-col border-r sm:flex">
            {history("panel")}
          </aside>
          {chatColumn}
        </div>
      </div>,
      document.body,
    );
  }

  // Docked: fills whatever shell ChatPanel provides (side / overlay / full).
  return chatColumn;
}

/**
 * One search-tool invocation: a compact status strip (which tool, the query it
 * ran, live progress / hit count) over the matched bookmarks as rich cards.
 */
function SearchToolCall({
  part,
  onFilter,
}: {
  part: ToolUIPart;
  onFilter?: (filters: LibraryFilters) => void;
}) {
  const input = part.input as { query?: string; mode?: string } | undefined;
  const output = part.output as SearchToolOutput | undefined;
  const mode = output?.mode ?? input?.mode ?? "hybrid";
  const semantic = mode === "ai" || mode === "semantic";
  const label = semantic
    ? "Semantic search"
    : mode === "text"
      ? "Full-text search"
      : "Bookmark search";
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error";
  const hits = output?.results.length ?? 0;

  return (
    <div className="not-prose mb-1 w-full overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
        {semantic ? (
          <Sparkles className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="shrink-0 font-medium">{label}</span>
        {input?.query && (
          <span className="line-clamp-1 min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
            “{input.query}”
          </span>
        )}
        <span className="ml-auto shrink-0 text-muted-foreground">
          {running ? (
            <span className="flex items-center gap-1.5">
              <Loader size={12} />
              Searching…
            </span>
          ) : failed ? (
            <span className="text-destructive">failed</span>
          ) : (
            `${hits} ${hits === 1 ? "match" : "matches"}${output?.fallback ? " · text fallback" : ""}`
          )}
        </span>
      </div>
      {failed && <p className="px-3 py-2 text-xs text-destructive">{part.errorText}</p>}
      {output && (
        <BookmarkHits hits={output.results} showScore={output.mode === "ai"} onFilter={onFilter} />
      )}
    </div>
  );
}

/** One queryDatabase invocation: the SQL, then a scrollable result table (or error). */
function SqlToolCall({ part }: { part: ToolUIPart }) {
  const input = part.input as { sql?: string; purpose?: string } | undefined;
  const output = part.output as SqlToolOutput | undefined;
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error" || !!output?.error;
  const rowCount = output?.rowCount ?? output?.rows?.length ?? 0;

  return (
    <div className="not-prose mb-1 w-full overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
        <Database className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 font-medium">SQL query</span>
        {input?.purpose && (
          <span className="line-clamp-1 min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
            {input.purpose}
          </span>
        )}
        <span className="ml-auto shrink-0 text-muted-foreground">
          {running ? (
            <span className="flex items-center gap-1.5">
              <Loader size={12} />
              Running…
            </span>
          ) : failed ? (
            <span className="text-destructive">error</span>
          ) : (
            `${rowCount} row${rowCount === 1 ? "" : "s"}${output?.truncated ? " · capped" : ""}`
          )}
        </span>
      </div>
      {input?.sql && (
        <pre className="overflow-x-auto border-b bg-muted/30 px-3 py-2 text-[11px] leading-relaxed">
          <code>{input.sql}</code>
        </pre>
      )}
      {(output?.error || (failed && part.errorText)) && (
        <p className="px-3 py-2 text-xs text-destructive [overflow-wrap:anywhere]">
          {output?.error ?? part.errorText}
        </p>
      )}
      {output?.columns && output?.rows && (
        <SqlResultTable columns={output.columns} rows={output.rows} />
      )}
    </div>
  );
}

/** Compact, horizontally scrollable table for queryDatabase results (first 50 rows). */
function SqlResultTable({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  if (!rows.length) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">No rows.</p>;
  }
  const shown = rows.slice(0, 50);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b bg-muted/30">
            {columns.map((c) => (
              <th key={c} className="px-2 py-1 text-left font-medium [overflow-wrap:anywhere]">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, ri) => (
            <tr key={ri} className="border-b last:border-0">
              {columns.map((_, ci) => (
                <td key={ci} className="px-2 py-1 align-top [overflow-wrap:anywhere]">
                  {formatCell(row[ci])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <p className="px-2 py-1 text-[10px] text-muted-foreground">
          +{rows.length - shown.length} more row{rows.length - shown.length === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** One webSearch invocation: the query + result links with snippets. */
function WebSearchToolCall({ part }: { part: ToolUIPart }) {
  const input = part.input as { query?: string } | undefined;
  const output = part.output as WebSearchOutput | undefined;
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error";
  const count = output?.results.length ?? 0;

  return (
    <div className="not-prose mb-1 w-full overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
        <Globe className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 font-medium">Web search</span>
        {input?.query && (
          <span className="line-clamp-1 min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
            “{input.query}”
          </span>
        )}
        <span className="ml-auto shrink-0 text-muted-foreground">
          {running ? (
            <span className="flex items-center gap-1.5">
              <Loader size={12} />
              Searching…
            </span>
          ) : failed ? (
            <span className="text-destructive">failed</span>
          ) : (
            `${count} result${count === 1 ? "" : "s"}`
          )}
        </span>
      </div>
      {output &&
        (count === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No web results.</p>
        ) : (
          <ul className="divide-y">
            {output.results.map((r, i) => {
              const href = safeHref(r.url);
              return (
              <li key={`${r.url}-${i}`} className="px-3 py-2">
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="line-clamp-1 text-sm font-medium hover:underline [overflow-wrap:anywhere]"
                  >
                    {r.title}
                  </a>
                ) : (
                  <span className="line-clamp-1 text-sm font-medium [overflow-wrap:anywhere]">
                    {r.title}
                  </span>
                )}
                <p className="line-clamp-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {hostOf(r.url)}
                </p>
                {r.snippet && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {r.snippet}
                  </p>
                )}
              </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}

/** One fetchUrl invocation: the page title/URL + a short text preview (or error). */
function FetchUrlToolCall({ part }: { part: ToolUIPart }) {
  const input = part.input as { url?: string } | undefined;
  const output = part.output as FetchUrlOutput | undefined;
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error" || !!output?.error;
  const shownUrl = output?.url ?? input?.url;

  return (
    <div className="not-prose mb-1 w-full overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
        <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 font-medium">Fetched page</span>
        {shownUrl &&
          (safeHref(shownUrl) ? (
            <a
              href={safeHref(shownUrl)}
              target="_blank"
              rel="noreferrer noopener"
              className="line-clamp-1 min-w-0 text-muted-foreground hover:underline [overflow-wrap:anywhere]"
            >
              {hostOf(shownUrl)}
            </a>
          ) : (
            <span className="line-clamp-1 min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
              {hostOf(shownUrl)}
            </span>
          ))}
        <span className="ml-auto shrink-0 text-muted-foreground">
          {running ? (
            <span className="flex items-center gap-1.5">
              <Loader size={12} />
              Reading…
            </span>
          ) : failed ? (
            <span className="text-destructive">error</span>
          ) : (
            <Link2 className="size-3.5" aria-hidden />
          )}
        </span>
      </div>
      {(output?.error || (failed && part.errorText)) && (
        <p className="px-3 py-2 text-xs text-destructive [overflow-wrap:anywhere]">
          {output?.error ?? part.errorText}
        </p>
      )}
      {output && !output.error && (
        <div className="px-3 py-2">
          {output.title && <p className="text-sm font-medium [overflow-wrap:anywhere]">{output.title}</p>}
          {output.text && (
            <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {output.text.slice(0, 300)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** hostname without a leading www., falling back to the raw string. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Guard a data-derived URL before it becomes an `href`. Returns the url only
 * when it parses to http(s); anything else (`javascript:`, `data:`, `chrome:`,
 * garbage) yields undefined so the caller renders plain text instead of a live
 * link. Saved *tab* URLs are stored permissively — this render guard, not input
 * validation, is what keeps a hostile scheme out of the DOM.
 */
/**
 * One listSessions invocation: status strip + the saved sessions with their
 * first tabs, visually distinct (Layers icon) from bookmark results.
 */
function SessionsToolCall({ part }: { part: ToolUIPart }) {
  const input = part.input as { query?: string } | undefined;
  const output = part.output as SessionsToolOutput | undefined;
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error";
  const count = output?.sessions.length ?? 0;

  return (
    <div className="not-prose mb-1 w-full overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
        <Layers className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 font-medium">Saved sessions</span>
        {input?.query && (
          <span className="line-clamp-1 min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
            “{input.query}”
          </span>
        )}
        <span className="ml-auto shrink-0 text-muted-foreground">
          {running ? (
            <span className="flex items-center gap-1.5">
              <Loader size={12} />
              Loading…
            </span>
          ) : failed ? (
            <span className="text-destructive">failed</span>
          ) : (
            `${count} session${count === 1 ? "" : "s"}`
          )}
        </span>
      </div>
      {failed && <p className="px-3 py-2 text-xs text-destructive">{part.errorText}</p>}
      {output &&
        (count === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No saved sessions found.</p>
        ) : (
          <ul className="divide-y">
            {output.sessions.map((s) => (
              <li key={s.id} className="px-3 py-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="line-clamp-1 min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                    {s.name}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {s.tabCount} tab{s.tabCount === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {s.tabs.slice(0, 5).map((t, i) => {
                    const href = safeHref(t.url);
                    return (
                    <li key={`${t.url}-${i}`}>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="line-clamp-1 text-xs text-muted-foreground hover:text-foreground hover:underline [overflow-wrap:anywhere]"
                        >
                          {t.title || t.url}
                        </a>
                      ) : (
                        <span className="line-clamp-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          {t.title || t.url}
                        </span>
                      )}
                    </li>
                    );
                  })}
                  {s.tabs.length > 5 && (
                    <li className="text-[10px] text-muted-foreground">
                      +{s.tabCount - 5} more tab{s.tabCount - 5 === 1 ? "" : "s"}
                    </li>
                  )}
                </ul>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

/** Small favicon-substitute: the host's first letter in a muted dot. The live
 * tool ships no favicon urls (compacted for the model), so we derive one. */
function LetterDot({ text }: { text: string }) {
  const letter = (text.trim()[0] ?? "•").toUpperCase();
  return (
    <span
      aria-hidden
      className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-medium text-muted-foreground"
    >
      {letter}
    </span>
  );
}

/**
 * One listLiveTabs invocation: the user's CURRENTLY-OPEN tabs across devices.
 * Distinct from saved sessions — a Radio icon + a live freshness dot per device
 * (emerald = recently seen) with "as of …" age. Handles the three terminal
 * shapes (error / sharing-off / devices) purely off the stored output, so a
 * rehydrated `output-available` part renders identically to the live one.
 */
function LiveTabsToolCall({ part }: { part: ToolUIPart }) {
  const output = part.output as LiveTabsToolOutput | undefined;
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error" || !!output?.error;
  const enabled = output?.enabled ?? false;
  const devices = output?.devices ?? [];
  const count = devices.length;

  return (
    <div className="not-prose mb-1 w-full overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
        <Radio className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 font-medium">Live tabs</span>
        <span className="ml-auto shrink-0 text-muted-foreground">
          {running ? (
            <span className="flex items-center gap-1.5">
              <Loader size={12} />
              Checking…
            </span>
          ) : failed ? (
            <span className="text-destructive">unavailable</span>
          ) : !enabled ? (
            "sharing off"
          ) : (
            `${count} device${count === 1 ? "" : "s"}`
          )}
        </span>
      </div>
      {failed && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Live tabs are unavailable right now.
        </p>
      )}
      {output && !failed && !enabled && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Live sharing is off — turn on “Live sessions” sharing to let the assistant see your
          current tabs.
        </p>
      )}
      {output &&
        !failed &&
        enabled &&
        (count === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No devices are sharing live tabs right now.
          </p>
        ) : (
          <ul className="divide-y">
            {devices.map((d, di) => {
              const { filled } = deviceFreshness(d.lastSeenAgeSeconds);
              const tabs = d.windows.flatMap((w) => w.tabs);
              return (
                <li key={`${d.label}-${di}`} className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        filled ? "bg-emerald-500" : "border border-muted-foreground/50",
                      )}
                    />
                    <span className="line-clamp-1 min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                      {d.label || "Unnamed device"}
                    </span>
                    <span className="shrink-0 text-xs capitalize text-muted-foreground">
                      {d.browser}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {formatDeviceAge(d.lastSeenAgeSeconds)}
                    </span>
                  </div>
                  {tabs.length === 0 ? (
                    <p className="mt-1 pl-4 text-[11px] text-muted-foreground">No open tabs.</p>
                  ) : (
                    <ul className="mt-1.5 space-y-1">
                      {tabs.slice(0, 8).map((t, ti) => {
                        const href = safeHref(t.url);
                        return (
                          <li key={`${t.url}-${ti}`} className="flex items-start gap-2">
                            <LetterDot text={hostOf(t.url)} />
                            <div className="min-w-0 flex-1">
                              {href ? (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="line-clamp-1 text-xs font-medium hover:underline [overflow-wrap:anywhere]"
                                >
                                  {t.title || t.url}
                                </a>
                              ) : (
                                <span className="line-clamp-1 text-xs font-medium [overflow-wrap:anywhere]">
                                  {t.title || t.url}
                                </span>
                              )}
                              <p className="line-clamp-1 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                                {hostOf(t.url)}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                      {tabs.length > 8 && (
                        <li className="pl-6 text-[10px] text-muted-foreground">
                          +{tabs.length - 8} more tab{tabs.length - 8 === 1 ? "" : "s"}
                        </li>
                      )}
                      {d.hiddenTabCount > 0 && (
                        <li className="pl-6 text-[10px] text-muted-foreground">
                          +{d.hiddenTabCount} hidden
                        </li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}

/** Cited bookmarks as actionable cards: open, copy link, filter by category/tag. */
function BookmarkHits({
  hits,
  showScore,
  onFilter,
}: {
  hits: BookmarkHit[];
  showScore: boolean;
  onFilter?: (filters: LibraryFilters) => void;
}) {
  if (!hits.length) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">No matches in the library.</p>;
  }
  return (
    <ul className="divide-y">
      {hits.map((r) => {
        const href = safeHref(r.url);
        return (
        <li
          key={r.id}
          className="flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-muted/50"
        >
          <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              {/* line-clamp-1 (not truncate): nowrap text would set the row's
                  intrinsic min-content width and stretch the page sideways. */}
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="line-clamp-1 min-w-0 text-sm font-medium hover:underline [overflow-wrap:anywhere]"
                >
                  {r.title}
                </a>
              ) : (
                <span className="line-clamp-1 min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                  {r.title}
                </span>
              )}
              {showScore && (
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {Math.round(r.score * 100)}% match
                </span>
              )}
            </div>
            <p className="line-clamp-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {hostOf(r.url)}
              {r.day ? ` · ${r.day}` : ""}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => onFilter?.({ category: r.category })}
                title={`Category: ${r.category} — click to filter`}
                className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground transition-opacity hover:opacity-85"
              >
                <Folder className="size-2.5" aria-hidden />
                {r.category}
              </button>
              {r.tags.slice(0, 4).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onFilter?.({ tag: t })}
                  title={`Show #${t} bookmarks`}
                  className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  #{t}
                </button>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <CopyLinkButton url={r.url} />
            {href && (
              <Button variant="ghost" size="icon" className="size-7" asChild>
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`Open ${r.title}`}
                  title="Open in new tab"
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </Button>
            )}
          </div>
        </li>
        );
      })}
    </ul>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // Clipboard API can be permission-denied (embedded webviews, focus
      // rules) — the selection-based path only needs the click gesture.
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7"
      aria-label={copied ? "Link copied" : "Copy link"}
      title="Copy link"
      onClick={() => void copy()}
    >
      {copied ? (
        <Check className="size-3.5 text-green-600" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
    </Button>
  );
}

/**
 * Assistant answers rendered as GitHub-flavored markdown (links, lists, code,
 * and — the reason for remark-gfm — tables). Styling is applied via the
 * `components` map with Tailwind classes so it matches the app; wide tables and
 * code blocks scroll inside their own container instead of stretching the bubble.
 */
function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium underline underline-offset-2 hover:opacity-80"
            />
          ),
          p: ({ node, ...props }) => <p {...props} className="my-1.5 first:mt-0 last:mb-0" />,
          ul: ({ node, ...props }) => (
            <ul {...props} className="my-1.5 list-disc space-y-0.5 pl-5" />
          ),
          ol: ({ node, ...props }) => (
            <ol {...props} className="my-1.5 list-decimal space-y-0.5 pl-5" />
          ),
          h1: ({ node, ...props }) => <h1 {...props} className="mt-3 mb-1 text-base font-semibold" />,
          h2: ({ node, ...props }) => <h2 {...props} className="mt-3 mb-1 text-sm font-semibold" />,
          h3: ({ node, ...props }) => <h3 {...props} className="mt-2 mb-1 text-sm font-semibold" />,
          blockquote: ({ node, ...props }) => (
            <blockquote {...props} className="my-1.5 border-l-2 pl-3 text-muted-foreground" />
          ),
          hr: ({ node, ...props }) => <hr {...props} className="my-2 border-border" />,
          pre: ({ node, ...props }) => (
            <pre
              {...props}
              className="my-2 overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed"
            />
          ),
          code: ({ node, className, children, ...props }) => {
            const block = /language-/.test(className ?? "");
            return block ? (
              <code {...props} className={className}>
                {children}
              </code>
            ) : (
              <code
                {...props}
                className={cn("rounded bg-muted px-1 py-0.5 text-[0.85em]", className)}
              >
                {children}
              </code>
            );
          },
          table: ({ node, ...props }) => (
            <div className="my-2 overflow-x-auto">
              <table {...props} className="w-full border-collapse text-xs" />
            </div>
          ),
          thead: ({ node, ...props }) => <thead {...props} className="bg-muted/40" />,
          th: ({ node, ...props }) => (
            <th {...props} className="border border-border px-2 py-1 text-left font-medium" />
          ),
          td: ({ node, ...props }) => (
            <td {...props} className="border border-border px-2 py-1 align-top" />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
