"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cn } from "@/lib/utils";
import { glass, mono } from "../primitives";
import { BrowserWindow } from "./browser-window";
import { Cursor } from "./cursor";
import { DashboardMock } from "./dashboard-mock";
import { GEO, QUERY, sel } from "./data";
import { LiveExtension } from "./live-extension";
import { buildDemoTimeline } from "./timeline";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * The pitch, acted out, in two acts. Act one (~14s): click the extension → the
 * popup opens → save the page → pull back to the library it went into → find it
 * again by meaning. Act two (~15s), the differentiator, told with the same
 * craft: the camera returns to the extension and the cursor flips ON the
 * "Share window as live session" switch → pulls back and clicks "Live sessions"
 * in the sidebar → the view fills with the device's open tabs streaming in
 * live, mirrored to a phone. A caption above the frame names whichever act is
 * playing. One shot, ~30s, looping. Every beat lives in `./timeline`.
 *
 * Three structural decisions worth knowing before editing:
 *
 * **The default DOM is the last frame, not the first.** The dashboard renders
 * complete, with the search run and the results filtered. Reduced-motion
 * visitors, no-JS visitors and background tabs all get that finished picture and
 * nothing else; the timeline's opening move is to wind it back to beat 1. So a
 * failure to animate degrades to a meaningful still, never to a blank box.
 *
 * **The type scale is a container query, not a breakpoint.** The stage's
 * `font-size` is `cqw`-derived and every size inside both mocks is in `em`, so
 * the whole scene scales continuously with its column and the layout below is
 * pure percentages. No JS measurement, no resize handler, no SSR flash.
 *
 * **The whole thing is inert.** `aria-hidden`, `pointer-events-none`, no real
 * inputs or buttons: it's narration, and the hero's actual text carries the
 * information. Nothing here is tabbable and nothing here is clickable, because
 * a fake search field that swallows a click is a bug.
 */
