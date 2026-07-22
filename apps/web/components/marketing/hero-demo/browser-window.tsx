import { cn } from "@/lib/utils";
import { BookmarkMark, mono } from "../primitives";
import { GEO, SAVED_PAGE } from "./data";
import { PopupMock } from "./popup-mock";

/**
 * The floating browser window: traffic lights, an omnibox on a real article
 * URL, and the extension row the cursor is heading for.
 *
 * Its `font-size` is ~0.45em of the stage, which is roughly the inverse of beat
 * 1's camera push (~2.35x). Net effect: `0.7em` in here and `0.7em` in the
 * dashboard land at about the same apparent size on screen, so both mocks can
 * be authored in one type scale even though the camera treats them differently.
 * The popup then re-bases off this — see PopupMock.
 */
export function BrowserWindow() {
  return (
    <div
      data-demo="browser"
      style={{
        left: `${GEO.browser.left}%`,
        top: `${GEO.browser.top}%`,
        width: `${GEO.browser.width}%`,
        height: `${GEO.browser.height}%`,
      }}
      className={cn(
        // Below a ~448px column there aren't enough pixels to hold a legible
        // toolbar AND a legible popup at any zoom: the type scale hits its
        // floor while the geometry keeps shrinking, so the popup ends up ~10em
        // wide holding 16em of content. Rather than ship a crushed mock, the
        // narrow layout drops beats 1-3 entirely — see ./timeline.
        "absolute z-10 hidden flex-col overflow-hidden rounded-[0.9em] text-[0.45em] opacity-0 @md:flex",
        "border border-border/70 bg-card/80 backdrop-blur-md",
        "shadow-[0_16px_40px_-10px_rgb(0_0_0/0.3)]",
        "dark:border-white/[0.12] dark:bg-[#1a1a1a]/85 dark:shadow-[0_26px_70px_-14px_rgb(0_0_0/0.9)]",
      )}
    >
      {/* Toolbar — the whole subject of beat 1. */}
      <div className="flex h-[21%] shrink-0 items-center gap-[0.7em] border-b border-border/60 bg-foreground/[0.03] px-[0.7em] dark:border-white/[0.08] dark:bg-white/[0.03]">
        <div className="flex shrink-0 items-center gap-[0.32em]">
          <Light />
          <Light />
          <Light />
        </div>

        {/* Omnibox. */}
        <div className="flex h-[2.2em] min-w-0 flex-1 items-center gap-[0.4em] rounded-full border border-border/60 bg-background/70 px-[0.7em] dark:border-white/[0.08] dark:bg-black/40">
          <LockGlyph />
          <span className={cn(mono, "truncate text-[0.8em] text-muted-foreground")}>
            {SAVED_PAGE.url}
          </span>
        </div>

        {/* Extension row. The ribbon is the one that matters. */}
        <div className="flex shrink-0 items-center gap-[0.5em]">
          <GhostIcon />
          <GhostIcon />
          <div data-demo="ext-icon" className="relative flex size-[1.6em] items-center justify-center">
            {/* Active-state plate — the browser's "this popup is open" affordance. */}
            <span
              data-demo="ext-glow"
              className="absolute inset-[-0.18em] rounded-[0.35em] bg-foreground/10 opacity-0 dark:bg-white/15"
            />
            {/* Click ripple. */}
            <span
              data-demo="ripple"
              className="absolute inset-[-0.1em] rounded-full border border-foreground/50 opacity-0 dark:border-white/70"
            />
            <BookmarkMark className="relative size-[1.05em] text-foreground/85" />
          </div>
        </div>
      </div>

      {/* Page — a hint of the paper, so beat 1 already says what we're saving. */}
      <div className="min-h-0 flex-1 px-[1.4em] py-[1em]">
        <p className="truncate text-[0.85em] font-semibold tracking-tight text-foreground/80">
          {SAVED_PAGE.title}
        </p>
        <p className={cn(mono, "mt-[0.35em] text-[0.6em] text-muted-foreground")}>
          Vaswani et al. · Submitted 12 Jun 2017
        </p>
        {/* Enough of an abstract to fill the window. Beat 1 holds on this for
            over a second — a browser that's 60% empty grey reads as a wireframe,
            not as somebody's actual screen. */}
        <div className="mt-[0.9em] space-y-[0.45em]">
          <Line className="w-full" />
          <Line className="w-[94%]" />
          <Line className="w-[97%]" />
          <Line className="w-[62%]" />
        </div>
        <div className="mt-[0.9em] space-y-[0.45em]">
          <Line className="w-[98%]" />
          <Line className="w-[91%]" />
          <Line className="w-[96%]" />
          <Line className="w-[88%]" />
          <Line className="w-[45%]" />
        </div>
        <div className="mt-[0.9em] space-y-[0.45em]">
          <Line className="w-[93%]" />
          <Line className="w-[97%]" />
          <Line className="w-[71%]" />
        </div>
      </div>

      <PopupMock />
    </div>
  );
}

function Light() {
  return <span className="size-[0.5em] rounded-full bg-foreground/25 dark:bg-white/25" />;
}

function GhostIcon() {
  return <span className="size-[1.2em] rounded-[0.3em] bg-foreground/12 dark:bg-white/12" />;
}

function LockGlyph() {
  return (
    <svg viewBox="0 0 12 12" className="size-[0.7em] shrink-0 text-muted-foreground" aria-hidden>
      <path
        d="M3.4 5.2V3.8a2.6 2.6 0 0 1 5.2 0v1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <rect x="2.4" y="5.2" width="7.2" height="5" rx="1.2" fill="currentColor" />
    </svg>
  );
}

function Line({ className }: { className?: string }) {
  return <div className={cn("h-[0.35em] rounded-full bg-foreground/10 dark:bg-white/10", className)} />;
}
