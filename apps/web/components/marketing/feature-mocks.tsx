"use client";

import { useEffect, useState } from "react";
import {
  AppWindow,
  Check,
  Columns3,
  Layers,
  Loader2,
  Lock,
  MousePointer2,
  Puzzle,
  ScanSearch,
  Sparkles,
} from "lucide-react";
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

/**
 * Scoped keyframes shared by the mocks: a blinking text caret and a click
 * ripple. Duplicated <style> blocks across islands are identical and harmless
 * (same pattern as live-tabs). Both are gated behind no-preference so a
 * reduced-motion visitor gets a still frame.
 */
const KEYFRAMES = `
@keyframes fm-caret { 0%, 45% { opacity: 1; } 55%, 100% { opacity: 0; } }
@keyframes fm-ripple {
  0%   { transform: translate(-50%, -50%) scale(0.5); opacity: 0.55; }
  100% { transform: translate(-50%, -50%) scale(1.7); opacity: 0; }
}
@media (prefers-reduced-motion: no-preference) {
  .fm-caret { animation: fm-caret 1.05s steps(1, end) infinite; }
  .fm-ripple { animation: fm-ripple 0.5s ease-out forwards; }
}
`;

/** The cursor — a real pointer arrow that glides between targets. */
function Cursor({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <MousePointer2
      aria-hidden
      className={cn(
        "absolute z-30 size-4 -translate-x-[3px] -translate-y-[2px] fill-foreground text-background drop-shadow-sm",
        "transition-all duration-500 ease-out motion-reduce:hidden",
        className,
      )}
      style={style}
    />
  );
}

/** A click ripple, mounted only while a click is landing. */
function Ripple({ style }: { style?: React.CSSProperties }) {
  return (
    <span
      aria-hidden
      className="fm-ripple absolute z-20 size-6 rounded-full border-2 border-foreground/40 motion-reduce:hidden"
      style={style}
    />
  );
}

/**
 * SAVE BOOKMARKS — a browser window with the Bookmark AI extension pinned in the
 * toolbar. The cursor reaches for the toolbar icon, clicks it, the popup drops
 * open anchored beneath the icon, and the save button runs Saving… → Saved.
 */
const SAVE_PHASES = [1000, 560, 380, 720, 880, 2000];
// 0 idle · 1 cursor→icon · 2 click icon · 3 popup opens, cursor→button · 4 saving · 5 saved (settled)

