"use client";

import { useEffect, useRef, useState } from "react";
import type { ReasoningUIPart } from "ai";
import { Brain, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { reasoningSeconds } from "@/lib/chat-tools";
import { cn } from "@/lib/utils";
import { Markdown } from "./chat-markdown";

/**
 * One `reasoning` part (CONTRACT §6). While the model is thinking the
 * disclosure is OPEN and its label shimmers ("Thinking…"); the moment the
 * reasoning ends it folds to "Thought for N s" with a chevron to reopen. A
 * user who toggles it by hand wins over the automatic behaviour. Persisted
 * parts (reloaded from history) mount already finished, with no timing to
 * report, so they fold under a plain "Thought process".
 *
 * `live` = this message is the one currently streaming. It guards against a
 * part whose `state` is stuck at "streaming" after an aborted stream.
 */
export function ReasoningPart({ part, live }: { part: ReasoningUIPart; live: boolean }) {
  const streaming = live && part.state === "streaming";
  const startedAt = useRef(Date.now());
  // Mounted already-finished ⇒ history; there's no duration to compute.
  const mountedFinished = useRef(!streaming);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);

  useEffect(() => {
    if (!streaming && !mountedFinished.current && seconds === null) {
      setSeconds(reasoningSeconds(startedAt.current, Date.now()));
    }
  }, [streaming, seconds]);

  const text = part.text ?? "";
  if (!streaming && !text.trim()) return null;

  const open = userOpen ?? streaming;
  const label = streaming
    ? "Thinking…"
    : seconds !== null
      ? `Thought for ${seconds} s`
      : "Thought process";

  return (
    <Collapsible open={open} onOpenChange={setUserOpen} className="not-prose mb-1 w-full">
      <CollapsibleTrigger
        className={cn(
          "group -ml-1 flex max-w-full items-center gap-1.5 rounded-md py-1 pl-1 pr-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-label={streaming ? "Thinking — show the model's reasoning" : `${label} — toggle the model's reasoning`}
      >
        <Brain className="size-3.5 shrink-0" aria-hidden />
        <span className={cn("font-medium", streaming && "text-shimmer")}>{label}</span>
        <ChevronDown
          className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 border-l-2 border-border pl-3">
        {text.trim() ? (
          <Markdown muted>{text}</Markdown>
        ) : (
          <p className="text-xs text-muted-foreground">…</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
