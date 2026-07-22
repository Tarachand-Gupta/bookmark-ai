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

/**
 * A neutral, single-color mark that reads as a browser without being anyone's
 * trademark: a ring with a small hub and three spokes. Deliberately NOT the
 * Chrome asset — just enough silhouette to say "this is the browser window."
 */
function ChromeGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.1" fill="currentColor" stroke="none" />
      <path d="M12 3 L12 8.9" />
      <path d="M19.8 16.5 L14.7 13.6" />
      <path d="M4.2 16.5 L9.3 13.6" />
    </svg>
  );
}

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
    <div aria-hidden className="pointer-events-none mt-6 select-none overflow-hidden">
      <style>{KEYFRAMES}</style>
      {/* minmax(0,…) on both panels lets them shrink instead of forcing the
          iPhone past the card's rounded edge; the laptop gets the wider share so
          its tab strip has room. */}
      <div className="grid grid-cols-[minmax(0,1.45fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
        {/* Laptop — the source, staged as a real browser window: a title line,
            a Chrome-style tab strip, and the active tab's omnibox. */}
        <div className="min-w-0 rounded-xl border border-border/60 bg-card/50 p-2 shadow-sm">
          <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
            <span className="size-1.5 rounded-full bg-border" />
            <span className="size-1.5 rounded-full bg-border" />
            <span className="size-1.5 rounded-full bg-border" />
            <span className={cn(mono, "ml-1 flex items-center gap-1 text-[9px] text-muted-foreground")}>
              MacBook
              <span aria-hidden className="text-border">
                ·
              </span>
              <ChromeGlyph className="size-3 text-foreground/70" />
            </span>
          </div>

          {/* Chrome-style tab strip — the active tab carries its title, the rest
              collapse to favicons the way Chrome does once tabs get tight. */}
          <div className="flex items-end gap-0.5">
            {TABS.map((t, i) => (
              <div
                key={t.host}
                className={cn(
                  "flex items-center gap-1 rounded-t-md border border-b-0 px-1.5 py-1",
                  i === 0
                    ? "min-w-0 flex-1 border-border/60 bg-background/70"
                    : "shrink-0 border-transparent bg-foreground/[0.04]",
                )}
              >
                <span
                  className={cn(
                    mono,
                    "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-border/50 bg-foreground/[0.06] text-[8px] font-semibold text-foreground/70",
                  )}
                >
                  {t.letter}
                </span>
                {i === 0 && (
                  <span className="truncate text-[9px] font-medium leading-none">{t.title}</span>
                )}
              </div>
            ))}
          </div>

          {/* The active tab's viewport: an omnibox reading its URL. */}
          <div className="rounded-md rounded-tl-none border border-border/50 bg-background/40 p-1.5">
            <div className="flex items-center gap-1 rounded-full border border-border/50 bg-background/60 px-1.5 py-0.5">
              <span className="size-1.5 shrink-0 rounded-full bg-emerald-500/60" />
              <span className={cn(mono, "truncate text-[8px] text-muted-foreground")}>
                {TABS[0].host}
              </span>
            </div>
          </div>
        </div>

        {/* The wire — a hairline with a pulse traveling laptop → phone. */}
        <div className="relative flex h-px w-8 items-center sm:w-12">
          <div className="h-px w-full bg-gradient-to-r from-border/40 via-emerald-500/50 to-emerald-500/70" />
          <span className="lt-wire-pulse absolute left-0 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-emerald-500 shadow-[0_0_6px_1px_rgb(16_185_129/0.7)]" />
        </div>

        {/* Phone — the receiver. Tabs land here one at a time, live. */}
        <div className="min-w-0 rounded-[1.1rem] border border-border/60 bg-card/50 p-2 shadow-sm">
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
