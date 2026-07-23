"use client";

import { useEffect, useState } from "react";
import { Chrome, Monitor, MousePointer2 } from "lucide-react";
import { FEATURE_ICONS } from "@/components/library/feature-icons";
import { cn } from "@/lib/utils";
import { mono } from "./primitives";

/**
 * LIVE TABS, dramatized as the same three-beat journey the hero tells, sized for
 * a feature card. Same lightweight idiom as `feature-mocks.tsx`: a plain React
 * state machine advanced on a timer, transitions in CSS (no animation library at
 * this size). Two cross-fading panes in a fixed-height, non-reflowing slot:
 *
 *   Beat 1  · the extension's live-session card — the cursor flips the switch ON
 *             (emerald knob slide) and "Chrome on Mac" lights up.
 *   Beat 2  · the app's "Live sessions" sidebar item is clicked (Radio + emerald
 *             pip), the same glyph the real product uses.
 *   Beat 3  · the live device view fills — "Chrome on Mac", a LIVE pip, its open
 *             tabs streaming in staggered, mirrored onto a compact iPhone.
 *
 * Motion is gated behind prefers-reduced-motion; a reduced-motion / no-JS /
 * SSR visitor gets the *last* phase already settled — the finished live view,
 * a true picture, never a half state. Inert narration: aria-hidden, no inputs.
 */

type Tab = { title: string; host: string; letter: string };

// Honest, generic browsing — the kind of research session you'd actually park.
// Same cast as the hero's act two, so the two surfaces tell one story.
const TABS: Tab[] = [
  { title: "Server-Sent Events — the guide", host: "developer.mozilla.org", letter: "S" },
  { title: "Redis pub/sub in production", host: "redis.io", letter: "R" },
  { title: "Fastify streaming responses", host: "fastify.dev", letter: "F" },
  { title: "Expo Router — file-based routes", host: "docs.expo.dev", letter: "E" },
];

// ms to hold each phase before advancing. Settles on the last (the live view).
// 0 ext, cursor→switch · 1 switch ON, hold · 2 click "Live sessions" · 3 live (settled)
const PHASES = [1000, 1250, 950, 2700];

const KEYFRAMES = `
@keyframes ltd-ripple {
  0%   { transform: translate(-50%, -50%) scale(0.5); opacity: 0.5; }
  100% { transform: translate(-50%, -50%) scale(1.8); opacity: 0; }
}
@media (prefers-reduced-motion: no-preference) {
  .ltd-ripple { animation: ltd-ripple 0.5s ease-out forwards; }
}
`;

/**
 * Cycles through `PHASES`, looping forever. Starts on the *last* phase — the
 * settled live view — so SSR, no-JS and reduced-motion all render that frame.
 * Local copy of feature-mocks' idiom so this island stays self-contained.
 */
function usePhaseLoop(durations: number[]): number {
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
    timers.push(setTimeout(() => run(0), 0));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // `durations` is a module-level constant — a stable reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durations]);

  return phase;
}

export function LiveTabsDemo() {
  const phase = usePhaseLoop(PHASES);

  const toggledOn = phase >= 1; // the switch has been flipped
  const showApp = phase >= 2; // the app view has taken over from the extension
  const clickSwitch = phase === 1; // the flip is landing
  const clickNav = phase === 2; // "Live sessions" is being selected
  const streaming = phase >= 2; // tabs arrive as the app view appears

  return (
    <div aria-hidden className="pointer-events-none mt-6 select-none">
      <style>{KEYFRAMES}</style>
      {/* Fixed height, panes cross-fade inside it — no layout jump on the loop.
          Sized to the taller (live app) pane so nothing clips or overlaps. */}
      <div className="relative min-h-[15rem]">
        <ExtensionPane hidden={showApp} on={toggledOn} clicking={clickSwitch} />
        <LiveAppPane visible={showApp} clickingNav={clickNav} streaming={streaming} />
      </div>
    </div>
  );
}

/* ── Beat 1 · the extension live-session toggle ──────────────────────────── */

