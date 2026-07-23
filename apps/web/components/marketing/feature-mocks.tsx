"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Layers, Loader2, ScanSearch, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { BookmarkMark, mono } from "./primitives";

/**
 * The feature-card mocks, dramatized. Each is a small looping state machine —
 * plain React state advanced on a timer, transitions done in CSS (no animation
 * library needed at this size). All motion is gated behind
 * prefers-reduced-motion; a reduced-motion or no-JS visitor gets the *last*
 * phase already in place — a finished, true picture, never a half state.
 *
 * Nothing here is interactive: it's narration for the copy beside it, so every
 * mock is aria-hidden and pointer-events-none.
 */

/**
 * Cycles through `durations` (ms to hold each phase before advancing), looping
 * forever. Starts on the *last* phase — the "settled" one every mock is
 * authored to end on — so SSR, no-JS and reduced-motion all render that frame.
 * `offsetMs` staggers a mock's first flip relative to its neighbours, so a
 * whole row of cards doesn't pulse in lockstep.
 */
function usePhaseLoop(durations: number[], offsetMs = 0): number {
  const [phase, setPhase] = useState(durations.length - 1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const run = (i: number) => {
      if (cancelled) return;
      setPhase(i);
      timers.push(setTimeout(() => run((i + 1) % durations.length), durations[i]));
    };
    timers.push(setTimeout(() => run(0), offsetMs));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // `durations` arrays below are module-level constants — stable references.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durations, offsetMs]);

  return phase;
}

/** A one-glance extension popup: the active page, and the button that saves it. */
const SAVE_PHASES = [1100, 500, 900, 1700]; // idle · arrive · saving · saved+settled

function SaveBookmarkMock() {
  const phase = usePhaseLoop(SAVE_PHASES, 0);
  const arriving = phase === 1;
  const saving = phase === 2;
  const saved = phase === 3;
  const atButton = phase === 1 || phase === 2;

  return (
    <div
      aria-hidden
      className="pointer-events-none relative rounded-xl border border-border/60 bg-card/50 p-3 shadow-sm"
    >
      <div className="flex items-center gap-1.5">
        <span className="flex size-4 items-center justify-center rounded bg-primary text-[8px] font-bold leading-none text-primary-foreground">
          B
        </span>
        <span className="text-[11px] font-semibold tracking-tight">Bookmark AI</span>
      </div>
      <div className="mt-2.5 rounded-lg border border-border/60 bg-background/50 p-2.5 dark:bg-white/[0.03]">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              mono,
              "flex size-6 shrink-0 items-center justify-center rounded border border-border/60 bg-foreground/[0.06] text-[10px] font-semibold text-foreground/70",
            )}
          >
            A
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium leading-tight">
              Attention Is All You Need
            </p>
            <p className={cn(mono, "truncate text-[9px] leading-tight text-muted-foreground")}>
              arxiv.org/abs/1706.03762
            </p>
          </div>
        </div>

        {/* Button — three states stacked, cross-faded, no reflow. */}
        <div
          className={cn(
            "relative mt-2.5 h-7 w-full rounded-md bg-primary text-[11px] font-medium text-primary-foreground shadow-sm",
            "transition-transform duration-150 ease-out motion-reduce:transition-none",
            arriving && "scale-[0.97]",
          )}
        >
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center gap-1.5 transition-opacity duration-150 motion-reduce:transition-none",
              saving || saved ? "opacity-0" : "opacity-100",
            )}
          >
            <BookmarkMark className="size-3" />
            Save bookmark
          </span>
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center gap-1.5 transition-opacity duration-150 motion-reduce:transition-none",
              saving ? "opacity-100" : "opacity-0",
            )}
          >
            <Loader2 className="size-3 motion-safe:animate-spin" aria-hidden />
            Saving…
          </span>
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center gap-1.5 transition-opacity duration-150 motion-reduce:transition-none",
              saved ? "opacity-100" : "opacity-0",
            )}
          >
            <Check className="size-3" aria-hidden />
            Saved
          </span>
        </div>
      </div>

      {/* The bookmark, settled into the library — reserved space, so nothing
          in the card reflows as it fades in. */}
      <div
        className={cn(
          "mt-2 flex items-center gap-2 rounded-lg border border-border/50 bg-background/40 px-2 py-1.5",
          "transition-all duration-500 ease-out motion-reduce:transition-none",
          saved ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
        )}
      >
        <span
          className={cn(
            mono,
            "flex size-4 shrink-0 items-center justify-center rounded border border-border/60 bg-foreground/[0.06] text-[8px] font-semibold text-foreground/70",
          )}
        >
          A
        </span>
        <p className="min-w-0 flex-1 truncate text-[10px] font-medium leading-tight">
          Attention Is All You Need
        </p>
        <Check className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      </div>

      {/* The hand, arriving on the button. */}
      <span
        className={cn(
          "absolute size-2.5 rounded-full border-2 border-background bg-foreground/80 shadow-sm",
          "transition-all duration-500 ease-out motion-reduce:hidden",
        )}
        style={atButton ? { top: "58%", left: "60%", opacity: 1 } : { top: "8%", left: "88%", opacity: 0 }}
      />
    </div>
  );
}

