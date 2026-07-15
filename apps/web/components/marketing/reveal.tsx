"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Quiet scroll-reveal. Fades and lifts its content (or, with `selector`, its
 * matching descendants in sequence) as it enters the viewport, once. The
 * default rendered state is fully visible, so with prefers-reduced-motion — or
 * no JS — everything is simply present, no hidden content.
 */
export function Reveal({
  children,
  className,
  selector,
  y = 18,
}: {
  children: React.ReactNode;
  className?: string;
  /** If set, animate these descendants with a stagger instead of the wrapper. */
  selector?: string;
  y?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const targets: gsap.TweenTarget = selector
        ? Array.from(el.querySelectorAll(selector))
        : el;
      // `immediateRender: false` is deliberate: the content is never pre-hidden,
      // it only animates the moment its trigger fires. So it can never get stuck
      // invisible — not in a background tab (rAF frozen), not if the trigger
      // never runs. Worst case, it's simply shown, already in place.
      gsap.from(targets, {
        opacity: 0,
        y,
        duration: 0.7,
        ease: "power2.out",
        stagger: selector ? 0.09 : 0,
        immediateRender: false,
        scrollTrigger: { trigger: el, start: "top 85%", once: true },
      });
    }, ref);

    return () => ctx.revert();
  }, [selector, y]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
