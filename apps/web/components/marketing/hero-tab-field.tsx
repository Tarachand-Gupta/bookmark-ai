"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cn } from "@/lib/utils";
import { mono } from "./primitives";

const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Hero cards sit directly on the near-black (or near-white) base, not on another
 * panel, so they need more presence than a generic glass tile: a lit frosted
 * fill that reads as a floating card on either theme.
 */
const heroCard =
  "rounded-xl border border-border/70 bg-card/60 backdrop-blur-md " +
  "shadow-[0_2px_12px_-4px_rgb(0_0_0/0.14),0_1px_0_0_rgb(255_255_255/0.6)_inset] " +
  "dark:border-white/[0.1] dark:bg-white/[0.05] " +
  "dark:shadow-[0_1px_0_0_rgb(255_255_255/0.08)_inset,0_22px_55px_-30px_rgb(0_0_0/0.8)]";

/**
 * Sample library — illustrative bookmarks, not real data and not a screenshot.
 * `depth` splits the field into two parallax layers on scroll.
 */
type Card = {
  letter: string;
  domain: string;
  title: string;
  cat: string;
  when: string;
  depth: 0 | 1;
};

const CARDS: Card[] = [
  { letter: "R", domain: "react.dev", title: "React — the library for web and native UIs", cat: "Development", when: "2d", depth: 0 },
  { letter: "F", domain: "figma.com", title: "The collaborative interface design tool", cat: "Design", when: "5d", depth: 1 },
  { letter: "A", domain: "arxiv.org", title: "Attention Is All You Need", cat: "Research", when: "1w", depth: 0 },
  { letter: "Y", domain: "news.ycombinator.com", title: "Hacker News — front page", cat: "Reading", when: "3h", depth: 1 },
  { letter: "R", domain: "doc.rust-lang.org", title: "The Rust Programming Language", cat: "Development", when: "6d", depth: 0 },
  { letter: "T", domain: "tailwindcss.com", title: "Build modern sites without leaving your HTML", cat: "Design", when: "2w", depth: 1 },
  { letter: "S", domain: "supabase.com", title: "The open source Firebase alternative", cat: "Development", when: "4d", depth: 0 },
  { letter: "O", domain: "platform.openai.com", title: "API reference and model docs", cat: "AI", when: "1d", depth: 1 },
];

/** Deterministic "tab-hoard" start pose per card: pushed out, tilted, shrunk. */
const SCATTER = [
  { x: -46, y: -58, r: -9, s: 0.9 },
  { x: 74, y: -34, r: 11, s: 0.92 },
  { x: -92, y: 22, r: -14, s: 0.88 },
  { x: 54, y: 72, r: 8, s: 0.9 },
  { x: -34, y: 112, r: -6, s: 0.93 },
  { x: 104, y: 44, r: 13, s: 0.87 },
  { x: -74, y: -22, r: -11, s: 0.9 },
  { x: 44, y: -92, r: 7, s: 0.91 },
];

function TabCard({ card, index }: { card: Card; index: number }) {
  return (
    <article
      data-card
      data-depth={card.depth}
      style={{ willChange: "transform" }}
      className={cn(
        heroCard,
        "flex flex-col gap-2.5 p-3.5",
        // The offset column: nudge every other card down so the settled grid
        // reads as composed, not a plain table.
        index % 2 === 1 ? "sm:mt-7" : "",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            mono,
            "flex size-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-foreground/[0.06] text-[11px] font-semibold text-foreground/70",
          )}
          aria-hidden
        >
          {card.letter}
        </span>
        <span className={cn(mono, "truncate text-[11px] text-muted-foreground")}>
          {card.domain}
        </span>
      </div>
      <p className="line-clamp-2 text-[0.8rem] font-medium leading-snug text-foreground">
        {card.title}
      </p>
      <div className="mt-auto flex items-center gap-2 pt-0.5">
        <span
          className={cn(
            mono,
            "rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground",
          )}
        >
          {card.cat}
        </span>
        <span className={cn(mono, "ml-auto text-[10px] text-muted-foreground/70")}>
          {card.when}
        </span>
      </div>
    </article>
  );
}

/**
 * The signature moment. On load the cards animate from a scattered, tilted
 * tab-hoard into a clean two-column grid — the product's value acted out in its
 * own material. Scroll adds a subtle parallax between the two depth layers, and
 * scrolling back to the top replays a small re-settle. Under
 * prefers-reduced-motion nothing animates: the organized grid is the default,
 * server-rendered state, so it simply appears.
 */
export function HeroTabField() {
  const rootRef = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.registerPlugin(ScrollTrigger);
    let ctx: gsap.Context | undefined;

    // The organized grid is the default DOM state. We only scatter-and-settle
    // when the page is actually visible — a tab loaded in the background never
    // ticks rAF, and we must never leave the cards stuck invisible there.
    const play = () => {
      if (ctx) return;
      ctx = gsap.context(() => {
        const cards = gsap.utils.toArray<HTMLElement>("[data-card]");
        const pose = (i: number) => SCATTER[i % SCATTER.length];

        // Chaos -> order on load.
        gsap.timeline({ defaults: { ease: "power3.out" } }).from(cards, {
          x: (i: number) => pose(i).x,
          y: (i: number) => pose(i).y,
          rotation: (i: number) => pose(i).r,
          scale: (i: number) => pose(i).s,
          opacity: 0,
          duration: 1.15,
          stagger: { each: 0.055, from: "random" },
        });

        // Two-layer parallax on scroll (depth), scrubbed and gentle.
        const scrub = {
          trigger: root,
          start: "top top",
          end: "bottom top",
          scrub: 0.5,
        } as const;
        gsap.to("[data-depth='0']", { yPercent: -4, ease: "none", scrollTrigger: scrub });
        gsap.to("[data-depth='1']", { yPercent: -9, ease: "none", scrollTrigger: scrub });

        // Re-settle when the field is scrolled back into view.
        ScrollTrigger.create({
          trigger: root,
          start: "top 65%",
          onEnterBack: () => {
            gsap.fromTo(
              cards,
              { rotation: (i: number) => (i % 2 ? 2.2 : -2.2), y: 7 },
              {
                rotation: 0,
                y: 0,
                duration: 0.55,
                ease: "power2.out",
                stagger: 0.03,
                overwrite: "auto",
              },
            );
          },
        });
      }, rootRef);
    };

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
      ctx?.revert();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="grid grid-cols-2 gap-3 sm:gap-4"
      style={{
        // A gentle vertical fade so the field dissolves at top and bottom
        // rather than reading as a hard rectangle of cards.
        maskImage:
          "linear-gradient(to bottom, transparent, black 7%, black 88%, transparent)",
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent, black 7%, black 88%, transparent)",
      }}
    >
      {CARDS.map((card, i) => (
        <TabCard key={card.domain + i} card={card} index={i} />
      ))}
    </div>
  );
}
