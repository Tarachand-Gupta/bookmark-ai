import { cn } from "@/lib/utils";

export const REPO = "https://github.com/Tarachand-Gupta/bookmark-ai";
export const REPO_README = `${REPO}#readme`;

/** Utility class helpers scoped to the marketing page. */
export const mono =
  "font-[family-name:var(--font-mono-marketing)]";
export const display =
  "font-[family-name:var(--font-display)]";

/**
 * The signature surface: frosted glass. A hairline border, a translucent themed
 * fill, backdrop-blur, an inset top sheen, and a soft drop shadow — tuned per
 * theme so it reads as lit glass on both the dark and the light base.
 */
export const glass =
  "border border-border/60 bg-card/40 backdrop-blur-xl " +
  "shadow-[0_1px_0_0_rgb(255_255_255/0.5)_inset,0_16px_50px_-24px_rgb(0_0_0/0.2)] " +
  "dark:bg-card/30 dark:shadow-[0_1px_0_0_rgb(255_255_255/0.06)_inset,0_28px_80px_-32px_rgb(0_0_0/0.7)]";

// whitespace-nowrap on both: these are fixed-height pills, so a wrapped label
// doesn't reflow them — it overflows them.
export const btnPrimary =
  "group inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground shadow-sm transition-[background-color,transform] hover:bg-primary/90 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export const btnOutline =
  "inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-border/70 bg-background/30 px-6 text-sm font-medium backdrop-blur-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** The brand ribbon mark (same silhouette as app/icon.svg), inheriting color. */
export function BookmarkMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M19 21 L12 17 L5 21 V5 A2 2 0 0 1 7 3 H17 A2 2 0 0 1 19 5 Z" />
    </svg>
  );
}

/**
 * The wordmark. The name is **bookmark-ai** — never "bookmark.ai", which is a
 * domain someone else owns and which quietly tells visitors the wrong place to
 * find us. `domain` extends it to the real production URL, bookmark-ai.cloud.
 *
 * Lives here so the two places that render it can't drift apart again: the name
 * is split across spans for the two-tone treatment, so a literal grep for
 * "bookmark.ai" finds nothing.
 */
export function Wordmark({ domain = false, className }: { domain?: boolean; className?: string }) {
  return (
    <span className={cn(mono, "font-semibold tracking-tight", className)}>
      bookmark
      <span className="text-muted-foreground">{domain ? "-ai.cloud" : "-ai"}</span>
    </span>
  );
}

/** Mono kicker used above section titles — a label, not decoration. */
export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        mono,
        "flex items-center gap-2.5 text-[0.7rem] font-medium uppercase tracking-[0.28em] text-muted-foreground",
        className,
      )}
    >
      <span aria-hidden className="h-px w-6 bg-border" />
      {children}
    </p>
  );
}

export function SectionHead({
  eyebrow,
  title,
  sub,
  className,
}: {
  eyebrow: string;
  title: React.ReactNode;
  sub?: string;
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", className)}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2
        className={cn(
          display,
          "mt-5 text-balance text-3xl font-semibold leading-[1.05] tracking-[-0.02em] sm:text-4xl md:text-[2.75rem]",
        )}
      >
        {title}
      </h2>
      {sub && <p className="mt-4 max-w-xl text-muted-foreground">{sub}</p>}
    </div>
  );
}
