"use client";

import { useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type ToolUIPart } from "ai";
import { Globe, Sparkles, X } from "lucide-react";
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
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";

interface BookmarkHit {
  id: string;
  title: string;
  url: string;
  domain: string;
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
}

/**
 * Conversational search over the library. The agent (see app/api/chat/route.ts)
 * decides between the full-text and semantic search tools and cites bookmarks.
 */
export function AiChat({ initialQuery, onClose }: AiChatProps) {
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
              <MessageContent>
                {message.parts.map((part, i) => {
                  if (part.type === "text") {
                    return <Response key={`${message.id}-${i}`}>{part.text}</Response>;
                  }
                  if (
                    part.type === "tool-searchFullText" ||
                    part.type === "tool-searchSemantic"
                  ) {
                    const tool = part as ToolUIPart;
                    const output = tool.output as SearchToolOutput | undefined;
                    return (
                      <Tool key={tool.toolCallId}>
                        <ToolHeader type={tool.type} state={tool.state} />
                        <ToolContent>
                          <ToolInput input={tool.input} />
                          <ToolOutput
                            errorText={tool.errorText}
                            output={output ? <BookmarkHits output={output} /> : null}
                          />
                        </ToolContent>
                      </Tool>
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

/** Compact cited-bookmark list rendered inside a tool result. */
function BookmarkHits({ output }: { output: SearchToolOutput }) {
  if (!output.results?.length) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">No matches in the library.</p>;
  }
  return (
    <div className="divide-y">
      {output.results.map((r) => (
        <a
          key={r.id}
          href={r.url}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-muted/60"
        >
          {r.favicon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.favicon} alt="" className="size-4 shrink-0 rounded-sm" />
          ) : (
            <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {r.domain} · {r.category}
          </span>
        </a>
      ))}
    </div>
  );
}
