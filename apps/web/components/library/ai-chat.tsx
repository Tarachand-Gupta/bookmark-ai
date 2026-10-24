"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { useChatWorkspace } from "@/hooks/use-chat-workspace";
import { ChatMessageSources } from "./chat-message-sources";
import { ChatResponseActions } from "./chat-response-actions";
import { contextLabel } from "@/lib/chat-workspace";
import type { ChatContext } from "@bookmark-ai/types";
import { ChatContextPreview } from "./organization/chat-context-preview";
import { ChatContextPicker } from "./organization/chat-context-picker";
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
  Bookmark,
  Library,
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
  onOpen: () => void;
  open: boolean;
  accountId: string;
  suggestedContext?: ChatContext;
  requestedContext?: { id: string; context: ChatContext };
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
export function AiChat({
  onClose,
  onOpen,
  open,
  accountId,
  suggestedContext,
  requestedContext,
  onFilter,
}: AiChatProps) {
  const workspace = useChatWorkspace(accountId);
  const active = workspace.active;
  useEffect(() => {
    if (requestedContext) workspace.patch({ context: requestedContext.context });
  }, [requestedContext?.id, workspace]);
  const { messages, sendMessage, setMessages, regenerate, clearError, status, error, stop } =
    useChat({ chat: active.chat });
  const activeId = active.conversationId;
  const limitInfo = active.limit;
  const liveAiSource = active.source;
  const liveAiNote = active.note;
  const aiSourceByMessage = { current: active.sourceByMessage };
  const aiNoteByMessage = { current: active.noteByMessage };
  const attachmentRejected = !!active.rejection;
  const [attachErrors, setAttachErrors] = useState<Record<string, string | null>>({});
  const attachError = attachErrors[active.key];
  const setAttachError = (message: string | null) =>
    setAttachErrors((errors) => ({ ...errors, [active.key]: message }));
  const showAttachError = useCallback(
    (message: string) => setAttachErrors((errors) => ({ ...errors, [active.key]: message })),
    [active.key],
  );
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const loadingConversation =
    !workspace.hydrated ||
    active.historyStatus === "unloaded" ||
    active.historyStatus === "loading";
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contextPicker, setContextPicker] = useState(false);
  const [libraryContextOpen, setLibraryContextOpen] = useState(false);
  const libraryContextButton = useRef<HTMLButtonElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const refreshConversations = useCallback(async () => {
    setHistoryLoading(true);
    try {
      setConversations((await listChatConversations()).conversations);
    } catch {
      /* A failed history read does not block an active draft. */
    } finally {
      setHistoryLoading(false);
    }
  }, []);
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
    try {
      setGreetingDismissed(localStorage.getItem(GREETING_DISMISSED) === "1");
    } catch {
      /* Session-only dismissal. */
    }
  }, []);
  const dismissGreeting = useCallback(() => {
    setGreetingDismissed(true);
    try {
      localStorage.setItem(GREETING_DISMISSED, "1");
    } catch {
      /* Session-only dismissal. */
    }
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
  useEffect(() => {
    if (historyOpen) void refreshConversations();
  }, [historyOpen, refreshConversations]);

  const onAttachError = useCallback(
    (err: PromptInputError) => showAttachError(err.message),
    [showAttachError],
  );

  workspace.onFinish = (message) => {
    void refreshConversations();
    void refreshAiSettings();
    if (skillsCreatedIn(message.parts) > 0) notifySkillsChanged();
  };
  const send = (text: string, files: FileUIPart[] = []) => workspace.send(text, files);
  const handleSubmit = (message: PromptInputMessage) => {
    if (!open) onOpen();
    workspace.send(message.text, message.files);
  };
  const startNewConversation = () => {
    workspace.create({ context: suggestedContext ?? { type: "library" } });
    setHistoryOpen(false);
    setLoadError(null);
    setAttachError(null);
    textarea.current?.focus();
  };
  const loadConversation = (id: string) => {
    setHistoryOpen(false);
    setLoadError(null);
    const known = workspace.threads.get(id) ?? workspace.findConversation(id);
    if (known) workspace.select(known.key);
    else
      workspace.create({
        conversationId: id,
        title: conversations.find((item) => item.id === id)?.title ?? "Conversation",
      });
  };
  const restoreConversation = useCallback(
    (key: string) =>
      workspace.ensureHistory(key, async (id) => {
        const { conversation, messages } = await getChatConversation(id);
        return { messages: messages as unknown as UIMessage[], title: conversation.title };
      }),
    [workspace],
  );
  const handleDeleteConversation = async (id: string) => {
    const thread = workspace.threads.get(id) ?? workspace.findConversation(id);
    try {
      if (thread?.conversationId || !thread)
        await deleteChatConversation(thread?.conversationId ?? id);
      if (thread) workspace.remove(thread.key);
      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch {
      setLoadError("Couldn't delete this conversation. Try again.");
    }
  };
  useEffect(() => {
    if (workspace.hydrated && active.historyStatus === "unloaded")
      void restoreConversation(active.key);
  }, [workspace, workspace.hydrated, active.key, active.historyStatus, restoreConversation]);
  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);
  // After the user saves their own key from the limit card, retry the send —
  // their key is unmetered, so the same last message now succeeds. The card
  // also calls this on a mode switch / key removal, so re-read the mode rather
  // than assuming.
  const handleKeySaved = useCallback(() => {
    void refreshAiSettings();
    setKeyFormOpen(false);
    if (limitInfo) {
      active.limit = null;
      workspace.notify();
      clearError();
      void regenerate();
    }
  }, [limitInfo, clearError, regenerate, refreshAiSettings]);

  const headerTitle = conversations.find((c) => c.id === activeId)?.title ?? active.title;

  const history = (variant: "popover" | "panel") => (
    <ConversationHistory
      conversations={[...workspace.threads.values()]
        .filter((t) => !t.conversationId && (t.text || t.files.length || t.missingFiles.length))
        .map(
          (t) =>
            ({
              id: t.key,
              title: `${t.title} · Draft`,
              createdAt: t.updatedAt,
              updatedAt: t.updatedAt,
            }) as ChatConversationSummary,
        )
        .concat(
          conversations.map((c) => ({
            ...c,
            title: `${c.title}${workspace.findConversation(c.id)?.text ? " · Draft" : ""}`,
          })),
        )}
      activeId={activeId ?? active.key}
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
            className="cursor-pointer flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
          aria-label="Conversation history"
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

  const isEmptyThread = workspace.canShowSuggestions && !loadingConversation;
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
    <Conversation key={active.key} className="flex-1">
      {/* min-h-full only while empty: StickToBottom's content div is auto-height
          inside a height:100% scroller, so the empty state's own `size-full`
          resolved against an auto parent and collapsed to the icon. Giving the
          content a definite minimum lets the state below grow and center. */}
      <ConversationContent
        className={`mx-auto w-full max-w-3xl ${isEmptyThread ? "min-h-full" : ""}`}
      >
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
        {active.historyError && (
          <div role="alert" className="not-prose mb-2 space-y-2 rounded-lg border p-3 text-xs">
            <p>{active.historyError}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void restoreConversation(active.key)}
              >
                Retry loading
              </Button>
              <Button variant="ghost" size="sm" onClick={startNewConversation}>
                New conversation
              </Button>
            </div>
          </div>
        )}
        {loadingConversation ? (
          // Immediate feedback while the GET + setMessages round-trips.
          <ChatThreadSkeleton />
        ) : (
          <>
            {isEmptyThread && (
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
                    compact
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
                <div className="mx-auto flex max-w-sm flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
                  <Sparkles className="size-8 text-muted-foreground" aria-hidden />
                  <div className="space-y-1">
                    <h3 className="text-sm font-medium">What would you like to explore?</h3>
                    <p className="text-sm text-muted-foreground">
                      Find a saved page, connect ideas, or pick up where you left off. Your
                      bookmarks, sessions and live tabs are ready to search.
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
              const stored = message as UIMessage & {
                context?: ChatContext;
                contextSources?: { id: string; title: string; url: string }[];
                unavailableContext?: { id: string; reason: string }[];
              };
              const submittedContext =
                stored.context ??
                (message.metadata as { context?: ChatContext } | undefined)?.context;
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
                    {message.role === "user" && (
                      <ChatMessageSources
                        context={submittedContext}
                        sources={stored.contextSources}
                        unavailable={stored.unavailableContext}
                      />
                    )}
                    {files.length > 0 && <MessageFiles files={files} />}
                    {message.parts.map((part, i) => renderPart(message, part, i, live))}
                    {message.role === "assistant" &&
                      !live &&
                      message.parts.some((part) => part.type === "text" && part.text.trim()) && (
                        <ChatResponseActions
                          text={message.parts
                            .filter(
                              (part): part is Extract<AnyPart, { type: "text" }> =>
                                part.type === "text",
                            )
                            .map((part) => part.text)
                            .join("\n\n")}
                          onRetry={
                            isLast && !busy && !error
                              ? () => {
                                  clearError();
                                  void regenerate();
                                }
                              : undefined
                          }
                        />
                      )}
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
    <div
      className={
        open ? `shrink-0 border-t p-2 ${expanded ? "mx-auto w-full max-w-3xl" : ""}` : "p-0"
      }
    >
      <div className={open ? "contents" : "hidden"}>
        {active.contextNeedsReview && (
          <div role="status" className="px-3 py-2 text-xs space-y-2">
            <p>
              Your draft is saved. Its previous context is no longer available. Choose bookmarks or
              use your library before sending.
            </p>
            <Button size="sm" variant="outline" onClick={() => setContextPicker(true)}>
              Choose bookmarks
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => workspace.patch({ context: { type: "library" } })}
            >
              Use my library
            </Button>
          </div>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-2 pb-2 text-xs text-muted-foreground">
          <Popover open={libraryContextOpen} onOpenChange={setLibraryContextOpen}>
            <PopoverTrigger asChild>
              <button
                ref={libraryContextButton}
                type="button"
                aria-label="Context: your library"
                className="mr-auto inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-8"
              >
                <Library className="size-3.5" aria-hidden />
                Your library
                <ChevronDown className="size-3" aria-hidden />
              </button>
            </PopoverTrigger>
            <PopoverContent aria-label="Library context" align="start" side="top" className="w-[min(22rem,calc(100vw-2rem))]">
              <p className="mb-1 text-sm font-medium">Library access is always on</p>
              <p className="text-sm text-muted-foreground">
                AI can search your bookmarks, saved sessions and enabled live tabs. Attach bookmarks or files to guide an answer; your library stays available.
              </p>
              <Button variant="outline" className="mt-3 min-h-11 w-full" onClick={() => { setLibraryContextOpen(false); setContextPicker(true); }}>
                <Bookmark className="size-4" aria-hidden />
                Choose bookmarks
              </Button>
            </PopoverContent>
          </Popover>
          {active.context.type !== "library" && (
            <div className="flex min-w-0 items-center rounded-md border bg-muted/30">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex min-h-11 min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-8"
                  >
                    <Bookmark className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{contextLabel(active.context)}</span>
                    <ChevronDown className="size-3" aria-hidden />
                  </button>
                </PopoverTrigger>
                <PopoverContent aria-label="Attached bookmarks" className="w-[min(22rem,calc(100vw-2rem))]">
                  <ChatContextPreview context={active.context} accountId={accountId} />
                </PopoverContent>
              </Popover>
              <button
                type="button"
                className="flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:size-8"
                onClick={() => workspace.patch({ context: { type: "library" } })}
                aria-label="Remove attached bookmarks"
              >
                <X className="size-3" />
              </button>
            </div>
          )}
          {open &&
            suggestedContext?.type === "bookmarks" &&
            JSON.stringify(suggestedContext) !== JSON.stringify(active.context) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => workspace.patch({ context: suggestedContext })}
              >
                Attach {contextLabel(suggestedContext).toLowerCase()}
              </Button>
            )}
        </div>
        {active.recoverable && (
          <div role="status" className="px-3 py-2 text-xs space-y-2">
            <p>A previous message failed while you were writing this draft. Both are retained.</p>
            <Button size="sm" variant="outline" onClick={() => workspace.recoverFailedTurn()}>
              Open failed message as a draft
            </Button>
            <Button size="sm" variant="ghost" onClick={() => workspace.discardFailedTurn()}>
              Discard failed message
            </Button>
          </div>
        )}
        {active.interrupted && (
          <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
            The previous response was interrupted. Review the saved conversation before retrying.
          </p>
        )}
        {active.missingFiles.map((file) => (
          <div
            key={file.id}
            className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-1 text-xs"
          >
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {file.filename} · Needs reattachment
            </span>
            <ReattachFile filename={file.filename} />
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove missing ${file.filename}`}
              onClick={() =>
                workspace.patch({
                  missingFiles: active.missingFiles.filter((f) => f.id !== file.id),
                })
              }
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      <PromptInput
        className={
          open
            ? undefined
            : "[&>[data-slot=input-group]]:grid [&>[data-slot=input-group]]:grid-cols-[44px_minmax(0,1fr)_44px] [&>[data-slot=input-group]]:h-[54px] [&>[data-slot=input-group]]:border-0 [&>[data-slot=input-group]]:shadow-none [&>[data-slot=input-group]]:ring-0 [&>[data-slot=input-group]]:bg-transparent [&>[data-slot=input-group]]:px-1"
        }
        onSubmit={handleSubmit}
        clearOnSubmit={false}
        accept={ATTACHMENT_ACCEPT}
        multiple
      >
        <PromptInputBody>
          <ComposerAttachments hidden={!open} />
          {/* "Ask a follow-up" is a lie on an empty thread — there's nothing to
              follow up on, and it was the only prompt the empty state offered. */}
          <PromptInputTextarea
            ref={textarea}
            aria-label="Ask about your library"
            className={
              open
                ? undefined
                : "col-start-2 row-start-1 h-[52px] min-h-[52px] max-h-[52px] min-w-0 overflow-hidden px-2 py-4 leading-5"
            }
            rows={1}
            wrap={open ? "soft" : "off"}
            onFocus={() => {
              if (!open) {
                if (
                  !active.contextNeedsReview &&
                  !active.text &&
                  !active.files.length &&
                  !messages.length &&
                  suggestedContext
                )
                  workspace.patch({ context: suggestedContext });
                onOpen();
              }
            }}
            placeholder={messages.length === 0 ? "Ask about your library" : "Ask a follow-up…"}
          />
        </PromptInputBody>
        {/* Its own row, not squeezed between the paperclip and Send — the
            rejection copy is a full sentence and needs the width. */}
        {open && attachError && (
          <p
            role="alert"
            className="flex items-start gap-1.5 px-3 pb-1.5 text-xs leading-snug text-destructive [overflow-wrap:anywhere]"
          >
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0">{attachError}</span>
          </p>
        )}
        <PromptInputFooter
          className={
            open
              ? undefined
              : "contents [&>button]:size-11 [&>button]:row-start-1 [&>button:first-child]:col-start-1 [&>button:last-child]:col-start-3"
          }
        >
          <AttachButton
            onOpen={onOpen}
            onSelectBookmarks={() => {
              onOpen();
              setContextPicker(true);
            }}
          />
          <ComposerSubmit
            status={status}
            onStop={stop}
            blocked={
              loadingConversation ||
              active.historyStatus !== "ready" ||
              active.contextNeedsReview ||
              active.missingFiles.length > 0
            }
            className="ml-auto"
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );

  // Stable element identity from compact through wide/narrow/expanded. Neither
  // focus nor an IME composition ever moves the textarea to a second tree.
  return (
    <PromptInputProvider
      input={active.text}
      onInputChange={(text) => workspace.patch({ text }, active.key)}
      fileScopeKey={active.key}
      files={active.files}
      onFilesChange={(files) => workspace.attach(files, active.key)}
      prepareFiles={prepareAttachments}
      onError={onAttachError}
    >
      <ChatDropZone
        className={
          expanded
            ? "fixed inset-2 z-[60] flex flex-col overflow-hidden rounded-xl border bg-card shadow-2xl sm:inset-6"
            : `flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[inherit] ${open ? "bg-card" : "bg-transparent"}`
        }
      >
        <div className={open ? "contents" : "hidden"}>{header}</div>
        <div className={open ? "flex min-h-0 flex-1 flex-col" : "hidden"}>{thread}</div>
        {!open && (status === "streaming" || status === "submitted") && (
          <span role="status" className="sr-only">
            Response in progress · Open to view
          </span>
        )}
        {composer}
      </ChatDropZone>
      <ChatContextPicker
        onReturnFocus={() => libraryContextButton.current?.focus({ preventScroll: true })}
        open={contextPicker}
        onOpenChange={setContextPicker}
        onSelect={(context) => {
          workspace.patch({ context });
          setContextPicker(false);
        }}
      />
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
  blocked,
  className,
}: {
  status: ChatStatus;
  onStop: () => void;
  blocked?: boolean;
  className?: string;
}) {
  const { textInput, attachments } = usePromptInputController();
  const empty = textInput.value.trim().length === 0 && attachments.files.length === 0;
  const busy = status === "submitted" || status === "streaming";
  return (
    <PromptInputSubmit
      status={status === "error" ? "ready" : status}
      className={className}
      disabled={!busy && (empty || blocked || attachments.preparing)}
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

function ReattachFile({ filename }: { filename: string }) {
  const { attachments } = usePromptInputController();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 text-xs"
      aria-label={`Reattach ${filename}`}
      onClick={() => attachments.openFileDialog()}
    >
      Reattach
    </Button>
  );
}
