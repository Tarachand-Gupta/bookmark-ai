import { cn } from "@/lib/utils";
import { mono } from "../primitives";
import { GEO, LIVE_TABS } from "./data";

/**
 * Act two's stage: the same box beat 1 pushed into to open the extension
 * (`GEO.browser`), now telling a different story — a laptop's open tabs,
 * mirrored live onto a phone. Reusing that geometry means the camera's
 * existing beat-1 `shot` pose reframes it with zero new survey math: the film
 * returns to the exact spot it started, and finds a different scene waiting.
 *
 * The wire pulse and the LIVE dot are small looping CSS keyframes — the same
 * idiom `live-tabs.tsx` uses for its feature-card twin — because they're
 * ambient texture, not something the timeline needs to hold or reset. Which
 * tab has *landed* on the phone is the one beat GSAP actually drives
 * (`data-demo="live-tab"`), staggered and reset like every other reveal here.
 *
 * Default DOM is invisible (`opacity-0`), same convention as `BrowserWindow`:
 * reduced-motion and no-JS visitors never see either scene, only the finished
 * dashboard — GSAP is what makes this the "screen" the camera can visit.
 */
export function LiveScene() {
  return (
    <div
      data-demo="live-scene"
      style={{
        left: `${GEO.browser.left}%`,
        top: `${GEO.browser.top}%`,
        width: `${GEO.browser.width}%`,
        height: `${GEO.browser.height}%`,
      }}
      className={cn(
        // Same visibility floor as BrowserWindow: below ~448px there's no room
        // to hold a legible laptop-strip *and* phone-strip side by side, so
        // act two is cut in the compact storyboard the same way beats 1-3 are.
        "absolute z-10 hidden flex-col overflow-hidden rounded-[0.9em] p-[0.9em] text-[0.45em] opacity-0 @md:flex",
        "border border-border/70 bg-card/80 backdrop-blur-md",
        "shadow-[0_16px_40px_-10px_rgb(0_0_0/0.3)]",
        "dark:border-white/[0.12] dark:bg-[#1a1a1a]/85 dark:shadow-[0_26px_70px_-14px_rgb(0_0_0/0.9)]",
      )}
    >
      <style>{`
        @keyframes hd-live-travel {
          0%   { transform: translateX(-10%); opacity: 0; }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translateX(900%); opacity: 0; }
        }
        @media (prefers-reduced-motion: no-preference) {
          .hd-live-wire { animation: hd-live-travel 2s ease-in-out infinite; }
        }
      `}</style>

      {/* Header — the same "real-time" affordance as the feature card. */}
      <div className="flex shrink-0 items-center justify-between">
        <span className={cn(mono, "text-[1.05em] font-semibold tracking-tight text-foreground/85")}>
          Live tabs
        </span>
        <span
          className={cn(
            mono,
            "flex items-center gap-[0.35em] rounded-full border border-emerald-500/30 bg-emerald-500/10 px-[0.6em] py-[0.15em] text-[0.85em] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400",
          )}
        >
          <span className="relative flex size-[0.6em]" aria-hidden>
            <span className="absolute inset-0 rounded-full bg-emerald-500/70 motion-safe:animate-ping" />
            <span className="relative size-[0.6em] rounded-full bg-emerald-500" />
          </span>
          live
        </span>
      </div>

      <div className="mt-[0.9em] grid min-h-0 flex-1 grid-cols-[1.3fr_auto_1fr] items-center gap-[0.6em]">
        {/* Laptop — the source. Its tabs are already open; nothing here needs
            to animate, the same way beat 1's toolbar just sits there lit. */}
        <div className="min-w-0 rounded-[0.6em] border border-border/60 bg-background/50 p-[0.5em] dark:bg-white/[0.03]">
          <div className="flex items-center gap-[0.3em] px-[0.1em]">
            <span className="size-[0.4em] rounded-full bg-foreground/25 dark:bg-white/25" />
            <span className="size-[0.4em] rounded-full bg-foreground/25 dark:bg-white/25" />
            <span className="size-[0.4em] rounded-full bg-foreground/25 dark:bg-white/25" />
          </div>
          <div className="mt-[0.55em] space-y-[0.4em]">
            {LIVE_TABS.map((t) => (
              <div key={t.host} className="flex min-w-0 items-center gap-[0.4em]">
                <span
                  className={cn(
                    mono,
                    "flex size-[1.1em] shrink-0 items-center justify-center rounded-[0.25em] border border-border/50 bg-foreground/[0.06] text-[0.55em] font-semibold text-foreground/70",
                  )}
                >
                  {t.mark}
                </span>
                <span className="truncate text-[0.62em] font-medium leading-tight">{t.title}</span>
              </div>
            ))}
          </div>
        </div>

        {/* The wire — a hairline with a pulse traveling laptop → phone. */}
        <div className="relative flex h-px w-[1.6em] items-center">
          <div className="h-px w-full bg-gradient-to-r from-border/40 via-emerald-500/50 to-emerald-500/70" />
          <span className="hd-live-wire absolute left-0 top-1/2 size-[0.3em] -translate-y-1/2 rounded-full bg-emerald-500 shadow-[0_0_6px_1px_rgb(16_185_129/0.7)]" />
        </div>

        {/* Phone — the receiver. Tabs land here one at a time, GSAP-driven. */}
        <div className="min-w-0 rounded-[0.9em] border border-border/60 bg-background/50 p-[0.5em] dark:bg-white/[0.03]">
          <div className="space-y-[0.4em]">
            {LIVE_TABS.map((t) => (
              <div
                key={t.host}
                data-demo="live-tab"
                className="flex min-w-0 items-center gap-[0.35em] rounded-[0.3em] border border-border/50 bg-card/60 px-[0.4em] py-[0.32em] opacity-0"
              >
                <span
                  className={cn(
                    mono,
                    "flex size-[1.1em] shrink-0 items-center justify-center rounded-[0.25em] border border-border/50 bg-foreground/[0.06] text-[0.55em] font-semibold text-foreground/70",
                  )}
                >
                  {t.mark}
                </span>
                <span className="truncate text-[0.62em] font-medium leading-tight">{t.title}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
