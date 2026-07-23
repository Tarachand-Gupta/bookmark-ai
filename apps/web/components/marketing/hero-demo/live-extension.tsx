import { Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import { BookmarkMark, mono } from "../primitives";
import { GEO, LIVE_DEVICE } from "./data";

/**
 * Act two, beat A — "turn it on in the extension".
 *
 * The same Chrome frame vocabulary as `BrowserWindow` (traffic lights, an
 * omnibox, the pinned "B" toolbar icon lit) with the popup dropped from the
 * icon — so the extension reads as the same product across both acts. But where
 * act one's popup saves the page, this one shows the real live-session control:
 * the "Share window as live session" card with a switch the cursor flips ON.
 *
 * It sits in the exact `GEO.browser` footprint the act-one browser used, so the
 * camera's beat-1 `shot` pose reframes it with zero new survey — act two opens
 * by returning to the very spot act one began, and finding a different card
 * waiting there.
 *
 * Default DOM is invisible (`opacity-0`) and switch-off, same convention as
 * `BrowserWindow`: reduced-motion and no-JS visitors only ever see the finished
 * dashboard; GSAP is what turns this into a screen the camera can visit. Below
 * the `@md` floor there's no room for a legible toolbar+popup, so — like the
 * browser — it's simply absent from the compact storyboard.
 */
export function LiveExtension() {
  return (
    <div
      data-demo="live-ext"
      style={{
        left: `${GEO.browser.left}%`,
        top: `${GEO.browser.top}%`,
        width: `${GEO.browser.width}%`,
        height: `${GEO.browser.height}%`,
      }}
      className={cn(
        "absolute z-10 hidden flex-col overflow-hidden rounded-[0.9em] text-[0.45em] opacity-0 @md:flex",
        "border border-border/70 bg-card/80 backdrop-blur-md",
        "shadow-[0_16px_40px_-10px_rgb(0_0_0/0.3)]",
        "dark:border-white/[0.12] dark:bg-[#1a1a1a]/85 dark:shadow-[0_26px_70px_-14px_rgb(0_0_0/0.9)]",
      )}
    >
      {/* Toolbar — traffic lights · omnibox · pinned, lit extension icon. */}
      <div className="flex h-[21%] shrink-0 items-center gap-[0.7em] border-b border-border/60 bg-foreground/[0.03] px-[0.7em] dark:border-white/[0.08] dark:bg-white/[0.03]">
        <div className="flex shrink-0 items-center gap-[0.32em]">
          <Light />
          <Light />
          <Light />
        </div>

        <div className="flex h-[2.2em] min-w-0 flex-1 items-center gap-[0.4em] rounded-full border border-border/60 bg-background/70 px-[0.7em] dark:border-white/[0.08] dark:bg-black/40">
          <LockGlyph />
          <span className={cn(mono, "truncate text-[0.8em] text-muted-foreground")}>
            docs.expo.dev/router/introduction
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-[0.5em]">
          <GhostIcon />
          <GhostIcon />
          {/* The pinned "B" — lit, because its popup is open. */}
          <div className="relative flex size-[1.6em] items-center justify-center">
            <span className="absolute inset-[-0.18em] rounded-[0.35em] bg-foreground/10 dark:bg-white/15" />
            <BookmarkMark className="relative size-[1.05em] text-foreground/85" />
          </div>
        </div>
      </div>

      {/* Page behind, with the popup dropped from the toolbar icon. */}
      <div className="relative min-h-0 flex-1 px-[1.4em] py-[1em]">
        <div className="space-y-[0.45em] opacity-70">
          <Line className="w-[45%]" />
          <Line className="w-full" />
          <Line className="w-[92%]" />
          <Line className="w-[96%]" />
          <Line className="w-[70%]" />
        </div>

        {/* The popup — origin top-right, scaling out of the icon above it. */}
        <div className="absolute right-[3.5%] top-[4%] z-20 w-[64%] origin-top-right rounded-[0.6em] border border-border/80 bg-card/95 p-[0.8em] text-[1.15em] text-card-foreground backdrop-blur-md shadow-[0_10px_30px_-6px_rgb(0_0_0/0.35)] dark:border-white/[0.14] dark:bg-[#161616]/95 dark:shadow-[0_16px_40px_-8px_rgb(0_0_0/0.9)]">
          {/* Little caret joining popup to the toolbar icon. */}
          <span
            aria-hidden
            className="absolute -top-[0.3em] right-[0.7em] size-[0.55em] rotate-45 rounded-[0.05em] border-l border-t border-border/80 bg-card/95 dark:border-white/[0.14] dark:bg-[#161616]/95"
          />

          {/* Header — brand mark + wordmark. */}
          <div className="flex items-center gap-[0.4em]">
            <span className="flex size-[1em] items-center justify-center rounded-[0.2em] bg-primary text-[0.58em] font-bold leading-none text-primary-foreground">
              B
            </span>
            <span className="text-[0.7em] font-semibold tracking-tight">Bookmark AI</span>
          </div>

          {/* The live-session card — the real control (§4.9). */}
          <div className="mt-[0.6em] rounded-[0.6em] border border-border/70 bg-background/60 p-[0.6em] dark:bg-white/[0.03]">
            <div className="flex items-center gap-[0.55em]">
              <LiveSwitch />
              <span className="min-w-0 flex-1 text-[0.62em] font-medium leading-tight">
                Share window as live session
              </span>
            </div>

            {/* Device line — dim until the switch flips, then it names the
                device that's now sharing. Same string beat C's view shows. */}
            <div
              data-demo="live-device-line"
              className="mt-[0.6em] flex items-center gap-[0.35em] opacity-[0.35]"
            >
              <Monitor className="size-[0.7em] shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              <span className={cn(mono, "truncate text-[0.55em] font-medium text-foreground/80")}>
                {LIVE_DEVICE}
              </span>
              <span className={cn(mono, "ml-auto shrink-0 text-[0.5em] text-emerald-600 dark:text-emerald-400")}>
                sharing
              </span>
            </div>
          </div>

          <p className={cn(mono, "mt-[0.55em] text-[0.5em] leading-snug text-muted-foreground")}>
            Sends every open tab so you can pick one up on your phone.
          </p>

          <div className="mt-[0.55em] flex items-center justify-between border-t border-border/60 pt-[0.5em]">
            <span className={cn(mono, "text-[0.55em] text-muted-foreground")}>bookmark-ai.cloud</span>
            <span className={cn(mono, "text-[0.55em] text-muted-foreground")}>Open live tabs ↗</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The pill switch, mirroring the extension's real one. Off by default; the
 * timeline fades the emerald fill in and slides the knob across on the flip.
 * `data-demo="live-switch"` is the cursor's target — measured for its centre.
 */
function LiveSwitch() {
  return (
    <span
      data-demo="live-switch"
      className="relative inline-flex h-[1.15em] w-[2.1em] shrink-0 items-center rounded-full bg-foreground/25 dark:bg-white/25"
    >
      <span
        data-demo="live-switch-on"
        className="absolute inset-0 rounded-full bg-emerald-500 opacity-0"
      />
      <span
        data-demo="live-switch-knob"
        className="relative z-10 ml-[0.13em] size-[0.9em] rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.35)]"
      />
    </span>
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
      <path d="M3.4 5.2V3.8a2.6 2.6 0 0 1 5.2 0v1.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <rect x="2.4" y="5.2" width="7.2" height="5" rx="1.2" fill="currentColor" />
    </svg>
  );
}

function Line({ className }: { className?: string }) {
  return <div className={cn("h-[0.35em] rounded-full bg-foreground/10 dark:bg-white/10", className)} />;
}