function ExtensionPane({
  hidden,
  on,
  clicking,
}: {
  hidden: boolean;
  on: boolean;
  clicking: boolean;
}) {
  return (
    <div
      className={cn(
        "absolute inset-x-0 top-0 transition-all duration-500 ease-out motion-reduce:transition-none",
        hidden ? "scale-[0.97] opacity-0" : "scale-100 opacity-100",
      )}
    >
      {/* Compressed extension popup — no full Chrome frame; it would crowd the
          card. Same card vocabulary as the hero's live-extension.tsx. */}
      <div className="relative mx-auto max-w-[19rem] rounded-xl border border-border/60 bg-card/70 p-3 shadow-sm">
        <div className="flex items-center gap-1.5">
          <span className="flex size-4 items-center justify-center rounded bg-primary text-[8px] font-bold leading-none text-primary-foreground">
            B
          </span>
          <span className="text-[11px] font-semibold tracking-tight">Bookmark AI</span>
        </div>

        {/* The real control (§4.9): a switch + the device it will share. */}
        <div className="mt-2.5 rounded-lg border border-border/60 bg-background/50 p-2.5 dark:bg-white/[0.03]">
          <div className="flex items-center gap-2.5">
            <Switch on={on} />
            <span className="flex-1 text-[11px] font-medium leading-tight">
              Share window as live session
            </span>
          </div>

          <div
            className={cn(
              "mt-2.5 flex items-center gap-1.5 border-t border-border/50 pt-2",
              "transition-opacity duration-500 ease-out motion-reduce:transition-none",
              on ? "opacity-100" : "opacity-40",
            )}
          >
            <Monitor className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <span className={cn(mono, "text-[10px] font-medium text-foreground/80")}>Chrome on Mac</span>
            <span className={cn(mono, "ml-auto text-[9px] text-emerald-600 dark:text-emerald-400")}>
              sharing
            </span>
          </div>
        </div>

        <p className={cn(mono, "mt-2 text-[9px] leading-snug text-muted-foreground")}>
          Sends every open tab so you can pick one up on your phone.
        </p>

        {/* The cursor reaches the switch and presses. */}
        {clicking && <Ripple style={{ left: "16%", top: "46%" }} />}
        <Cursor style={hidden ? { top: "80%", left: "34%", opacity: 0 } : { top: "46%", left: "16%", opacity: 1 }} />
      </div>
    </div>
  );
}

/** The extension's pill switch, mirroring the real one — emerald when on. */
function Switch({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-300 ease-out motion-reduce:transition-none",
        on ? "bg-emerald-500" : "bg-input",
      )}
    >
      <span
        className={cn(
          "inline-block size-4 rounded-full bg-background shadow transition-transform duration-300 ease-out motion-reduce:transition-none",
          on ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </span>
  );
}

/* ── Beats 2 & 3 · the app view, tabs streaming in ───────────────────────── */

function LiveAppPane({
  visible,
  clickingNav,
  streaming,
}: {
  visible: boolean;
  clickingNav: boolean;
  streaming: boolean;
}) {
  return (
    <div
      className={cn(
        "absolute inset-0 transition-all duration-500 ease-out motion-reduce:transition-none",
        visible ? "scale-100 opacity-100" : "scale-[1.03] opacity-0",
      )}
    >
      {/* Beat 2 — the "Live sessions" sidebar item, selected. Rendered as a
          single nav pill (not a full column) so it hints the click without
          stealing width from the device view below it. */}
      <div className="relative flex items-center gap-2">
        <div className="relative flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1">
          <span className="relative flex shrink-0 items-center justify-center">
            <FEATURE_ICONS.live className="size-3.5 text-foreground" aria-hidden />
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse"
            />
          </span>
          <span className="text-[11px] font-medium">Live sessions</span>
          {clickingNav && <Ripple style={{ left: "50%", top: "50%" }} />}
        </div>
        <span className={cn(mono, "text-[10px] text-muted-foreground")}>1 device open</span>
        <Cursor style={clickingNav ? { top: "44%", left: "13%", opacity: 1 } : { top: "44%", left: "13%", opacity: 0 }} />
      </div>

      {/* Beat 3 — the device and its live tabs, mirrored to a phone. */}
      <div className="mt-3 flex gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <LivePip />
            <Monitor className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 truncate text-[11px] font-medium">Chrome on Mac</span>
            <span
              className={cn(
                mono,
                "rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400",
              )}
            >
              live
            </span>
            <span className={cn(mono, "ml-auto shrink-0 text-[9px] text-muted-foreground")}>
              as of just now
            </span>
          </div>

          <div className="mt-1.5 rounded-lg border border-border/60 bg-card/50 p-1.5 shadow-sm">
            <div className="flex items-center gap-1.5 px-0.5">
              <Chrome className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-[10px] font-medium">Window 1</span>
              <span className={cn(mono, "text-[9px] text-muted-foreground")}>· {TABS.length} tabs</span>
            </div>
            <div className="mt-1 space-y-1">
              {TABS.map((t, i) => (
                <TabRow key={t.host} tab={t} arrived={streaming} delayMs={i * 130} />
              ))}
            </div>
          </div>
        </div>

        {/* iPhone mirror — the same tabs, on the phone, catching up a beat
            later. Hidden on very narrow single-column cards so it never crowds. */}
        <div className="hidden w-[7.5rem] shrink-0 sm:block">
          <PhoneMirror streaming={streaming} />
        </div>
      </div>
    </div>
  );
}