export function HeroDemo() {
  const rootRef = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Asked for no motion: the scene is already the finished frame. Leave.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.registerPlugin(ScrollTrigger);
    let ctx: gsap.Context | undefined;
    let compact: boolean | undefined;
    // The authoritative "resume/pause to the correct state" callback for the
    // currently-built timeline. Hoisted so the persistent visibility listener
    // (below) can drive it too, not just ScrollTrigger. Undefined until built.
    let sync: (() => void) | undefined;

    // Which storyboard applies is a question about the *column*, not the
    // viewport — so ask the DOM rather than re-deriving the container query in
    // a media query that would only ever approximate it.
    const isCompact = () => {
      const browser = root.querySelector(sel.browser);
      return !browser || getComputedStyle(browser).display === "none";
    };

    const play = () => {
      if (ctx) return;
      compact = isCompact();
      ctx = gsap.context(() => {
        const tl = buildDemoTimeline(root, compact!);

        // Nobody's looking — don't animate. The hero leaves the viewport within
        // a screen of scrolling and there's no reason to keep paying for it.
        const st = ScrollTrigger.create({
          trigger: root,
          start: "top bottom",
          end: "bottom top",
          // onToggle only fires on an *edge*; a resize-driven ScrollTrigger
          // refresh can pause us mid-flight and then never fire a matching
          // "on" edge (from ST's bookkeeping the trigger never left the active
          // range), which is how the film used to wedge on the search frame
          // for good. So the play/pause decision is a single authoritative
          // `sync()` that re-derives the desired state from live inputs, and
          // it's driven from BOTH the toggle edge AND every refresh — the
          // refresh is what unwedges the stuck case.
          onToggle: () => sync?.(),
          onRefresh: () => sync?.(),
        });

        // Resume/pause to the state the inputs actually imply, idempotently:
        // play forward from wherever the head is when the hero is on-screen AND
        // the tab is visible; pause otherwise. `tl.play()`/`tl.pause()` are
        // both no-ops if already in that state, so calling this repeatedly (on
        // every toggle, refresh, and visibility change) is free and safe.
        sync = () => {
          const shouldPlay = st.isActive && document.visibilityState === "visible";
          if (shouldPlay) {
            if (tl.paused()) tl.play();
          } else if (!tl.paused()) {
            tl.pause();
          }
        };

        // Seek to 0 *synchronously* here, inside the layout effect, so the slate
        // is applied before this frame paints. Without the explicit seek the
        // first GSAP tick can land after paint and the finished frame flashes
        // for one frame before the film starts. Then hand off to sync().
        tl.pause(0);
        sync();
      }, rootRef);
    };

    // Crossing the threshold (rotating a phone, mostly) invalidates the whole
    // survey the timeline was built from, so rebuild rather than let a camera
    // aim at coordinates that no longer exist.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!ctx || isCompact() === compact) return;
        ctx.revert();
        ctx = undefined;
        play();
      }, 200);
    };
    window.addEventListener("resize", onResize);

    // Visibility does double duty. A tab opened in the background never ticks
    // rAF, so building there would apply the slate and freeze until the user
    // looks — so we defer the *build* until first visible. And once built, a
    // hidden→visible transition has to resume a timeline `sync()` paused while
    // hidden (rAF was stopped) — the old code only ever ran on first show and
    // so left a returning tab stuck. One persistent listener covers both:
    // build if we haven't yet, otherwise re-sync.
    const onVisible = () => {
      if (!ctx) {
        if (document.visibilityState === "visible") play();
      } else {
        sync?.();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    if (document.visibilityState === "visible") play();

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("resize", onResize);
      clearTimeout(resizeTimer);
      sync = undefined;
      ctx?.revert();
      // revert() restores inline styles, but the typed query is text content,
      // which it has no idea about.
      const text = root.querySelector(sel.searchText);
      if (text) text.textContent = QUERY;
    };
  }, []);

  return (
    <div
      ref={rootRef}
      aria-hidden
      className="@container pointer-events-none relative w-full select-none"
    >
      {/* The caption — names whichever act is currently playing. Two states
          stacked and cross-faded by the timeline (same idiom as the
          dashboard's meta-row), so the swap never reflows the layout above
          the frame. Default is act one's line, matching the demo's own
          default DOM state (see below). */}
      <div className="relative mb-3 h-[1.1rem] @md:mb-4">
        <p
          data-demo="caption-1"
          className={cn(
            mono,
            "absolute inset-0 flex items-center gap-2.5 text-[0.7rem] font-medium uppercase tracking-[0.22em] text-muted-foreground",
          )}
        >
          <span aria-hidden className="h-px w-5 shrink-0 bg-border" />
          Saving bookmarks &amp; finding them anywhere
        </p>
        <p
          data-demo="caption-2"
          className={cn(
            mono,
            "absolute inset-0 flex items-center gap-2.5 text-[0.7rem] font-medium uppercase tracking-[0.22em] text-muted-foreground opacity-0",
          )}
        >
          <span aria-hidden className="h-px w-5 shrink-0 bg-border" />
          Live tabs — see your open tabs on any device
        </p>
      </div>

      <div
        data-demo="stage"
        className={cn(
          glass,
          "relative w-full overflow-hidden rounded-2xl",
          // Narrow: a single-column list wants a portrait frame. Wide: the
          // sidebar-and-grid dashboard wants a landscape one.
          "aspect-[5/6] @md:aspect-[4/3]",
          // The type scale for everything inside. Clamped so the scene stays
          // legible in a phone-width column and stops growing past its design.
          "text-[clamp(11px,2.4cqw,16px)]",
        )}
      >
        {/* The camera. One element, one transform, both acts.

            No permanent `will-change: transform` here: it promotes the camera to
            a raster-cached compositing layer that's drawn once at scale-1 size
            and then GPU-upscaled by the ~2.35x closeup zoom — which is exactly
            why the closeup used to read blurry and only sharpened once the
            camera pulled back to scale 1. Left un-promoted, the static zoomed
            hold is painted at true device resolution (crisp), and the timeline
            re-adds `will-change` only for the duration of the beat-4 dolly, the
            one stretch where the camera actually moves. */}
        <div
          data-demo="camera"
          className="absolute inset-0 origin-top-left"
        >
          <DashboardMock />
          <BrowserWindow />
          <LiveExtension />

          {/* Beat 1's frame, as a box. The camera measures this at runtime and
              solves its own scale and offset to fit it — so re-composing the
              opening shot is four numbers in ./data, not trigonometry here. */}
          <div
            data-demo="closeup"
            className="pointer-events-none absolute opacity-0"
            style={{
              left: `${GEO.closeup.left}%`,
              top: `${GEO.closeup.top}%`,
              width: `${GEO.closeup.width}%`,
              height: `${GEO.closeup.height}%`,
            }}
          />
        </div>

        {/* Outside the camera on purpose — see ./cursor. */}
        <Cursor />
      </div>
    </div>
  );
}
