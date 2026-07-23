"use client";

import { useEffect, useState } from "react";
import { Globe, Search } from "lucide-react";
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

/** Shared framing so every demo sits in the same padded, muted stage. */
function DemoFrame({ children }: { children: React.ReactNode }) {
  return (
    <div aria-hidden className="pointer-events-none select-none rounded-xl border bg-muted/30 p-4">
      {children}
    </div>
  );
}

/**
 * Styled "how it works" numbered list for the tour steps — muted, tightly-set
 * numbers in the app's own tokens (not raw markdown-y "1. text"). Each item is a
 * short instruction; keep them terse so panes stay compact.
 */
export function TourSteps({ steps }: { steps: React.ReactNode[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-2.5 text-sm leading-snug">
          <span
            aria-hidden
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium tabular-nums text-muted-foreground"
          >
            {i + 1}
          </span>
          <span className="min-w-0 text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">
            {step}
          </span>
        </li>
      ))}
    </ol>
  );
}
