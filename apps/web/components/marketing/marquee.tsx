"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { cn } from "@/lib/utils";
import { PLATFORMS, type PlatformEntry } from "@/lib/platforms";
import { PlatformIcon } from "./platform-icon";
import { mono } from "./primitives";

const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Short marks for the strip — derived from platforms.ts so it can't list a
 * platform the cards below don't have. */
const LABELS: Record<PlatformEntry["id"], string> = {
  web: "Web",
  chrome: "Chrome",
  safari: "Safari",
  firefox: "Firefox",
  ios: "iOS · iPad",
  android: "Android",
  macos: "macOS app",
};
const ITEMS = PLATFORMS.map((p) => ({ icon: p.icon, label: LABELS[p.id] }));

function Item({ icon, label }: { icon: PlatformEntry["icon"]; label: string }) {
  return (
    <span className="flex items-center gap-2.5 px-7 text-muted-foreground">
      <PlatformIcon icon={icon} className="size-5 shrink-0" strokeWidth={1.6} />
      <span className={cn(mono, "whitespace-nowrap text-sm uppercase tracking-wide")}>
        {label}
      </span>
      <span aria-hidden className="ml-4 size-1 rounded-full bg-border" />
    </span>
  );
}

/**
 * Cross-device story as a slow, seamless drift of monochrome platform marks.
 * GSAP drives the loop (two mirrored copies, translated by half); under
 * prefers-reduced-motion it holds still as a plain, edge-masked row.
 */
export function PlatformMarquee() {
  const trackRef = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      gsap.to(track, {
        xPercent: -50,
        ease: "none",
        duration: 32,
        repeat: -1,
      });
    }, trackRef);
    return () => ctx.revert();
  }, []);

  return (
    <div
      className="relative overflow-hidden py-2"
      style={{
        maskImage:
          "linear-gradient(to right, transparent, black 12%, black 88%, transparent)",
        WebkitMaskImage:
          "linear-gradient(to right, transparent, black 12%, black 88%, transparent)",
      }}
    >
      <div ref={trackRef} className="flex w-max">
        {[0, 1].map((copy) => (
          <div key={copy} aria-hidden={copy === 1} className="flex shrink-0">
            {ITEMS.map((p) => (
              <Item key={p.label} icon={p.icon} label={p.label} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
