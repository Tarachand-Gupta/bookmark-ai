"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type ToolUIPart } from "ai";
import { Check, Copy, ExternalLink, Folder, Globe, Search, Sparkles, X } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Loader } from "@/components/ai-elements/loader";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Response } from "@/components/ai-elements/response";
import { Button } from "@/components/ui/button";
import type { LibraryFilters } from "@/lib/api";

interface BookmarkHit {
  id: string;
  title: string;
  url: string;
  domain: string;
  description: string | null;
  category: string;
  tags: string[];
  score: number;
  favicon: string | null;
}

interface SearchToolOutput {
  modeUsed: string;
  fallback: boolean;
  results: BookmarkHit[];
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
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      // Pin the wire format: the route handler expects the full history.
      prepareSendMessagesRequest: ({ messages }) => ({ body: { messages } }),
    }),
  });
  const seeded = useRef(false);

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
    void sendMessage({ text });
  };

  return (
    <div className="flex h-[calc(100vh-8.5rem)] min-h-[24rem] flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="size-4" aria-hidden />
          Ask your bookmarks
        </p>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>
          <X aria-hidden />
          Close
        </Button>
      </div>

      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 && (
            <ConversationEmptyState
              icon={<Sparkles className="size-8" aria-hidden />}
              title="Ask anything about your bookmarks"
              description="The agent searches your library with full-text and semantic tools, then answers with citations."
            />
          )}
          {messages.map((message) => (
            <Message from={message.role} key={message.id}>
              {/* w-full (not w-fit) so wide tool cards truncate instead of
                  propagating their intrinsic width and stretching the page. */}
              <MessageContent className={message.role === "assistant" ? "w-full" : undefined}>
                {message.parts.map((part, i) => {
                  if (part.type === "text") {
                    return <Response key={`${message.id}-${i}`}>{part.text}</Response>;
                  }
                  if (
                    part.type === "tool-searchFullText" ||
                    part.type === "tool-searchSemantic"
                  ) {
                    const tool = part as ToolUIPart;
                    return (
                      <SearchToolCall key={tool.toolCallId} part={tool} onFilter={onFilter} />
                    );
                  }
                  return null;
                })}
              </MessageContent>
            </Message>
          ))}
          {status === "submitted" && <Loader />}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t p-2">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea placeholder="Ask a follow-up…" />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputSubmit status={status} className="ml-auto" />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
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
  const semantic = part.type === "tool-searchSemantic";
  const input = part.input as { query?: string } | undefined;
  const output = part.output as SearchToolOutput | undefined;
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
        <span className="shrink-0 font-medium">
          {semantic ? "Semantic search" : "Full-text search"}
        </span>
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
        <BookmarkHits
          hits={output.results}
          showScore={output.modeUsed === "ai"}
          onFilter={onFilter}
        />
      )}
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
      {hits.map((r) => (
        <li
          key={r.id}
          className="flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-muted/50"
        >
          {r.favicon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.favicon} alt="" className="mt-0.5 size-4 shrink-0 rounded-sm" />
          ) : (
            <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              {/* line-clamp-1 (not truncate): nowrap text would set the row's
                  intrinsic min-content width and stretch the page sideways. */}
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer noopener"
                className="line-clamp-1 min-w-0 text-sm font-medium hover:underline [overflow-wrap:anywhere]"
              >
                {r.title}
              </a>
              {showScore && (
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {Math.round(r.score * 100)}% match
                </span>
              )}
            </div>
            <p className="line-clamp-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {r.domain}
              {r.description ? ` — ${r.description}` : ""}
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
            <Button variant="ghost" size="icon" className="size-7" asChild>
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`Open ${r.title}`}
                title="Open in new tab"
              >
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </Button>
          </div>
        </li>
      ))}
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
