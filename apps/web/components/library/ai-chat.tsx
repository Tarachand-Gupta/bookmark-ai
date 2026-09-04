"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  isFileUIPart,
  isToolUIPart,
  type ChatStatus,
  type FileUIPart,
  type UIMessage,
  type UIMessagePart,
  type UIDataTypes,
  type UITools,
} from "ai";
import { AI_SOURCE_HEADER, CONVERSATION_ID_HEADER, type AiUsage } from "@bookmark-ai/types";
import { skillsCreatedIn } from "@/lib/chat-tools";
import { notifySkillsChanged } from "@/lib/skills";
import {
  AlertTriangle,
  ChevronDown,
  Ellipsis,
  Maximize2,
  Minimize2,
  Plus,
  RotateCw,
  Sparkles,
  X,
} from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputController,
  type PromptInputError,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  authHeaders,
  deleteChatConversation,
  getChatConversation,
  getSettings,
  listChatConversations,
  type ChatConversationSummary,
  type LibraryFilters,
} from "@/lib/api";
import { AI_MODE_COPY, AI_NOTE_HEADER, describeAiNote, resolveAiMode } from "@/lib/ai-mode";
import { attachmentAcceptAttribute, describeAttachmentServerError } from "@/lib/chat-attachments";
import { prepareAttachments } from "@/lib/chat-attachments-browser";
import { AiCreditsCallout } from "./ai-credits-meter";
import { AiSetupCard } from "./ai-setup-card";
import { AttachButton, ChatDropZone, ComposerAttachments, MessageFiles } from "./chat-attachments";
import { ConversationHistory } from "./chat-conversation-history";
import { ChatLimitCard, type ChatLimitInfo } from "./chat-limit-card";
import { Markdown } from "./chat-markdown";
import { ReasoningPart } from "./chat-reasoning";
import { ChatSamplePrompts } from "./chat-sample-prompts";
import { ChatThreadSkeleton } from "./chat-thread-skeleton";
import { ThinkingIndicator } from "./chat-thinking";
import { ToolCallCard } from "./chat-tool-card";
import { SkillsDialog, SkillsIcon } from "./skills-settings";

export interface AiChatProps {
  onClose: () => void;
  /** Jump back to the library with a facet applied (the page closes the chat). */
  onFilter?: (filters: LibraryFilters) => void;
}

/** Dismissal of the empty-state free-credits greeting, per browser. It's an
 * upsell, so once waved off it stays gone — the same offer lives in Settings → AI.
 * The KEY is inherited verbatim from the one-line "Using the shared AI" banner
 * this greeting replaced, so anyone who already dismissed that stays dismissed. */
const GREETING_DISMISSED = "bmk:ai-key-banner-dismissed";

/** The hidden file input's filter: every allowed extension + MIME (CONTRACT §4). */
const ATTACHMENT_ACCEPT = attachmentAcceptAttribute();

/** The `X-Ai-Source` header value that earns a note under the reply (CONTRACT §1). */
const OWN_FALLBACK_SOURCE = "own-fallback";

type AnyPart = UIMessagePart<UIDataTypes, UITools>;

/** IANA zone for the body's `timezone` field — the prompt uses it for "today". */
function clientTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Does this message already put SOMETHING on screen? Decides whether the
 * "Thinking" placeholder is still needed for the in-flight assistant turn: an
 * empty text part or a bare `step-start` is nothing; a streaming reasoning part
 * (even before its first delta) renders its own "Thinking…" row and counts.
 */
function hasVisibleContent(message: UIMessage): boolean {
  return message.parts.some((part) => {
    if (part.type === "text") return part.text.trim().length > 0;
    if (part.type === "reasoning") return part.state === "streaming" || part.text.trim().length > 0;
    if (part.type === "file" || part.type === "dynamic-tool") return true;
    return isToolUIPart(part);
  });
}

/**
 * Conversational search over the library. The agent (see app/api/chat/route.ts)
 * picks its tools; every part type it can stream — text, reasoning, tool calls
 * in all four states, files — renders here (CONTRACT §6), plus attachments in
 * the composer (§4) and the `{ message, conversationId }` protocol (§5).
 */
