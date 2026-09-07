import { ArrowDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlatformEntry } from "@/lib/platforms";
import { PlatformActionButton } from "../platform-action";
import { PlatformIcon } from "../platform-icon";
import { display, glass, mono } from "../primitives";
import { StatusBadge } from "../status-badge";

/**
 * One platform on /download: status, the primary control, and the exact
 * install steps inline — the page exists to be read, so nothing is folded
 * away. Anchored by id so the homepage cards and the in-app extension card
 * can deep-link straight to it.
 */
export function PlatformCard({ entry, wide = false }: { entry: PlatformEntry; wide?: boolean }) {
  const KIND_LABEL: Record<PlatformEntry["kind"], string> = {
    extension: "browser extension",
    app: "native app",
    web: "web app",
  };

  return (
    <article
      id={entry.id}
      className={cn(
        glass,
        "flex scroll-mt-24 flex-col gap-5 rounded-2xl p-6 sm:p-7",
        // The web app closes the grid full-width: it is the fallback for every
        // platform above it, so it reads as the floor, not an orphan.
        wide && "lg:col-span-2",
      )}
    >
      <header className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/50">
          <PlatformIcon icon={entry.icon} className="size-6 text-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 className={cn(display, "text-xl font-semibold tracking-tight")}>{entry.name}</h2>
            {entry.badge && <StatusBadge status={entry.status}>{entry.badge}</StatusBadge>}
          </div>
          <p className={cn(mono, "mt-0.5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80")}>
            {KIND_LABEL[entry.kind]}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{entry.blurb}</p>
        </div>
      </header>

      <PlatformActionButton entry={entry} onDownloadPage compact />

      <div>
        <h3 className={cn(mono, "text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground")}>
          How to install
        </h3>
        <ol className="mt-3 space-y-2.5 text-sm text-foreground/90">
          {entry.steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span
                className={cn(
                  mono,
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/[0.07] text-[10.5px] text-foreground dark:bg-foreground/[0.1]",
                )}
              >
                {i + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
        {entry.note && (
          <p className="mt-4 border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
            {entry.note}
          </p>
        )}
      </div>

      {entry.source && (
        <a
          href={`#source-${entry.id}`}
          className={cn(
            mono,
            "group inline-flex w-fit items-center gap-1.5 rounded-sm text-xs font-medium text-foreground transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          Build from source
          <ArrowDown className="size-3.5 transition-transform group-hover:translate-y-0.5" aria-hidden />
        </a>
      )}
      {entry.kind === "web" && (
        <a
          href="https://www.bookmark-ai.cloud/app"
          className={cn(mono, "inline-flex w-fit items-center gap-1.5 rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground")}
        >
          www.bookmark-ai.cloud/app
          <ExternalLink className="size-3" aria-hidden />
        </a>
      )}
    </article>
  );
}
