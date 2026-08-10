"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Database, FileText, Globe, Layers, Radio, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CHAT_SAMPLE_PROMPTS,
  SAMPLE_PROMPT_ROTATION_MS,
  SAMPLE_PROMPT_SLIDE_MS,
  SAMPLE_PROMPT_VISIBLE,
  nextPromptOffset,
  promptWindow,
  shufflePrompts,
  type SamplePrompt,
  type SamplePromptKind,
} from "@/lib/chat-prompts";

/** One icon per tool family — the same glyphs the tool-call cards use in the
 * thread, so a prompt visually promises the block it will produce. */
const KIND_ICONS: Record<SamplePromptKind, React.ElementType> = {
  search: Search,
  sql: Database,
  sessions: Layers,
  live: Radio,
  web: Globe,
  read: FileText,
};

/** Accelerate–decelerate, per the owner's spec; `ease-*` utilities only touch
 * transitions, so the animation timing goes on the style attribute. */
const SLIDE_TIMING: React.CSSProperties = {
  animationDuration: `${SAMPLE_PROMPT_SLIDE_MS}ms`,
  animationTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
};

export interface ChatSamplePromptsProps {
  /** Sends the prompt as a user message immediately (see the click note below). */
  onPick: (text: string) => void;
  className?: string;
}

/**
 * Rotating sample prompts for the chat's empty state — the answer to "I opened
 * this box, now what do I type?".
 *
 * Four cards at a time, paging through the pool every 4s with a carousel SLIDE:
 * the outgoing set glides out to the left while the next enters from the right,
 * one continuous ease-in-out motion (a crossfade here read as "blinking" —
 * owner feedback). Behaviors worth keeping:
 *  - HOVER/FOCUS PAUSES the rotation. Nothing is more hostile than a card that
 *    slides out from under a cursor that was about to click it.
 *  - prefers-reduced-motion ⇒ NO rotation and no slide: one static set of four.
 *  - The pool renders UNSHUFFLED on the server and shuffles in a mount effect:
 *    shuffling in a useState initializer runs during SSR too, and the server's
 *    order vs the client's order is a guaranteed hydration mismatch (QA-caught,
 *    React #418 on every ?ai=1 load).
 *  - LAYOUT is a container query, not a breakpoint: ≥640px of container ⇒ a 2×2
 *    grid; below ⇒ four single-line rows. The grid is width-capped and centered —
 *    stretched edge-to-edge across the ~1000px expanded panel the tiles were
 *    mostly empty space (owner feedback).
 *  - Clicking a card SENDS. Auto-send on an explicit click is right — the user
 *    picked a complete question. Real <button>s: tab-reachable, labelled.
 */
export function ChatSamplePrompts({ onPick, className }: ChatSamplePromptsProps) {
  // SSR-stable order first; shuffled once after mount (see doc comment).
  const [pool, setPool] = useState<SamplePrompt[]>(CHAT_SAMPLE_PROMPTS);
  const [offset, setOffset] = useState(0);
  // The set sliding OUT — non-null only during the transition.
  const [outgoing, setOutgoing] = useState<SamplePrompt[] | null>(null);
  // Paused while the pointer is over the grid or focus is inside it.
  const [paused, setPaused] = useState(false);
  // `null` until measured on the client: reduced-motion is only knowable there,
  // and we must not rotate for one tick before finding out.
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const slideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setPool(shufflePrompts(CHAT_SAMPLE_PROMPTS));
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reduceMotion !== false || paused) return;
    const id = window.setInterval(() => {
      // Snapshot the current four as the outgoing layer, advance, and let the
      // pair of animations run; the outgoing layer unmounts when they finish.
      setOffset((current) => {
        setOutgoing(promptWindow(pool, current, SAMPLE_PROMPT_VISIBLE));
        return nextPromptOffset(current, pool.length);
      });
      slideTimer.current = setTimeout(() => setOutgoing(null), SAMPLE_PROMPT_SLIDE_MS);
    }, SAMPLE_PROMPT_ROTATION_MS);
    return () => {
      window.clearInterval(id);
      clearTimeout(slideTimer.current);
      // Never strand a half-finished slide when pausing/unmounting.
      setOutgoing(null);
    };
  }, [reduceMotion, paused, pool]);

  const shown = useMemo(
    () => promptWindow(pool, offset, SAMPLE_PROMPT_VISIBLE),
    [pool, offset],
  );

  return (
    <div
      className={cn("@container w-full", className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* Width-capped and centered so wide panels get comfortable tiles, not
          edge-to-edge slabs. */}
      <div className="mx-auto w-full max-w-2xl">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Try asking
        </p>
        {/* The slide stage: outgoing set exits left as an absolute layer while
            the current set enters from the right underneath it. Heights match
            (same card geometry), so the absolute layer never uncovers a gap. */}
        <div className="relative overflow-hidden">
          {outgoing && (
            <PromptGrid
              prompts={outgoing}
              onPick={onPick}
              aria-hidden
              className="pointer-events-none absolute inset-0 animate-out slide-out-to-left-full fill-mode-both"
              style={SLIDE_TIMING}
            />
          )}
          <PromptGrid
            prompts={shown}
            onPick={onPick}
            className={cn(
              outgoing && "animate-in slide-in-from-right-full fill-mode-both motion-reduce:animate-none",
            )}
            style={outgoing ? SLIDE_TIMING : undefined}
          />
        </div>
      </div>
    </div>
  );
}

function PromptGrid({
  prompts,
  onPick,
  className,
  style,
  ...rest
}: {
  prompts: SamplePrompt[];
  onPick: (text: string) => void;
  className?: string;
  style?: React.CSSProperties;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("grid grid-cols-1 gap-1.5 @[40rem]:grid-cols-2 @[40rem]:gap-2", className)}
      style={style}
      {...rest}
    >
      {prompts.map((prompt) => {
        const Icon = KIND_ICONS[prompt.kind];
        return (
          <button
            key={prompt.id}
            type="button"
            onClick={() => onPick(prompt.text)}
            className={cn(
              "group flex items-center gap-2 rounded-lg border bg-background px-2.5 py-2 text-left text-xs leading-snug transition-colors",
              "hover:border-primary/40 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              // Wide: a tile with the icon and question grouped together (a
              // justify-between here left a void in the card's middle — owner
              // feedback), min-height only for row alignment.
              "@[40rem]:min-h-[5.5rem] @[40rem]:flex-col @[40rem]:items-start @[40rem]:justify-start @[40rem]:gap-2 @[40rem]:p-3 @[40rem]:text-[13px]",
            )}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
              <Icon className="size-3.5" aria-hidden />
            </span>
            {/* line-clamp rather than truncate: nowrap text would set the card's
                min-content width and stretch the whole panel. */}
            <span className="line-clamp-2 min-w-0 flex-1 @[40rem]:line-clamp-3 @[40rem]:flex-none">
              {prompt.text}
            </span>
          </button>
        );
      })}
    </div>
  );
}