export function AiChat({ onClose, onFilter }: AiChatProps) {
  // The adopted conversation id — a ref so the transport reads the CURRENT value
  // when building each request body without re-instantiating the transport.
  const conversationIdRef = useRef<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [limitInfo, setLimitInfo] = useState<ChatLimitInfo | null>(null);

  // `X-Ai-Source` per reply: the in-flight value (state, for the message being
  // streamed) and, once a turn finishes, a message-id → source map so the note
  // stays under the right reply as the thread grows.
  const [liveAiSource, setLiveAiSource] = useState<string | null>(null);
  const liveAiSourceRef = useRef<string | null>(null);
  const aiSourceByMessage = useRef(new Map<string, string>());
  // `X-Ai-Note` (BYOK rule): "own-key-incomplete" earns a sentence + a link to
  // Settings under the reply. Same live/per-message bookkeeping as the source.
  const [liveAiNote, setLiveAiNote] = useState<string | null>(null);
  const liveAiNoteRef = useRef<string | null>(null);
  const aiNoteByMessage = useRef(new Map<string, string>());

  // ── Attachments: rejections surface as one line under the composer ──────────
  // Both the client-side pipeline (prepareAttachments) and the server's typed
  // 400/413/415 bodies land here. A server rejection also flags the turn so the
  // generic "Something went wrong" box stays hidden and the un-sent user message
  // is lifted back out of the transcript (see the effect below).
  const [attachError, setAttachError] = useState<string | null>(null);
  const attachErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showAttachError = useCallback((message: string, ms = 8000) => {
    setAttachError(message);
    if (attachErrorTimer.current) clearTimeout(attachErrorTimer.current);
    attachErrorTimer.current = setTimeout(() => setAttachError(null), ms);
  }, []);
  useEffect(
    () => () => {
      if (attachErrorTimer.current) clearTimeout(attachErrorTimer.current);
    },
    [],
  );
  const [attachmentRejected, setAttachmentRejected] = useState(false);

  // Custom fetch = the persistence + budget hook. It attaches auth (matching the
  // rest of lib/api), adopts the server-minted conversation id from the
  // X-Conversation-Id response header, reads X-Ai-Source / X-Ai-Note, and
  // detects the 402 free-limit body and the typed attachment rejections before
  // the SDK turns them into an opaque stream error.
  const chatFetch = useCallback<typeof fetch>(
    async (input, init) => {
      const headers = {
        ...(init?.headers as Record<string, string> | undefined),
        ...(await authHeaders()),
      };
      const res = await fetch(input, { ...init, headers });
      const cid = res.headers.get(CONVERSATION_ID_HEADER);
      if (cid && conversationIdRef.current !== cid) {
        conversationIdRef.current = cid;
        setActiveId(cid);
      }
      const source = res.headers.get(AI_SOURCE_HEADER);
      liveAiSourceRef.current = source;
      setLiveAiSource(source);
      const note = res.headers.get(AI_NOTE_HEADER);
      liveAiNoteRef.current = note;
      setLiveAiNote(note);
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
      } else if (!res.ok) {
        const body: unknown = await res
          .clone()
          .json()
          .catch(() => null);
        const copy = describeAttachmentServerError(res.status, body);
        if (copy) {
          setAttachmentRejected(true);
          showAttachError(copy, 12000);
        }
      }
      return res;
    },
    [showAttachError],
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: chatFetch,
        // Wire format (CONTRACT §5): history lives on the server, so once a
        // conversation exists only the NEW user message travels, with the id.
        // The first turn (no id yet) and a regenerate (the server must replace
        // its stored tail, not append) send the full array — the legacy shape
        // the route still accepts. `timezone` rides along for the prompt's "today".
        prepareSendMessagesRequest: ({ messages, trigger }) => {
          const conversationId = conversationIdRef.current ?? undefined;
          const timezone = clientTimezone();
          if (conversationId && trigger === "submit-message") {
            return { body: { message: messages.at(-1), conversationId, timezone } };
          }
          return { body: { messages, conversationId, timezone } };
        },
      }),
    [chatFetch],
  );

  // ── History list ────────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
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

  const { messages, sendMessage, setMessages, regenerate, clearError, status, error, stop } =
    useChat({
      transport,
      // A finished turn may have created the conversation (or renamed it) — pull
      // the fresh list so the header title + history reflect it. It also SPENT
      // credits: refresh the usage too, so a "New conversation" greeting shows
      // this session's spend instead of the mount-time snapshot (QA finding).
      onFinish: ({ message }) => {
        if (liveAiSourceRef.current) {
          aiSourceByMessage.current.set(message.id, liveAiSourceRef.current);
        }
        if (liveAiNoteRef.current) {
          aiNoteByMessage.current.set(message.id, liveAiNoteRef.current);
        }
        void refreshConversations();
        void refreshAiSettings();
        // createSkill / installSkill added rows: an open Skills manager refreshes.
        if (skillsCreatedIn(message.parts) > 0) notifySkillsChanged();
      },
    });

  // A server-side attachment rejection means the message never left: take the
  // optimistic user bubble back out of the thread (the composer line says why)
  // and clear the SDK's error so the retry box doesn't offer to resend it.
  useEffect(() => {
    if (status !== "error" || !attachmentRejected) return;
    setMessages((prev) => (prev.at(-1)?.role === "user" ? prev.slice(0, -1) : prev));
    clearError();
  }, [status, attachmentRejected, setMessages, clearError]);

  // FREE CREDITS, FIRST OPEN. A user on the included free AI is metered weekly —
  // so the first thing an empty conversation shows is what they've got (credit
  // meter) and, secondarily, that their own key is an option. Living in the
  // EMPTY STATE costs the conversation nothing — it's gone the moment a message
  // exists. "On the free AI" = the explicit `aiMode` (CONTRACT §1), derived
  // from `apiKeySet` for a server that predates the field.
  const [includedMode, setIncludedMode] = useState(false);
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [greetingDismissed, setGreetingDismissed] = useState(false);
  useEffect(() => {
    setGreetingDismissed(localStorage.getItem(GREETING_DISMISSED) === "1");
  }, []);
  const dismissGreeting = useCallback(() => {
    setGreetingDismissed(true);
    localStorage.setItem(GREETING_DISMISSED, "1");
  }, []);
  /** The full setup card, opened only from the free-limit wall's CTA. */
  const [keyFormOpen, setKeyFormOpen] = useState(false);
  // Shared by mount and stream-finish: the meter must track this session's
  // spend, not the mount-time snapshot.
  const settingsFetchAlive = useRef(true);
  const refreshAiSettings = useCallback(async () => {
    try {
      const { settings } = await getSettings();
      if (!settingsFetchAlive.current) return;
      setIncludedMode(resolveAiMode(settings) === "included");
      setAiUsage(settings.aiUsage);
    } catch {
      // Leave the greeting as-is if settings can't load — don't block the chat.
    } finally {
      if (settingsFetchAlive.current) setSettingsLoading(false);
    }
  }, []);
  useEffect(() => {
    settingsFetchAlive.current = true;
    void refreshAiSettings();
    return () => {
      settingsFetchAlive.current = false;
    };
  }, [refreshAiSettings]);

  // Deep-link into Settings → AI, which the library page owns and opens off the
  // `settings` param (see library-page.tsx). Same shallow History push the rest
  // of the app uses, so the URL changes without an RSC round-trip and the rest of
  // the params (?ai=1, active facets) ride along. Collapse first when expanded:
  // the fullscreen chat sits above the dialog's layer.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openAiSettings = useCallback(() => {
    setExpanded(false);
    const params = new URLSearchParams(searchParams);
    params.set("settings", "ai");
    window.history.pushState(null, "", `${pathname}?${params}`);
  }, [pathname, searchParams]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  const onAttachError = useCallback(
    (err: PromptInputError) => showAttachError(err.message),
    [showAttachError],
  );

  /** The single send path (composer submit and sample-prompt click both use it).
   * A new send clears any stale limit card; a fresh 402 re-raises it. Files
   * arrive as data-URL `file` parts already classified and downscaled. */
  const send = useCallback(
    (text: string, files: FileUIPart[] = []) => {
      const trimmed = text.trim();
      if (!trimmed && files.length === 0) return;
      setLimitInfo(null);
      setAttachError(null);
      setAttachmentRejected(false);
      liveAiSourceRef.current = null;
      setLiveAiSource(null);
      liveAiNoteRef.current = null;
      setLiveAiNote(null);
      if (trimmed) void sendMessage({ text: trimmed, files });
      else void sendMessage({ files });
    },
    [sendMessage],
  );

  const handleSubmit = (message: PromptInputMessage) => {
    send(message.text ?? "", message.files ?? []);
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
        // Stored messages are UIMessage-compatible ({id, role, parts}) with the
        // parts kept verbatim — file, reasoning and tool parts render exactly
        // like the live ones. The structural cast is the seam until
        // packages/types/chat.ts types the parts.
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
  // their key is unmetered, so the same last message now succeeds. The card
  // also calls this on a mode switch / key removal, so re-read the mode rather
  // than assuming.
  const handleKeySaved = useCallback(() => {
    void refreshAiSettings();
    setKeyFormOpen(false);
    if (limitInfo) {
      setLimitInfo(null);
      clearError();
      void regenerate();
    }
  }, [limitInfo, clearError, regenerate, refreshAiSettings]);

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

  // Header: ⋯ menu (the home for Skills and future items) + title/chevron history
  // popover on the left; new/expand/close on the right.
  const header = (
    <div className="flex shrink-0 items-center gap-1 border-b px-2 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="More options"
            title="More"
          >
            <Ellipsis className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6} className="w-48">
          <DropdownMenuItem onSelect={() => setSkillsOpen(true)}>
            <SkillsIcon aria-hidden />
            Skills…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openAiSettings}>
            <Sparkles aria-hidden />
            AI settings…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="cursor-pointer flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted"
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

  const isEmptyThread = messages.length === 0 && !loadingConversation;
  // The free-credits greeting only makes sense for someone actually ON the free
  // tier — an own-key user's chat doesn't touch the meter.
  // Render (as the loading skeleton) while settings are still in flight —
  // waiting for the fetch popped the card in ~3s late and shifted the layout
  // (QA finding). Own-key users get a brief skeleton→unmount instead, which is
  // the rarer and gentler wrong.
  const showGreeting = (settingsLoading || includedMode) && !greetingDismissed;

  // INSTANT PLACEHOLDER (CONTRACT §6): the moment a message is sent, an
  // assistant turn appears with a shimmering "Thinking" — until the real turn
  // has something of its own to show.
  const busy = status === "submitted" || status === "streaming";
  const lastMessage = messages.at(-1);
  const showThinking =
    busy &&
    !loadingConversation &&
    (!lastMessage || lastMessage.role !== "assistant" || !hasVisibleContent(lastMessage));

  const renderPart = (message: UIMessage, part: AnyPart, index: number, live: boolean) => {
    const key = `${message.id}-${index}`;
    switch (part.type) {
      case "text":
        // Assistant answers are markdown (incl. GFM tables); user messages stay
        // verbatim plain text.
        return message.role === "assistant" ? (
          <Markdown key={key}>{part.text}</Markdown>
        ) : (
          <span key={key} className="whitespace-pre-wrap">
            {part.text}
          </span>
        );
      case "reasoning":
        return <ReasoningPart key={key} part={part} live={live} />;
      case "dynamic-tool":
        return <ToolCallCard key={part.toolCallId} part={part} onFilter={onFilter} />;
      // Files render together above the text (MessageFiles); the rest are
      // bookkeeping the user never needs to see.
      case "file":
      case "step-start":
      case "source-url":
      case "source-document":
        return null;
      default:
        if (isToolUIPart(part)) {
          return <ToolCallCard key={part.toolCallId} part={part} onFilter={onFilter} />;
        }
        return null;
    }
  };

  const thread = (
    <Conversation className="flex-1">
      {/* min-h-full only while empty: StickToBottom's content div is auto-height
          inside a height:100% scroller, so the empty state's own `size-full`
          resolved against an auto parent and collapsed to the icon. Giving the
          content a definite minimum lets the state below grow and center. */}
      <ConversationContent className={isEmptyThread ? "min-h-full" : undefined}>
        {/* Load failure: inline, dismissible, and the previous thread is already
            restored underneath — never a dead empty panel. */}
        {loadError && (
          <div className="not-prose mb-2 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.05] px-3 py-2 text-xs text-destructive">
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{loadError}</span>
            <button
              type="button"
              onClick={() => setLoadError(null)}
              aria-label="Dismiss"
              className="cursor-pointer shrink-0 rounded p-1 transition-colors hover:bg-destructive/10"
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
              // THREE stacked blocks, not `ConversationEmptyState` — that primitive
              // assumes it owns the whole pane (size-full, centered), and the empty
              // state now carries a free-credits greeting on top and rotating sample
              // prompts underneath the icon/heading. flex-1 fills the min-h-full
              // column above; the min-h floor keeps everything intact (scrolling
              // instead of clipping) in a short panel, and p-4 rather than p-8 —
              // at the dock's 340px floor the extra padding squeezed the description
              // to four words a line.
              <div className="not-prose flex min-h-[13rem] flex-1 flex-col gap-4 p-4">
                {showGreeting && (
                  <AiCreditsCallout
                    usage={aiUsage}
                    loading={settingsLoading}
                    onDismiss={dismissGreeting}
                    className="shrink-0"
                    action={
                      <button
                        type="button"
                        onClick={openAiSettings}
                        className="cursor-pointer font-medium underline-offset-2 transition-opacity hover:underline hover:opacity-80"
                      >
                        or use your own key →
                      </button>
                    }
                  />
                )}
                {/* The original icon + heading, unchanged in wording — centered in
                    whatever height is left between the greeting and the prompts. */}
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                  <Sparkles className="size-8 text-muted-foreground" aria-hidden />
                  <div className="space-y-1">
                    <h3 className="text-sm font-medium">Ask anything about your bookmarks</h3>
                    <p className="text-sm text-muted-foreground">
                      The agent searches your library, runs SQL for counts and trends, and can
                      search the web — then answers with citations. Attach an image or a document
                      to ask about it.
                    </p>
                  </div>
                </div>
                {/* Rotation lives entirely in this component and unmounts with the
                    empty state, so it stops the instant a message exists. */}
                <ChatSamplePrompts onPick={send} className="shrink-0" />
              </div>
            )}
            {messages.map((message, mi) => {
              const isLast = mi === messages.length - 1;
              const live = isLast && busy;
              const files = message.parts.filter(isFileUIPart);
              const source =
                aiSourceByMessage.current.get(message.id) ?? (live ? liveAiSource : null);
              const noteCopy = describeAiNote(
                aiNoteByMessage.current.get(message.id) ?? (live ? liveAiNote : null),
              );
              return (
                <Message from={message.role} key={message.id}>
                  {/* w-full (not w-fit) so wide tool cards truncate instead of
                      propagating their intrinsic width and stretching the page. */}
                  <MessageContent className={message.role === "assistant" ? "w-full" : undefined}>
                    {files.length > 0 && <MessageFiles files={files} />}
                    {message.parts.map((part, i) => renderPart(message, part, i, live))}
                    {message.role === "assistant" && source === OWN_FALLBACK_SOURCE && (
                      <p className="not-prose text-[11px] leading-relaxed text-muted-foreground">
                        {AI_MODE_COPY.ownFallback}
                      </p>
                    )}
                    {message.role === "assistant" && noteCopy && (
                      <p className="not-prose flex flex-wrap items-center gap-x-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-500">
                        <AlertTriangle className="size-3 shrink-0" aria-hidden />
                        <span>{noteCopy}</span>
                        <button
                          type="button"
                          onClick={openAiSettings}
                          className="cursor-pointer font-medium underline-offset-2 hover:underline"
                        >
                          Open AI settings →
                        </button>
                      </p>
                    )}
                  </MessageContent>
                </Message>
              );
            })}
            {showThinking && (
              <Message from="assistant">
                <MessageContent className="w-full">
                  <ThinkingIndicator />
                </MessageContent>
              </Message>
            )}
            {/* Free-budget wall: the inline card replaces the opaque stream error. */}
            {limitInfo && (
              <ChatLimitCard info={limitInfo} onConfigure={() => setKeyFormOpen(true)} />
            )}
            {/* The one place the full form still appears in the chat — INSIDE the
                scroller, so it can't shrink the conversation, and only once the user
                asked for it from a wall that has already stopped the conversation. */}
            {keyFormOpen && (
              <AiSetupCard
                className="not-prose mt-2 w-full"
                // The wall only appears once the free credits are gone, so the
                // secondary path is the ONLY path left — open it, don't hide the form
                // behind a chevron the user has to discover.
                defaultProviderOpen
                onSaved={handleKeySaved}
                onDismiss={() => setKeyFormOpen(false)}
              />
            )}
            {/* Non-limit failures get a small retry affordance (the limit has its
                own card; an attachment rejection its own composer line). */}
            {error && !limitInfo && !attachmentRejected && (
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
          </>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );

  const composer = (
    <div className="shrink-0 border-t p-2">
      <PromptInput onSubmit={handleSubmit} accept={ATTACHMENT_ACCEPT} multiple>
        <PromptInputBody>
          <ComposerAttachments />
          {/* "Ask a follow-up" is a lie on an empty thread — there's nothing to
              follow up on, and it was the only prompt the empty state offered. */}
          <PromptInputTextarea
            placeholder={
              messages.length === 0
                ? "Ask anything about your bookmarks…"
                : "Ask a follow-up…"
            }
          />
        </PromptInputBody>
        {/* Its own row, not squeezed between the paperclip and Send — the
            rejection copy is a full sentence and needs the width. */}
        {attachError && (
          <p
            role="alert"
            className="flex items-start gap-1.5 px-3 pb-1.5 text-xs leading-snug text-destructive [overflow-wrap:anywhere]"
          >
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0">{attachError}</span>
          </p>
        )}
        <PromptInputFooter>
          <AttachButton />
          <ComposerSubmit status={status} onStop={stop} className="ml-auto" />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );

  // The drop zone wraps the WHOLE column: dragging a file anywhere over the chat
  // raises the target, not just over the composer.
  const chatColumn = (
    <ChatDropZone className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
      {header}
      {thread}
      {composer}
    </ChatDropZone>
  );

  // Expanded: a floating near-fullscreen panel with a small margin. On ≥640px a
  // persistent history rail sits to the left (the two-pane screenshot layout);
  // below that it collapses to a single large column (history via the popover),
  // so nothing overflows at 390px. useChat state lives in this component, so
  // swapping the wrapper never drops the conversation. MUST portal to <body>:
  // the docked shell lives inside the sidebar layout whose ancestors form
  // stacking contexts, which would trap this `fixed` overlay underneath the
  // sidebar and top bar.
  const shell = expanded ? (
    createPortal(
      <div className="fixed inset-0 z-[60] flex" role="dialog" aria-modal="true">
        <button
          type="button"
          aria-label="Collapse chat"
          onClick={() => setExpanded(false)}
          className="cursor-pointer absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        />
        <div className="relative m-auto flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-hidden rounded-xl border bg-card shadow-2xl sm:h-[calc(100dvh-3rem)] sm:w-[calc(100vw-3rem)]">
          <aside className="hidden w-64 shrink-0 flex-col border-r sm:flex">
            {history("panel")}
          </aside>
          {chatColumn}
        </div>
      </div>,
      document.body,
    )
  ) : (
    // Docked: fills whatever shell ChatPanel provides (side / overlay / full).
    chatColumn
  );

  // The attachments provider sits OUTSIDE the docked/expanded switch so a file
  // pinned in the composer survives toggling the layout (context flows through
  // the portal). Every incoming file — picker, drop, paste — runs through
  // prepareAttachments: classify, size-check, downscale, re-encode (§4).
  return (
    <PromptInputProvider prepareFiles={prepareAttachments} onError={onAttachError}>
      {shell}
      <SkillsDialog open={skillsOpen} onOpenChange={setSkillsOpen} />
    </PromptInputProvider>
  );
}

/**
 * The send/stop button. Disabled while there's nothing to send; while a reply
 * is in flight the same button STOPS it (the square glyph the primitive already
 * shows for `streaming` finally does what it looks like it does).
 */
function ComposerSubmit({
  status,
  onStop,
  className,
}: {
  status: ChatStatus;
  onStop: () => void;
  className?: string;
}) {
  const { textInput, attachments } = usePromptInputController();
  const empty = textInput.value.trim().length === 0 && attachments.files.length === 0;
  const busy = status === "submitted" || status === "streaming";
  return (
    <PromptInputSubmit
      status={status}
      className={className}
      disabled={!busy && empty}
      aria-label={busy ? "Stop generating" : "Send message"}
      title={busy ? "Stop" : "Send (Enter)"}
      onClick={(e) => {
        if (busy) {
          e.preventDefault();
          onStop();
        }
      }}
    />
  );
}
