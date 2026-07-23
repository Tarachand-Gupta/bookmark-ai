import { Chrome, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import { mono } from "../primitives";
import { LIVE_DEVICE, LIVE_TABS } from "./data";

/**
 * Act two, beat C — "see the tabs live".
 *
 * The dashboard's Live sessions view, mirroring `components/library/
 * ongoing-view.tsx`: a device section (an emerald pulse + the device name + a
 * LIVE pill + "as of just now") over a window card whose open tabs stream in
 * one by one. A slim iPhone on the side receives the same tabs a beat later,
 * landing the "on every device" point — shown only where the column is wide
 * enough (`@lg`) to hold it without crowding the list.
 *
 * Rendered as an overlay inside the dashboard's content area (over the card
 * grid, which the timeline fades out beneath it), so the sidebar and header
 * stay put — exactly what clicking "Live sessions" does in the real app.
 *
 * Default DOM is invisible (`opacity-0`) with the tab rows un-arrived; the
 * timeline reveals it and streams them. So a no-JS / reduced-motion visitor
 * only ever sees the finished act-one dashboard, never a half-built live view.
 */
export function LiveView() {
  return (
    <div
      data-demo="live-view"
      className="absolute inset-0 flex flex-col px-[1em] pt-[0.85em] opacity-0"
    >
      {/* Section title — the app swaps its header to "Live sessions" here. */}
      <div className="flex items-center gap-[0.4em]">
        <span className="text-[0.65em] font-semibold tracking-tight">Live sessions</span>
        <span className={cn(mono, "text-[0.5em] text-muted-foreground")}>1 device open</span>
      </div>

      <div className="mt-[0.7em] flex min-h-0 flex-1 gap-[0.7em]">
        {/* The device — Chrome on Mac, reporting live. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-[0.4em] px-[0.1em]">
            <LivePip />
            <Monitor className="size-[0.7em] shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 truncate text-[0.6em] font-medium">{LIVE_DEVICE}</span>
            <span
              className={cn(
                mono,
                "rounded-full border border-emerald-500/30 bg-emerald-500/10 px-[0.4em] py-[0.06em] text-[0.42em] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400",
              )}
            >
              live
            </span>
            <span className={cn(mono, "ml-auto shrink-0 text-[0.48em] text-muted-foreground")}>
              as of just now
            </span>
          </div>

          {/* Window card, holding the streaming tab list. */}
          <div className="mt-[0.5em] min-h-0 rounded-[0.5em] border border-border/70 bg-card/60 p-[0.5em] dark:border-white/[0.09] dark:bg-white/[0.045]">
            <div className="flex items-center gap-[0.35em] px-[0.1em]">
              <Chrome className="size-[0.62em] shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-[0.55em] font-medium">Window 1</span>
              <span className={cn(mono, "text-[0.5em] text-muted-foreground")}>
                · {LIVE_TABS.length} tabs
              </span>
            </div>
            <div className="mt-[0.45em] space-y-[0.35em]">
              {LIVE_TABS.map((t) => (
                <div
                  key={t.host}
                  data-demo="live-tab"
                  className="flex min-w-0 items-center gap-[0.4em] rounded-[0.35em] border border-border/50 bg-background/50 px-[0.4em] py-[0.3em] opacity-0 dark:bg-white/[0.03]"
                >
                  <TabMark mark={t.mark} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.55em] font-medium leading-tight">
                      {t.title}
                    </span>
                    <span
                      className={cn(mono, "block truncate text-[0.45em] leading-tight text-muted-foreground")}
                    >
                      {t.host}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* iPhone — the same tabs, on the phone. Only where it fits. */}
        <div className="hidden w-[27%] shrink-0 @lg:block">
          <PhoneMock />
        </div>
      </div>
    </div>
  );
}

function PhoneMock() {
  return (
    <div className="flex w-full flex-col overflow-hidden rounded-[0.8em] border border-border/70 bg-card/80 p-[0.45em] shadow-[0_10px_28px_-10px_rgb(0_0_0/0.3)] dark:border-white/[0.12] dark:bg-[#161616]/90">
      {/* Notch. */}
      <div className="flex justify-center pb-[0.35em]">
        <span className="h-[0.22em] w-[1.5em] rounded-full bg-foreground/20 dark:bg-white/20" />
      </div>
      <div className="flex items-center gap-[0.3em] px-[0.1em]">
        <LivePip small />
        <span className="text-[0.5em] font-medium">iPhone</span>
      </div>
      <div className="mt-[0.4em] space-y-[0.3em]">
        {LIVE_TABS.map((t) => (
          <div
            key={t.host}
            data-demo="live-tab-phone"
            className="flex min-w-0 items-center gap-[0.3em] rounded-[0.3em] border border-border/50 bg-background/50 px-[0.3em] py-[0.28em] opacity-0 dark:bg-white/[0.03]"
          >
            <TabMark mark={t.mark} small />
            <span className="block truncate text-[0.48em] font-medium leading-tight">{t.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TabMark({ mark, small }: { mark: string; small?: boolean }) {
  return (
    <span
      className={cn(
        mono,
        "flex shrink-0 items-center justify-center rounded-[0.25em] border border-border/60 bg-foreground/[0.06] font-semibold text-foreground/70",
        small ? "size-[1em] text-[0.42em]" : "size-[1.2em] text-[0.5em]",
      )}
    >
      {mark}
    </span>
  );
}

/** The emerald "reporting now" pip — a filled dot with a ping halo. */
function LivePip({ small }: { small?: boolean }) {
  const size = small ? "size-[0.4em]" : "size-[0.5em]";
  return (
    <span className={cn("relative flex shrink-0", size)} aria-hidden>
      <span className="absolute inset-0 rounded-full bg-emerald-500/70 motion-safe:animate-ping" />
      <span className={cn("relative rounded-full bg-emerald-500", size)} />
    </span>
  );
}
