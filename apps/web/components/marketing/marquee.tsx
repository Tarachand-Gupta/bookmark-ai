"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import {
  Apple,
  Chrome,
  Compass,
  Flame,
  Globe,
  Monitor,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { mono } from "./primitives";

const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const PLATFORMS = [
  { icon: Globe, label: "Web" },
  { icon: Chrome, label: "Chrome" },
  { icon: Compass, label: "Safari" },
  { icon: Flame, label: "Firefox" },
  { icon: Apple, label: "iOS · iPad" },
  { icon: Smartphone, label: "Android" },
  { icon: Monitor, label: "Desktop" },
];

function Item({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <span className="flex items-center gap-2.5 px-7 text-muted-foreground">
      <Icon className="size-5 shrink-0" strokeWidth={1.6} aria-hidden />
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
            {PLATFORMS.map((p) => (
              <Item key={p.label} icon={p.icon} label={p.label} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