/** Categories fill, then tags — the shape of what lands on every save. */
const FILE_PHASES = [950, 2300]; // unfiled · filed (staggered chips)

function CategoryChipsMock() {
  const phase = usePhaseLoop(FILE_PHASES, 650);
  const filed = phase === 1;
  const categories = ["Development"];
  const tags = ["#tools", "#focus", "#notes", "#deepwork"];

  return (
    <div
      aria-hidden
      className="pointer-events-none rounded-xl border border-border/60 bg-card/50 p-3 shadow-sm"
    >
      {/* The new, still-unfiled save. */}
      <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/50 px-2 py-1.5">
        <span
          className={cn(
            mono,
            "flex size-5 shrink-0 items-center justify-center rounded border border-border/60 bg-foreground/[0.06] text-[10px] font-semibold text-foreground/70",
          )}
        >
          N
        </span>
        <p className="min-w-0 flex-1 truncate text-[11px] font-medium leading-tight">
          Notes on distributed systems
        </p>
        <Sparkles
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-opacity duration-300 motion-reduce:transition-none",
            filed ? "opacity-0" : "opacity-100 motion-safe:animate-pulse",
          )}
          aria-hidden
        />
      </div>

      <p className={cn(mono, "mt-3 text-[9px] uppercase tracking-wider text-muted-foreground/70")}>
        category
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {categories.map((c, i) => (
          <span
            key={c}
            style={{ transitionDelay: filed ? `${i * 90}ms` : "0ms" }}
            className={cn(
              mono,
              "rounded-md bg-primary/90 px-2 py-0.5 text-[10px] font-medium text-primary-foreground",
              "transition-all duration-300 ease-out motion-reduce:transition-none",
              filed ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-90 opacity-0",
            )}
          >
            {c}
          </span>
        ))}
      </div>

      <p className={cn(mono, "mt-3 text-[9px] uppercase tracking-wider text-muted-foreground/70")}>
        tags
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {tags.map((t, i) => (
          <span
            key={t}
            style={{ transitionDelay: filed ? `${120 + i * 90}ms` : "0ms" }}
            className={cn(
              mono,
              "rounded-full border border-border/60 bg-background/50 px-2 py-0.5 text-[10px] text-muted-foreground",
              "transition-all duration-300 ease-out motion-reduce:transition-none",
              filed ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-90 opacity-0",
            )}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A window of tabs collapsing into one restorable session pill. */
const SESSION_PHASES = [1700, 1700]; // expanded · collapsed

function SessionMock() {
  const phase = usePhaseLoop(SESSION_PHASES, 1300);
  const collapsed = phase === 1;
  const tabs = [
    { letter: "M", title: "Server-Sent Events — the guide" },
    { letter: "R", title: "Redis pub/sub in production" },
    { letter: "F", title: "Fastify streaming responses" },
  ];

  return (
    <div
      aria-hidden
      className="pointer-events-none rounded-xl border border-border/60 bg-card/50 p-3 shadow-sm"
    >
      {/* One slot, two states, cross-faded — the stack "becomes" the pill
          rather than pushing it below, so the card never reflows. */}
      <div className="relative min-h-[6.9rem]">
        <div
          className={cn(
            "absolute inset-0 origin-top transition-all duration-500 ease-out motion-reduce:transition-none",
            collapsed ? "scale-[0.97] opacity-0" : "scale-100 opacity-100",
          )}
        >
          <div className="space-y-1.5">
            {tabs.map((t) => (
              <div
                key={t.letter}
                className="flex items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1.5"
              >
                <span
                  className={cn(
                    mono,
                    "flex size-5 shrink-0 items-center justify-center rounded border border-border/60 bg-foreground/[0.06] text-[10px] font-semibold text-foreground/70",
                  )}
                >
                  {t.letter}
                </span>
                <p className="truncate text-[11px] font-medium leading-tight">{t.title}</p>
              </div>
            ))}
          </div>
          <div className="my-1.5 flex justify-center text-muted-foreground/60">
            <ChevronDown className="size-4" aria-hidden />
          </div>
        </div>

        <div
          className={cn(
            "absolute inset-0 flex items-center transition-all duration-500 ease-out motion-reduce:transition-none",
            collapsed ? "scale-100 opacity-100" : "scale-95 opacity-0",
          )}
        >
          <div className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-foreground/[0.04] px-2.5 py-2">
            <Layers className="size-4 shrink-0 text-foreground/70" aria-hidden />
            <span className="truncate text-[11px] font-medium">Research session</span>
            <span
              className={cn(
                mono,
                "ml-auto shrink-0 rounded-full border border-border/60 bg-background/50 px-2 py-0.5 text-[9px] text-muted-foreground",
              )}
            >
              7 tabs
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A small, honest recreation of semantic search — query vs. matched result. */
const SEARCH_PHASES = [1000, 2600]; // query only · matched

function SearchDemo() {
  const phase = usePhaseLoop(SEARCH_PHASES, 300);
  const matched = phase === 1;

  return (
    <div aria-hidden className="pointer-events-none mt-6 space-y-2.5">
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/50 px-3 py-2.5">
        <ScanSearch
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-opacity duration-300 motion-reduce:transition-none",
            !matched && "motion-safe:animate-pulse",
          )}
          aria-hidden
        />
        <span className={cn(mono, "truncate text-sm text-foreground")}>
          focus without burning out
        </span>
      </div>
      <div
        className={cn(
          "relative flex items-center gap-3 rounded-lg border p-3",
          "transition-all duration-500 ease-out motion-reduce:transition-none",
          matched ? "translate-y-0 border-border/60 bg-card/50 opacity-100" : "translate-y-1 border-border/40 bg-card/30 opacity-60",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute -inset-0.5 rounded-lg ring-2 ring-foreground/25 transition-opacity duration-300 motion-reduce:transition-none dark:ring-white/25",
            matched ? "opacity-100" : "opacity-0",
          )}
        />
        <span
          className={cn(
            mono,
            "flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-foreground/[0.06] text-xs font-semibold text-foreground/70",
          )}
          aria-hidden
        >
          Z
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            The art of doing one thing at a time
          </p>
          <p className={cn(mono, "truncate text-[11px] text-muted-foreground")}>
            zenhabits.net
          </p>
        </div>
        <span
          style={{ transitionDelay: matched ? "150ms" : "0ms" }}
          className={cn(
            mono,
            "shrink-0 rounded-full border border-border/60 bg-background/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground",
            "transition-all duration-300 ease-out motion-reduce:transition-none",
            matched ? "scale-100 opacity-100" : "scale-90 opacity-0",
          )}
        >
          top match
        </span>
      </div>
      <p
        className={cn(
          mono,
          "px-1 text-[11px] text-muted-foreground/80 transition-opacity duration-300 motion-reduce:transition-none",
          matched ? "opacity-100" : "opacity-0",
        )}
      >
        &mdash; matched on meaning; those words never appear on the page.
      </p>
    </div>
  );
}

export { CategoryChipsMock, SaveBookmarkMock, SearchDemo, SessionMock };
