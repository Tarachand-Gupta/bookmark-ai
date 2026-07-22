"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cn } from "@/lib/utils";
import { glass } from "../primitives";
import { BrowserWindow } from "./browser-window";
import { Cursor } from "./cursor";
import { DashboardMock } from "./dashboard-mock";
import { GEO, QUERY, sel } from "./data";
import { buildDemoTimeline } from "./timeline";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * The pitch, acted out: click the extension → the popup opens → save the page →
 * pull back to the library it went into → find it again by meaning. One shot,
 * ~12s, looping. The five beats live in `./timeline`.
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
          onToggle: (self) => (self.isActive ? tl.play() : tl.pause()),
        });

        // Seek to 0 *synchronously* here, inside the layout effect, so the slate
        // is applied before this frame paints. Without the explicit seek the
        // first GSAP tick can land after paint and the finished frame flashes
        // for one frame before the film starts.
        if (st.isActive) tl.play(0);
        else tl.pause(0);
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

    // A tab opened in the background never ticks rAF. Building there would
    // apply the slate and then freeze on beat 1 until the user looks — so we
    // don't build at all, and the finished frame stands in until they do.
    let onVisible: (() => void) | undefined;
    if (document.visibilityState === "visible") {
      play();
    } else {
      onVisible = () => {
        if (document.visibilityState === "visible") play();
      };
      document.addEventListener("visibilitychange", onVisible);
    }

    return () => {
      if (onVisible) document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("resize", onResize);
      clearTimeout(resizeTimer);
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
        {/* The camera. One element, one transform, five beats.

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