function SaveBookmarkMock({ className }: { className?: string }) {
  // `className` is optional and unused on the landing page — it exists so the
  // in-app onboarding tour can re-space this same animation inside its own stage.
  const phase = usePhaseLoop(SAVE_PHASES, 0);
  const open = phase >= 3; // popup visible from the moment it drops
  const atButton = phase >= 3; // cursor moves down onto the save button
  const clickIcon = phase === 2;
  const saving = phase === 4;
  const saved = phase === 5;
  const clickButton = phase === 4;

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none relative select-none overflow-hidden rounded-xl border border-border/60 bg-card/60 shadow-sm",
        className,
      )}
    >
      <style>{KEYFRAMES}</style>

      {/* Chrome-style top bar: traffic lights · omnibox · pinned extension. */}
      <div className="flex items-center gap-2 border-b border-border/60 bg-foreground/[0.03] px-2.5 py-1.5">
        <div className="flex shrink-0 items-center gap-1">
          <span className="size-1.5 rounded-full bg-border" />
          <span className="size-1.5 rounded-full bg-border" />
          <span className="size-1.5 rounded-full bg-border" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded-full border border-border/50 bg-background/70 px-2 py-0.5">
          <Lock className="size-2 shrink-0 text-muted-foreground/70" aria-hidden />
          <span className={cn(mono, "truncate text-[8px] text-muted-foreground")}>
            arxiv.org/abs/1706.03762
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Puzzle className="size-3 text-muted-foreground/50" aria-hidden />
          {/* The pinned Bookmark AI icon — the cursor's first target. */}
          <span
            className={cn(
              "relative flex size-4 items-center justify-center rounded bg-primary text-[8px] font-bold leading-none text-primary-foreground shadow-sm",
              "transition-all duration-200 motion-reduce:transition-none",
              clickIcon && "scale-90 ring-2 ring-primary/30 ring-offset-1 ring-offset-background",
            )}
          >
            B
            {clickIcon && <Ripple style={{ left: "50%", top: "50%" }} />}
          </span>
        </div>
      </div>

      {/* Viewport: a faint page, with the popup dropping in from the toolbar. */}
      <div className="relative min-h-[9.5rem] px-2.5 pb-2.5 pt-2">
        {/* Faint page content behind the popup. */}
        <div className="space-y-1.5 opacity-60">
          <div className="h-2 w-2/5 rounded bg-foreground/[0.08]" />
          <div className="h-1.5 w-full rounded bg-foreground/[0.05]" />
          <div className="h-1.5 w-11/12 rounded bg-foreground/[0.05]" />
          <div className="h-1.5 w-3/4 rounded bg-foreground/[0.05]" />
        </div>

        {/* The popup — origin top-right, so it scales open *from* the icon. */}
        <div
          className={cn(
            "absolute right-1.5 top-1 w-[86%] origin-top-right rounded-lg border border-border/70 bg-card shadow-[0_12px_30px_-12px_rgb(0_0_0/0.35)]",
            "transition-all duration-300 ease-out motion-reduce:transition-none",
            open ? "scale-100 opacity-100" : "-translate-y-1 scale-90 opacity-0",
          )}
        >
          {/* Caret joining the popup to the toolbar icon above it. */}
          <span
            aria-hidden
            className="absolute -top-[5px] right-[9px] size-2 rotate-45 rounded-[1px] border-l border-t border-border/70 bg-card"
          />
          <div className="p-2.5">
            <div className="flex items-center gap-1.5">
              <span className="flex size-4 items-center justify-center rounded bg-primary text-[8px] font-bold leading-none text-primary-foreground">
                B
              </span>
              <span className="text-[11px] font-semibold tracking-tight">Bookmark AI</span>
            </div>

            <div className="mt-2 flex items-center gap-2 rounded-md border border-border/60 bg-background/50 p-1.5 dark:bg-white/[0.03]">
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
                  arxiv.org
                </p>
              </div>
            </div>

            {/* Save button — three states stacked, cross-faded, no reflow. */}
            <div
              className={cn(
                "relative mt-2 h-7 w-full rounded-md bg-primary text-[11px] font-medium text-primary-foreground shadow-sm",
                "transition-transform duration-150 ease-out motion-reduce:transition-none",
                clickButton && "scale-[0.97]",
              )}
            >
              {clickButton && <Ripple style={{ left: "50%", top: "50%" }} />}
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
        </div>

        {/* The cursor: parked → toolbar icon → save button, then it fades. */}
        <Cursor
          style={
            saved
              ? { top: "56%", left: "60%", opacity: 0 }
              : atButton
                ? { top: "56%", left: "60%", opacity: 1 }
                : phase >= 1
                  ? { top: "-6%", left: "90%", opacity: 1 }
                  : { top: "82%", left: "24%", opacity: 0 }
          }
        />
      </div>
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

/**
 * SAVE WHOLE SESSION — a two-beat story. Beat 1: the extension popup captures a
 * window of tabs (cursor clicks "Save session & close", the stack collapses).
 * Beat 2: a crossfade into the dashboard's Saved-sessions view, where the new
 * session lands as a restorable card. Two panes share one slot, so nothing
 * reflows.
 */
const SESSION_PHASES = [1400, 620, 760, 700, 2200];
// 0 popup idle · 1 cursor→button · 2 click — tabs scoop AND dashboard rises together · 3-4 dashboard settled

