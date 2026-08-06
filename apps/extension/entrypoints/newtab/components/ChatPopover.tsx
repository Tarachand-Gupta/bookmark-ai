import { useEffect, useRef, useState } from "react";
import type { NewTabActiveContext, NewTabTemplate } from "@bookmark-ai/types";
import { sendChat } from "../api";
import { Spinner } from "../../popup/components/Spinner";

/**
 * Chat with the agent about your tab (§4.7/§4.3.2). The ACTIVE template rides
 * every request as `activeContext` (the "open file"); removing the chip starts
 * a clean "new template" turn. When the agent writes a template server-side,
 * the stream's tool output carries the saved row — onTemplateApplied hot-swaps
 * the iframe without a reload.
 */

interface Entry {
  role: "you" | "agent";
  text: string;
}

let messageSeq = 0;

export function ChatPopover({
  activeTemplate,
  getRenderedData,
  onTemplateApplied,
  onClose,
}: {
  activeTemplate: NewTabTemplate | null;
  /** Latest bridge-response cache — the data currently on screen (§4.8). */
  getRenderedData: () => Record<string, unknown>;
  onTemplateApplied: (t: NewTabTemplate) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chipOn, setChipOn] = useState(true);
  const conversationId = useRef<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    setEntries((e) => [...e, { role: "you", text }]);
    try {
      const activeContext: NewTabActiveContext | undefined =
        chipOn && activeTemplate
          ? {
              templateId: activeTemplate.id,
              name: activeTemplate.name,
              html: activeTemplate.html,
              renderedData: getRenderedData(),
            }
          : undefined;
      const result = await sendChat({
        messages: [{ id: `m${++messageSeq}`, role: "user", parts: [{ type: "text", text }] }],
        conversationId: conversationId.current,
        activeContext,
      });
      if (result.conversationId) conversationId.current = result.conversationId;
      if (result.template) onTemplateApplied(result.template);
      setEntries((e) => [
        ...e,
        {
          role: "agent",
          text:
            result.text.trim() ||
            (result.template
              ? `Updated “${result.template.name}” — your tab is showing it now.`
              : "(no reply)"),
        },
      ]);
    } catch (err) {
      setEntries((e) => [...e, { role: "agent", text: `⚠ ${(err as Error).message}` }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="absolute bottom-16 right-4 z-20 flex h-[420px] w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-2xl">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="flex-1 text-[13px] font-medium">Design your tab</span>
        {chipOn && activeTemplate ? (
          <button
            type="button"
            onClick={() => setChipOn(false)}
            title="Editing this template — click to start a new one"
            className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {activeTemplate.name} ×
          </button>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            new template
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-1 text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
        {entries.length === 0 && (
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">
            Describe a layout — “a 3-column grid of my most-used domains with a search box
            on top”, “Reddit-style list of my recent saves”, “make the cards bigger and
            rounded”. The agent writes the tab and it appears here instantly.
          </p>
        )}
        {entries.map((e, i) => (
          <div
            key={i}
            className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-1.5 text-[13px] leading-snug ${
              e.role === "you" ? "self-end bg-primary text-primary-foreground" : "self-start bg-muted"
            }`}
          >
            {e.text}
          </div>
        ))}
        {sending && (
          <div className="flex items-center gap-2 self-start rounded-xl bg-muted px-3 py-1.5 text-[13px] text-muted-foreground">
            <Spinner /> Working…
          </div>
        )}
      </div>

      <form
        className="flex items-center gap-2 border-t p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe the change…"
          autoFocus
          className="flex-1 rounded-lg border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="rounded-lg bg-primary px-2.5 py-1.5 text-[13px] font-medium text-primary-foreground disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
