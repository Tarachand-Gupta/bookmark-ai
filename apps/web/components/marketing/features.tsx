import {
  BookmarkPlus,
  ChevronDown,
  FolderTree,
  Layers,
  MonitorSmartphone,
  ScanSearch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LiveTabsDemo } from "./live-tabs";
import { Reveal } from "./reveal";
import { BookmarkMark, display, glass, mono, SectionHead } from "./primitives";

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

/** A one-glance extension popup: the active page, and the button that saves it. */
function SaveBookmarkMock() {
  return (
    <div aria-hidden className="rounded-xl border border-border/60 bg-card/50 p-3 shadow-sm">
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
        <div className="mt-2.5 flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-[11px] font-medium text-primary-foreground shadow-sm">
          <BookmarkMark className="size-3" />
          Save bookmark
        </div>
      </div>
    </div>
  );
}

/** Categories fill, then tags — the shape of what lands on every save. */
function CategoryChipsMock() {
  const categories = ["Research", "Design", "Development"];
  const tags = ["#focus", "#ml", "#productivity", "#tools"];
  return (
    <div aria-hidden className="rounded-xl border border-border/60 bg-card/50 p-3 shadow-sm">
      <p className={cn(mono, "text-[9px] uppercase tracking-wider text-muted-foreground/70")}>
        category
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <span
            key={c}
            className={cn(
              mono,
              "rounded-md bg-primary/90 px-2 py-0.5 text-[10px] font-medium text-primary-foreground",
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
        {tags.map((t) => (
          <span
            key={t}
            className={cn(
              mono,
              "rounded-full border border-border/60 bg-background/50 px-2 py-0.5 text-[10px] text-muted-foreground",
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
function SessionMock() {
  const tabs = [
    { letter: "M", title: "Server-Sent Events — the guide" },
    { letter: "R", title: "Redis pub/sub in production" },
    { letter: "F", title: "Fastify streaming responses" },
  ];
  return (
    <div aria-hidden className="rounded-xl border border-border/60 bg-card/50 p-3 shadow-sm">
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
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-foreground/[0.04] px-2.5 py-2">
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

        {/* Three small cards — one row on desktop (col-span-4 each in the 12-col
            grid), stacking on mobile. Each carries its own static mock. */}
        <div
          data-reveal-item
          className={cn(glass, "flex flex-col rounded-2xl p-7 md:col-span-4")}
        >
          <BookmarkPlus className="size-6 text-foreground" strokeWidth={1.6} aria-hidden />
          <h3 className={cn(display, "mt-5 text-xl font-semibold tracking-tight")}>
            Save bookmarks
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            One click from any browser saves the page you&rsquo;re on — the extension
            grabs its title, icon and link. No copy-pasting URLs.
          </p>
          <div className="mt-auto pt-6">
            <SaveBookmarkMock />
          </div>
        </div>

        <div
          data-reveal-item
          className={cn(glass, "flex flex-col rounded-2xl p-7 md:col-span-4")}
        >
          <FolderTree className="size-6 text-foreground" strokeWidth={1.6} aria-hidden />
          <h3 className={cn(display, "mt-5 text-xl font-semibold tracking-tight")}>
            AI categories &amp; tags
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Every save is filed under a clear category with tags — by the AI provider
            you choose. No folders to maintain, nothing to drag.
          </p>
          <div className="mt-auto pt-6">
            <CategoryChipsMock />
          </div>
        </div>

        <div
          data-reveal-item
          className={cn(glass, "flex flex-col rounded-2xl p-7 md:col-span-4")}
        >
          <Layers className="size-6 text-foreground" strokeWidth={1.6} aria-hidden />
          <h3 className={cn(display, "mt-5 text-xl font-semibold tracking-tight")}>
            Save whole session
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Snapshot an entire window of tabs as one session, then restore the whole
            set as a tab group later. Park research and pick it back up.
          </p>
          <div className="mt-auto pt-6">
            <SessionMock />
          </div>
        </div>
      </Reveal>
    </section>
  );
}