const SESSION_TABS = [
  { letter: "M", title: "Server-Sent Events — the guide" },
  { letter: "R", title: "Redis pub/sub in production" },
  { letter: "F", title: "Fastify streaming responses" },
];

function SessionMock({ className }: { className?: string }) {
  // `className` is optional and unused on the landing page — it exists so the
  // in-app onboarding tour can re-space this same animation inside its own stage.
  const phase = usePhaseLoop(SESSION_PHASES, 1300);
  const atButton = phase === 1 || phase === 2;
  const clicking = phase === 2;
  const scooped = phase >= 2; // tabs collapse toward the button
  // Dashboard rises from the same phase the tabs scoop, so beat 2 is already
  // crossfading in as they leave — no sub-second empty-popup frame between them.
  const dashboard = phase >= 2;

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none relative select-none", className)}
    >
      <style>{KEYFRAMES}</style>
      <div className="relative min-h-[11.5rem]">
        {/* BEAT 1 — the capture popup. */}
        <div
          className={cn(
            "absolute inset-0 rounded-xl border border-border/60 bg-card/60 p-3 shadow-sm",
            "transition-all duration-500 ease-out motion-reduce:transition-none",
            dashboard ? "scale-[0.96] opacity-0" : "scale-100 opacity-100",
          )}
        >
          <div className="flex items-center gap-1.5">
            <span className="flex size-4 items-center justify-center rounded bg-primary text-[8px] font-bold leading-none text-primary-foreground">
              B
            </span>
            <span className="text-[11px] font-semibold tracking-tight">Bookmark AI</span>
          </div>

          {/* The window's tabs — they scoop down into the button on click. */}
          <div className="relative mt-2.5 space-y-1.5">
            {SESSION_TABS.map((t, i) => (
              <div
                key={t.letter}
                style={{ transitionDelay: scooped ? `${i * 60}ms` : "0ms" }}
                className={cn(
                  "flex items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1.5",
                  "transition-all duration-300 ease-in motion-reduce:transition-none",
                  scooped ? "translate-y-2 scale-95 opacity-0" : "translate-y-0 scale-100 opacity-100",
                )}
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

          {/* Save-session button — the cursor's target. */}
          <div
            className={cn(
              "relative mt-2.5 flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-[11px] font-medium text-primary-foreground shadow-sm",
              "transition-transform duration-150 ease-out motion-reduce:transition-none",
              clicking && "scale-[0.97]",
            )}
          >
            {clicking && <Ripple style={{ left: "50%", top: "50%" }} />}
            <Layers className="size-3" aria-hidden />
            Save session &amp; close (7 tabs)
          </div>

          <Cursor
            style={
              atButton
                ? { top: "82%", left: "52%", opacity: 1 }
                : { top: "104%", left: "30%", opacity: 0 }
            }
          />
        </div>

        {/* BEAT 2 — where it lands: the dashboard's Saved-sessions view. */}
        <div
          className={cn(
            "absolute inset-0 rounded-xl border border-border/60 bg-card/60 p-3 shadow-sm",
            "transition-all duration-500 ease-out motion-reduce:transition-none",
            dashboard ? "scale-100 opacity-100" : "scale-105 opacity-0",
          )}
        >
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Layers className="size-3.5" aria-hidden />
            <span className={cn(mono, "text-[9px] uppercase tracking-wider")}>Saved sessions</span>
          </div>

          {/* The freshly-saved session card. */}
          <div
            className={cn(
              "mt-2.5 rounded-lg border border-border/60 bg-background/50 p-2 shadow-sm",
              "transition-all delay-100 duration-500 ease-out motion-reduce:transition-none motion-reduce:delay-0",
              dashboard ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Layers className="size-3" aria-hidden />
              </span>
              <span className="truncate text-[11px] font-semibold">Research session</span>
              <span
                className={cn(
                  mono,
                  "ml-auto shrink-0 rounded-full border border-border/60 bg-card px-1.5 py-0.5 text-[8px] text-muted-foreground",
                )}
              >
                7 tabs
              </span>
            </div>

            <div className="mt-1.5 space-y-1">
              {SESSION_TABS.slice(0, 2).map((t) => (
                <div key={t.letter} className="flex items-center gap-1.5">
                  <span className="size-1.5 shrink-0 rounded-full bg-foreground/25" />
                  <p className="truncate text-[9px] text-muted-foreground">{t.title}</p>
                </div>
              ))}
              <p className={cn(mono, "pl-3 text-[8px] text-muted-foreground/60")}>+5 more</p>
            </div>

            {/* Restore buttons. */}
            <div className="mt-2 flex gap-1.5">
              <span className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border/60 bg-card px-1.5 py-1 text-[9px] font-medium">
                <AppWindow className="size-2.5" aria-hidden />
                New window
              </span>
              <span className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border/60 bg-card px-1.5 py-1 text-[9px] font-medium">
                <Columns3 className="size-2.5" aria-hidden />
                Tab group
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * SEARCH BY MEANING — a live search that types three real queries and returns
 * results, alternating semantic ("meaning") and full-text ("text") matches so
 * both search modes are visible. The caret types char-by-char, a "searching"
 * beat, then rows stagger in; hold; clear; next query; loop.
 */
type SearchResult = {
  letter: string;
  title: string;
  host: string;
  mode: "meaning" | "text";
  top?: boolean;
};
type SearchQuery = { text: string; results: SearchResult[] };

const SEARCH_QUERIES: SearchQuery[] = [
  {
    text: "that paper everyone cites about transformers",
    results: [
      { letter: "A", title: "Attention Is All You Need", host: "arxiv.org", mode: "meaning" },
      { letter: "I", title: "The Illustrated Transformer", host: "jalammar.github.io", mode: "meaning" },
      { letter: "T", title: "The Annotated Transformer", host: "nlp.seas.harvard.edu", mode: "meaning" },
      { letter: "B", title: "BERT: pre-training of deep transformers", host: "arxiv.org", mode: "meaning" },
    ],
  },
  {
    text: "react hooks",
    results: [
      { letter: "R", title: "Rules of Hooks", host: "react.dev", mode: "text" },
      { letter: "U", title: "useEffect — a complete guide", host: "overreacted.io", mode: "text" },
      { letter: "B", title: "Building your own Hooks", host: "react.dev", mode: "text" },
    ],
  },
  {
    text: "focus without burning out",
    results: [
      { letter: "Z", title: "The art of doing one thing at a time", host: "zenhabits.net", mode: "meaning", top: true },
      { letter: "D", title: "Deep Work: rules for focused success", host: "calnewport.com", mode: "meaning" },
      { letter: "P", title: "The power of a single daily priority", host: "nateliason.com", mode: "meaning" },
    ],
  },
];

type SearchStage = "typing" | "searching" | "results" | "clearing";
type SearchState = { q: number; typed: number; stage: SearchStage };

const LAST_QUERY = SEARCH_QUERIES.length - 1;

/**
 * The typing state machine. Settles (SSR / reduced-motion) on the last query,
 * fully typed with its results shown — the finished, honest frame.
 */
function useSearchCycle(): SearchState {
  const [state, setState] = useState<SearchState>({
    q: LAST_QUERY,
    typed: SEARCH_QUERIES[LAST_QUERY].text.length,
    stage: "results",
  });

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (fn: () => void, ms: number) => {
      timers.push(
        setTimeout(() => {
          if (!cancelled) fn();
        }, ms),
      );
    };

    const runQuery = (q: number) => {
      const text = SEARCH_QUERIES[q].text;

      const typeChar = (i: number) => {
        if (i > text.length) {
          setState({ q, typed: text.length, stage: "searching" });
          at(() => showResults(q), 620);
          return;
        }
        setState({ q, typed: i, stage: "typing" });
        // Slightly irregular cadence reads as real typing.
        at(() => typeChar(i + 1), 42 + Math.random() * 46);
      };

      const showResults = (qq: number) => {
        setState({ q: qq, typed: text.length, stage: "results" });
        at(() => clear(qq), 2500);
      };

      const clear = (qq: number) => {
        setState({ q: qq, typed: 0, stage: "clearing" });
        at(() => runQuery((qq + 1) % SEARCH_QUERIES.length), 650);
      };

      typeChar(0);
    };

    // Kick off from the first query after a short beat on the settled frame.
    at(() => runQuery(0), 700);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  return state;
}

function ModeBadge({ mode }: { mode: "meaning" | "text" }) {
  return (
    <span
      className={cn(
        mono,
        "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide",
        mode === "meaning"
          ? "border-primary/25 bg-primary/10 text-primary"
          : "border-border/60 bg-background/50 text-muted-foreground",
      )}
    >
      {mode}
    </span>
  );
}

function SearchDemo({ className }: { className?: string }) {
  // `className` is optional and unused on the landing page — it exists so the
  // in-app onboarding tour can re-space this same animation (override the
  // baked-in `mt-6`) inside its own stage.
  const { q, typed, stage } = useSearchCycle();
  const query = SEARCH_QUERIES[q];
  const shown = query.text.slice(0, typed);
  const searching = stage === "searching";
  const revealed = stage === "results";

  return (
    <div aria-hidden className={cn("pointer-events-none mt-6 select-none", className)}>
      <style>{KEYFRAMES}</style>

      {/* The query box — icon, live-typed text, blinking caret. */}
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/50 px-3 py-2.5">
        <ScanSearch
          className={cn(
            "size-4 shrink-0 text-muted-foreground",
            searching && "motion-safe:animate-pulse",
          )}
          aria-hidden
        />
        <div className={cn(mono, "flex min-h-[1.25rem] min-w-0 flex-1 items-center text-sm text-foreground")}>
          <span className="truncate">{shown}</span>
          <span
            className={cn(
              "fm-caret ml-px inline-block h-3.5 w-px shrink-0 bg-foreground/70",
              revealed && "opacity-0",
            )}
          />
        </div>
      </div>

      {/* Results — fixed height for four rows so switching queries never
          reflows. Rows stagger in on "results", out otherwise. */}
      <div className="mt-2.5 min-h-[11.5rem] space-y-2">
        {query.results.map((r, i) => (
          <div
            key={`${q}-${r.host}-${i}`}
            style={{ transitionDelay: revealed ? `${i * 80}ms` : "0ms" }}
            className={cn(
              "relative flex items-center gap-3 rounded-lg border p-2.5",
              "transition-all duration-500 ease-out motion-reduce:transition-none",
              revealed
                ? "translate-y-0 opacity-100"
                : "pointer-events-none translate-y-1 opacity-0",
              r.top
                ? "border-border/60 bg-card/60"
                : "border-border/50 bg-card/40",
            )}
          >
            {r.top && (
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute -inset-0.5 rounded-lg ring-2 ring-primary/30 transition-opacity duration-300 motion-reduce:transition-none",
                  revealed ? "opacity-100" : "opacity-0",
                )}
              />
            )}
            <span
              className={cn(
                mono,
                "flex size-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-foreground/[0.06] text-[11px] font-semibold text-foreground/70",
              )}
              aria-hidden
            >
              {r.letter}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium leading-tight">{r.title}</p>
              <p className={cn(mono, "truncate text-[10px] leading-tight text-muted-foreground")}>
                {r.host}
              </p>
            </div>
            {r.top ? (
              <span
                className={cn(
                  mono,
                  "shrink-0 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-primary",
                )}
              >
                top match
              </span>
            ) : (
              <ModeBadge mode={r.mode} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export { CategoryChipsMock, SaveBookmarkMock, SearchDemo, SessionMock };
