"use client";

import { useEffect, useState } from "react";
import { Folder, Globe, Layers, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Small, self-contained loop animations for the onboarding tour, built from the
 * app's own tokens/type (deliberately NOT the marketing island's mono font). Each
 * gates its motion behind prefers-reduced-motion by starting in the finished
 * state and only animating when motion is allowed.
 */

/** Advances 0..steps on an interval, holding full for a beat then looping. Static
 * (returns `steps`) when the user prefers reduced motion. */
function useLoop(steps: number, intervalMs = 1000): number {
  const [n, setN] = useState(steps);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setN(0);
    let cur = 0;
    const id = window.setInterval(() => {
      cur = cur >= steps ? 0 : cur + 1;
      setN(cur);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [steps, intervalMs]);
  return n;
}

/** Bookmarks: a saved page gets a category + tags added by AI, one chip at a time. */
export function BookmarksDemo() {
  const chips = ["Design", "#typography", "#css"] as const;
  const shown = useLoop(chips.length, 900);
  return (
    <DemoFrame>
      <div className="rounded-lg border bg-background p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">Practical Typography</p>
            <p className="truncate text-[10px] text-muted-foreground">practicaltypography.com</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Sparkles className="size-3" aria-hidden />
            Organized for you
          </span>
        </div>
        <div className="mt-1.5 flex min-h-6 flex-wrap items-center gap-1.5">
          {chips.map((c, i) => {
            const isCategory = i === 0;
            return (
              <span
                key={c}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all duration-500 ease-out motion-reduce:transition-none",
                  isCategory
                    ? "bg-primary text-primary-foreground"
                    : "border text-muted-foreground",
                  i < shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
                )}
              >
                {isCategory && <Folder className="size-2.5" aria-hidden />}
                {c}
              </span>
            );
          })}
        </div>
      </div>
    </DemoFrame>
  );
}

/** Search by meaning: a query with no shared words still surfaces the right page. */
export function MeaningSearchDemo() {
  // 0: nothing, 1: exact-ish highlighted, 2: related-by-meaning highlighted.
  const step = useLoop(2, 1100);
  return (
    <DemoFrame>
      <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 shadow-sm">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-xs">how to make text readable</span>
      </div>
      <div className="mt-2 space-y-1.5">
        <ResultRow
          title="Practical Typography"
          host="practicaltypography.com"
          active={step >= 1}
        />
        <ResultRow
          title="Better line length &amp; spacing"
          host="css-tricks.com"
          note="by meaning"
          active={step >= 2}
        />
      </div>
    </DemoFrame>
  );
}

function ResultRow({
  title,
  host,
  note,
  active,
}: {
  title: string;
  host: string;
  note?: string;
  active: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors duration-500 motion-reduce:transition-none",
        active ? "border-primary/40 bg-primary/[0.05]" : "border-transparent bg-background",
      )}
    >
      <Globe className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium">{title}</p>
        <p className="truncate text-[9px] text-muted-foreground">{host}</p>
      </div>
      {note && active && (
        <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] text-muted-foreground">
          {note}
        </span>
      )}
    </div>
  );
}

/** Saved sessions: a window of tabs folds into one restorable snapshot card. */
export function SavedSessionsDemo() {
  const tabs = ["Docs — API reference", "GitHub — pull request", "Figma — board", "Linear — sprint"];
  // 0..1..2: open window → collapsing → saved card.
  const step = useLoop(2, 1200);
  const collapsed = step >= 1;
  return (
    <DemoFrame>
      <div
        className={cn(
          "rounded-lg border bg-background shadow-sm transition-all duration-500 motion-reduce:transition-none",
        )}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-xs font-medium">Research · {tabs.length} tabs</p>
          {step >= 2 && (
            <span className="ml-auto text-[9px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-500">
              Saved
            </span>
          )}
        </div>
        <div
          className={cn(
            "overflow-hidden transition-all duration-500 ease-out motion-reduce:transition-none",
            collapsed ? "max-h-0 opacity-0" : "max-h-40 opacity-100",
          )}
        >
          <ul className="divide-y">
            {tabs.map((t) => (
              <li key={t} className="flex items-center gap-2 px-3 py-1.5">
                <Globe className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate text-[10px] text-muted-foreground">{t}</span>
              </li>
            ))}
          </ul>
        </div>
        {collapsed && (
          <p className="px-3 py-2 text-[10px] text-muted-foreground">
            Restore the whole window, or one tab at a time — even after it&apos;s closed.
          </p>
        )}
      </div>
    </DemoFrame>
  );
}

/** Shared framing so every demo sits in the same padded, muted stage. */
function DemoFrame({ children }: { children: React.ReactNode }) {
  return (
    <div aria-hidden className="pointer-events-none select-none rounded-xl border bg-muted/30 p-4">
      {children}
    </div>
  );
}
