import { FolderTree, Layers, MonitorSmartphone, ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { LiveTabsDemo } from "./live-tabs";
import { Reveal } from "./reveal";
import { display, glass, mono, SectionHead } from "./primitives";

/** A small, honest recreation of semantic search — query vs. matched result. */
function SearchDemo() {
  return (
    <div className="mt-6 space-y-2.5">
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/50 px-3 py-2.5">
        <ScanSearch className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className={cn(mono, "truncate text-sm text-foreground")}>
          focus without burning out
        </span>
      </div>
      <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/50 p-3">
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
          className={cn(
            mono,
            "shrink-0 rounded-full border border-border/60 bg-background/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground",
          )}
        >
          top match
        </span>
      </div>
      <p className={cn(mono, "px-1 text-[11px] text-muted-foreground/80")}>
        &mdash; matched on meaning; those words never appear on the page.
      </p>
    </div>
  );
}

export function Features() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
      <Reveal>
        <SectionHead
          eyebrow="what it does"
          title="Live where you left off. Find what you saved."
        />
      </Reveal>

      <Reveal
        selector="[data-reveal-item]"
        className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-12"
      >
        {/* Big card 1 — LIVE TABS, the headline differentiator and the most alive
            surface in the grid. */}
        <div
          data-reveal-item
          className={cn(
            glass,
            "flex flex-col rounded-2xl p-7 md:col-span-6",
            // A faint emerald wash sets the live card apart from the rest.
            "bg-gradient-to-b from-emerald-500/[0.04] to-transparent",
          )}
        >
          <div className="flex items-center gap-2">
            <MonitorSmartphone className="size-6 text-foreground" strokeWidth={1.6} aria-hidden />
            <span
              className={cn(
                mono,
                "flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400",
              )}
            >
              <span className="relative flex size-1.5">
                <span className="absolute inset-0 rounded-full bg-emerald-500/70 motion-safe:animate-ping" />
                <span className="relative size-1.5 rounded-full bg-emerald-500" />
              </span>
              real-time
            </span>
          </div>
          <h3 className={cn(display, "mt-5 text-2xl font-semibold tracking-tight")}>
            Live tabs, on every device
          </h3>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            Every browser you sign in to publishes its open tabs — opt-in — and they
            appear on your other devices as they change, streamed live. Close the
            laptop, open your phone, and the tab you were reading is already there.
            Private to you, and gone after seven days.
          </p>
          <div className="mt-auto">
            <LiveTabsDemo />
          </div>
        </div>

        {/* Big card 2 — search by meaning, the AI-bookmarks story. */}
        <div
          data-reveal-item
          className={cn(glass, "flex flex-col rounded-2xl p-7 md:col-span-6")}
        >
          <ScanSearch className="size-6 text-foreground" strokeWidth={1.6} aria-hidden />
          <h3 className={cn(display, "mt-5 text-2xl font-semibold tracking-tight")}>
            Search by meaning
          </h3>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            Hybrid search blends full-text with semantic vectors, so a vague memory
            like &ldquo;that article on focus&rdquo; still finds the page — even when
            those exact words are nowhere on it.
          </p>
          <SearchDemo />
        </div>

        {/* Small cards. */}
        <div
          data-reveal-item
          className={cn(glass, "flex flex-col gap-4 rounded-2xl p-7 md:col-span-6")}
        >
          <FolderTree className="size-6 text-foreground" strokeWidth={1.6} aria-hidden />
          <h3 className={cn(display, "text-xl font-semibold tracking-tight")}>
            AI categories &amp; tags
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Every save is read by Gemini and filed under a clear category with tags.
            No folders to maintain, nothing to drag.
          </p>
        </div>

        <div
          data-reveal-item
          className={cn(glass, "flex flex-col gap-4 rounded-2xl p-7 md:col-span-6")}
        >
          <Layers className="size-6 text-foreground" strokeWidth={1.6} aria-hidden />
          <h3 className={cn(display, "text-xl font-semibold tracking-tight")}>
            Sessions
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Save every open tab as one session, then restore the whole set as a tab
            group later. Park research and pick it back up.
          </p>
        </div>
      </Reveal>
    </section>
  );
}