function PhoneMirror({ streaming }: { streaming: boolean }) {
  return (
    <div className="rounded-[1.1rem] border border-border/60 bg-card/60 p-1.5 shadow-sm">
      <div className="flex justify-center pb-1">
        <span className="h-0.5 w-6 rounded-full bg-foreground/20" />
      </div>
      <div className="flex items-center gap-1 px-0.5">
        <LivePip small />
        <span className="text-[9px] font-medium">iPhone</span>
      </div>
      <div className="mt-1.5 space-y-1">
        {TABS.map((t, i) => (
          <TabRow key={t.host} tab={t} arrived={streaming} delayMs={i * 130 + 360} compact />
        ))}
      </div>
    </div>
  );
}

function TabRow({
  tab,
  arrived,
  delayMs,
  compact,
}: {
  tab: Tab;
  arrived: boolean;
  delayMs: number;
  compact?: boolean;
}) {
  return (
    <div
      style={{ transitionDelay: arrived ? `${delayMs}ms` : "0ms" }}
      className={cn(
        "flex items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1 dark:bg-white/[0.03]",
        "transition-all duration-500 ease-out motion-reduce:transition-none motion-reduce:delay-0",
        arrived ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0",
        compact && "gap-1.5 px-1.5 py-1",
      )}
    >
      <span
        className={cn(
          mono,
          "flex shrink-0 items-center justify-center rounded border border-border/60 bg-foreground/[0.06] font-semibold text-foreground/70",
          compact ? "size-3.5 text-[8px]" : "size-5 text-[10px]",
        )}
        aria-hidden
      >
        {tab.letter}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate font-medium leading-tight", compact ? "text-[9px]" : "text-[11px]")}>
          {tab.title}
        </p>
        {!compact && (
          <p className={cn(mono, "truncate text-[9px] leading-tight text-muted-foreground")}>{tab.host}</p>
        )}
      </div>
    </div>
  );
}

/* ── Shared bits ─────────────────────────────────────────────────────────── */

/** A real pointer arrow that glides between targets (CSS transition on top/left). */
function Cursor({ style }: { style?: React.CSSProperties }) {
  return (
    <MousePointer2
      aria-hidden
      className={cn(
        "absolute z-30 size-4 -translate-x-[3px] -translate-y-[2px] fill-foreground text-background drop-shadow-sm",
        "transition-all duration-500 ease-out motion-reduce:hidden",
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
      className="ltd-ripple absolute z-20 size-6 rounded-full border-2 border-emerald-500/50 motion-reduce:hidden"
      style={style}
    />
  );
}

/** The emerald "reporting now" pip — a filled dot with a ping halo. */
function LivePip({ small }: { small?: boolean }) {
  const size = small ? "size-1.5" : "size-2";
  return (
    <span className={cn("relative flex shrink-0", size)} aria-hidden>
      <span className="absolute inset-0 rounded-full bg-emerald-500/70 motion-safe:animate-ping" />
      <span className={cn("relative rounded-full bg-emerald-500", size)} />
    </span>
  );
}
