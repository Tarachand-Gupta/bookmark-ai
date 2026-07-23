// One icon per feature, shared with the app sidebar and the onboarding tour —
// the marketing grid must never drift from what the product itself shows.
import { FEATURE_ICONS } from "@/components/library/feature-icons";
import { cn } from "@/lib/utils";
import { CategoryChipsMock, SaveBookmarkMock, SearchDemo, SessionMock } from "./feature-mocks";
import { LiveTabsDemo } from "./live-tabs";
import { Reveal } from "./reveal";
import { display, glass, mono, SectionHead } from "./primitives";

/** Subtle in-copy emphasis: lifts a standout phrase out of muted body text. */
function Em({ children }: { children: React.ReactNode }) {
  return <strong className="font-medium text-foreground">{children}</strong>;
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
            <FEATURE_ICONS.live className="size-6 text-foreground" strokeWidth={1.6} aria-hidden />
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
            Every browser you sign in to publishes its open tabs — <Em>opt-in</Em> — and
            they appear on your other devices as they change, streamed <Em>live</Em>. Close
            the laptop, open your phone, and the tab you were reading is already there.
            Private to you, and <Em>gone after seven days</Em>.
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
          <FEATURE_ICONS.search className="size-6 text-foreground" strokeWidth={1.6} aria-hidden />
          <h3 className={cn(display, "mt-5 text-2xl font-semibold tracking-tight")}>
            Search by meaning
          </h3>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            Hybrid search blends full-text with <Em>semantic vectors</Em>, so a vague
            memory like &ldquo;that article on focus&rdquo; still finds the page — even
            when those exact words are nowhere on it.
          </p>
          <SearchDemo />
        </div>

        {/* Three small cards — one row on desktop (col-span-4 each in the 12-col
            grid), stacking on mobile. Each carries its own static mock. */}
        <div
          data-reveal-item
          className={cn(glass, "flex flex-col rounded-2xl p-7 md:col-span-4")}
        >
          <FEATURE_ICONS.bookmarks className="size-6 text-foreground" strokeWidth={1.6} aria-hidden />
          <h3 className={cn(display, "mt-5 text-xl font-semibold tracking-tight")}>
            Save bookmarks
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            <Em>One click</Em> from <Em>any browser</Em> saves the page you&rsquo;re on —
            the extension grabs its title, icon and link. No copy-pasting URLs.
          </p>
          <div className="mt-auto pt-6">
            <SaveBookmarkMock />
          </div>
        </div>

        <div
          data-reveal-item
          className={cn(glass, "flex flex-col rounded-2xl p-7 md:col-span-4")}
        >
          <FEATURE_ICONS.ai className="size-6 text-foreground" strokeWidth={1.6} aria-hidden />
          <h3 className={cn(display, "mt-5 text-xl font-semibold tracking-tight")}>
            AI categories &amp; tags
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Every save is filed under a clear category with tags — by <Em>the AI provider
            you choose</Em>. No folders to maintain, nothing to drag.
          </p>
          <div className="mt-auto pt-6">
            <CategoryChipsMock />
          </div>
        </div>

        <div
          data-reveal-item
          className={cn(glass, "flex flex-col rounded-2xl p-7 md:col-span-4")}
        >
          <FEATURE_ICONS.sessions className="size-6 text-foreground" strokeWidth={1.6} aria-hidden />
          <h3 className={cn(display, "mt-5 text-xl font-semibold tracking-tight")}>
            Save whole session
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Snapshot an entire window of tabs as one session, then <Em>restore the whole
            set as a tab group</Em> later. Park research and pick it back up.
          </p>
          <div className="mt-auto pt-6">
            <SessionMock />
          </div>
        </div>
      </Reveal>
    </section>
  );
}
