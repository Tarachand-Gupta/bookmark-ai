"use client";

import { useEffect, useState } from "react";
import { Laptop, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { mono } from "./primitives";

/**
 * Live Tabs, dramatized. A laptop publishes its open tabs; they stream across a
 * wire and land on a phone one by one, in real time. The reveal is React-state
 * driven (a slow interval advancing how many tabs have arrived, then a pause and
 * a loop); the wire pulse and the "live" dot are CSS. All motion is gated behind
 * prefers-reduced-motion — a reduced-motion or no-JS visitor gets the finished
 * frame with every tab already mirrored, which is a true picture, not a blank.
 *
 * Nothing here is interactive: it's narration for the copy beside it, so it's
 * aria-hidden and pointer-events-none.
 */

type Tab = { title: string; host: string; letter: string };

// Honest, generic browsing — the kind of research session you'd actually park.
const TABS: Tab[] = [
  { title: "Server-Sent Events — the guide", host: "developer.mozilla.org", letter: "M" },
  { title: "Redis pub/sub in production", host: "redis.io", letter: "R" },
  { title: "Fastify streaming responses", host: "fastify.dev", letter: "F" },
  { title: "Expo Router — deep links", host: "docs.expo.dev", letter: "E" },
];

// Scoped keyframes. Can't touch globals.css from here, and these are local to
// this island anyway — a duplicate @keyframes block (hero + feature both on the
// page) is identical and harmless.
const KEYFRAMES = `
@keyframes lt-travel {
  0%   { transform: translateX(-10%); opacity: 0; }
  15%  { opacity: 1; }
  85%  { opacity: 1; }
  100% { transform: translateX(1000%); opacity: 0; }
}
@media (prefers-reduced-motion: no-preference) {
  .lt-wire-pulse { animation: lt-travel 2.4s ease-in-out infinite; }
}
`;

/** The pulsing "live" dot — a solid core with an expanding ping ring. */
function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-hidden>
      <span className="absolute inset-0 rounded-full bg-emerald-500/70 motion-safe:animate-ping" />
      <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
    </span>
  );
}

/** A single mirrored tab row (used on both mocks). */
function TabRow({
  tab,
  arrived,
  compact,
}: {
  tab: Tab;
  arrived: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1.5",
        "transition-all duration-500 ease-out motion-reduce:transition-none",
        arrived ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
      )}
    >
      <span
        className={cn(
          mono,
          "flex size-5 shrink-0 items-center justify-center rounded border border-border/60 bg-foreground/[0.06] text-[10px] font-semibold text-foreground/70",
        )}
        aria-hidden
      >
        {tab.letter}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium leading-tight">{tab.title}</p>
        {!compact && (
          <p className={cn(mono, "truncate text-[9px] leading-tight text-muted-foreground")}>
            {tab.host}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The big feature-card animation: laptop → wire → phone, tabs landing live.
 */
export function LiveTabsDemo() {
  // How many tabs have reached the phone. Advances on an interval, holds full
  // for a beat, then loops. Starts full so the SSR/no-JS frame is complete.
  const [arrived, setArrived] = useState(TABS.length);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setArrived(0);
    let n = 0;
    const tick = () => {
      n = n >= TABS.length ? 0 : n + 1;
      setArrived(n);
    };
    // Slightly longer hold at the top of the loop reads as "and it stays synced".
    const id = window.setInterval(tick, 1100);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div aria-hidden className="pointer-events-none mt-6 select-none">
      <style>{KEYFRAMES}</style>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3">
        {/* Laptop — the source. Always shows every open tab. */}
        <div className="rounded-xl border border-border/60 bg-card/50 p-2.5 shadow-sm">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-border" />
            <span className="size-1.5 rounded-full bg-border" />
            <span className="size-1.5 rounded-full bg-border" />
            <span className={cn(mono, "ml-1 flex items-center gap-1 text-[9px] text-muted-foreground")}>
              <Laptop className="size-3" aria-hidden />
              MacBook
            </span>
          </div>
          <div className="space-y-1.5">
            {TABS.map((t) => (
              <TabRow key={t.host} tab={t} arrived compact />
            ))}
          </div>
        </div>

        {/* The wire — a hairline with a pulse traveling laptop → phone. */}
        <div className="relative flex h-px w-8 items-center sm:w-12">
          <div className="h-px w-full bg-gradient-to-r from-border/40 via-emerald-500/50 to-emerald-500/70" />
          <span className="lt-wire-pulse absolute left-0 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-emerald-500 shadow-[0_0_6px_1px_rgb(16_185_129/0.7)]" />
        </div>

        {/* Phone — the receiver. Tabs land here one at a time, live. */}
        <div className="rounded-[1.1rem] border border-border/60 bg-card/50 p-2 shadow-sm">
          <div className="mb-2 flex items-center justify-between px-0.5">
            <span className={cn(mono, "flex items-center gap-1 text-[9px] text-muted-foreground")}>
              <Smartphone className="size-3" aria-hidden />
              iPhone
            </span>
            <span className={cn(mono, "flex items-center gap-1 text-[8px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400")}>
              <LiveDot />
              live
            </span>
          </div>
          <div className="space-y-1.5">
            {TABS.map((t, i) => (
              <TabRow key={t.host} tab={t} arrived={i < arrived} compact />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The hero's compact live-sync strip: a single glass row that says, at a glance,
 * "your laptop's tabs are on your phone, live." Self-contained; the traveling
 * pulse and live dot are the only motion.
 */
export function LiveWire() {
  return (
    <div
      aria-hidden
      className={cn(
        mono,
        "pointer-events-none mt-8 inline-flex select-none items-center gap-2.5 rounded-full border border-border/60 bg-card/40 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur-sm",
      )}
    >
      <style>{KEYFRAMES}</style>
      <span className="flex items-center gap-1.5">
        <Laptop className="size-3.5 text-foreground/70" aria-hidden />
        <span className="text-foreground/70">9 tabs</span>
      </span>
      <span className="relative flex h-px w-8 items-center">
        <span className="h-px w-full bg-gradient-to-r from-border/40 to-emerald-500/70" />
        <span className="lt-wire-pulse absolute left-0 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-emerald-500 shadow-[0_0_6px_1px_rgb(16_185_129/0.7)]" />
      </span>
      <span className="flex items-center gap-1.5">
        <Smartphone className="size-3.5 text-foreground/70" aria-hidden />
        <span className="text-foreground/70">iPhone</span>
      </span>
      <span className="flex items-center gap-1 font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
        <LiveDot />
        live
      </span>
    </div>
  );
}
