"use client";

import * as React from "react";
import type { Bookmark, Browser, DeviceType } from "@bookmark-ai/types";
import {
  Chrome,
  Compass,
  Flame,
  Folder,
  Globe,
  Hash,
  Laptop,
  Monitor,
  Smartphone,
  Tablet,
  Trash2,
} from "lucide-react";
import { cn } from "../lib/cn";
import { Badge } from "./badge";
import { Card } from "./card";

const BROWSER_META: Record<Browser, { label: string; Icon: React.ElementType }> = {
  chrome: { label: "Chrome", Icon: Chrome },
  firefox: { label: "Firefox", Icon: Flame },
  safari: { label: "Safari", Icon: Compass },
  edge: { label: "Edge", Icon: Globe },
  arc: { label: "Arc", Icon: Globe },
  other: { label: "Web", Icon: Globe },
};

const DEVICE_META: Record<DeviceType, { label: string; Icon: React.ElementType }> = {
  desktop: { label: "Desktop", Icon: Monitor },
  laptop: { label: "Laptop", Icon: Laptop },
  mobile: { label: "Phone", Icon: Smartphone },
  tablet: { label: "Tablet", Icon: Tablet },
  other: { label: "Device", Icon: Monitor },
};

/**
 * Bulk-selection affordance, supplied by the host app (the web library) — these
 * components only decide WHERE it sits and when it shows, never what it is, so
 * this package needs no checkbox primitive of its own. Omit it entirely and every
 * card renders exactly as before; the extension does that.
 */
export interface BookmarkSelection {
  /** The checkbox element. Rendered outside every <a>, so ticking never navigates. */
  control: React.ReactNode;
  /** This card/row is ticked → ring + tinted surface. */
  selected: boolean;
  /**
   * Show the control without hover. Set once ANYTHING is selected (so the user
   * can see what else is tickable) and on touch, where there is no hover at all.
   */
  pinned: boolean;
}

export interface BookmarkCardProps {
  bookmark: Bookmark;
  onDelete?: (id: string) => void;
  className?: string;
  selection?: BookmarkSelection;
}

/**
 * The site name worth showing beside the domain, or null when it would only
 * repeat it: a page with no Open Graph site name used to render as
 * "tailwindcss.com · tailwindcss.com", which on a narrow card became
 * "tailwi… · tailwi…" — two ellipses saying the same thing.
 */
function distinctSiteName(b: Bookmark): string | null {
  const site = b.og.siteName?.trim();
  if (!site) return null;
  const domain = b.domain.toLowerCase();
  const normalized = site.toLowerCase();
  if (normalized === domain || normalized === domain.replace(/^www\./, "")) return null;
  return site;
}

/**
 * A bookmark rendered as a rich card: OG image hero, favicon + site, title,
 * description, AI category + tags, and capture provenance (browser, device,
 * day). Pure presentational — works in Next.js, Vite, and the extension.
 */
export function BookmarkCard({ bookmark: b, onDelete, className, selection }: BookmarkCardProps) {
  const browser = BROWSER_META[b.source.browser] ?? BROWSER_META.other;
  const device = DEVICE_META[b.source.device] ?? DEVICE_META.other;
  const siteName = distinctSiteName(b);

  return (
    <Card
      className={cn(
        "group relative flex flex-col overflow-hidden pt-0 transition-shadow hover:shadow-md",
        selection?.selected && "ring-2 ring-primary",
        className,
      )}
    >
      {selection && (
        // Overlaid, not in flow: the hero image runs to the card's edge, so a
        // checkbox in the layout would either push the image down or land on an
        // unknowable photo. The scrim is what keeps it legible over one — which
        // means it has to hold up against BOTH extremes of OG art: an /80 tint
        // with no outline vanished into dark hero images, so it's a near-opaque
        // theme surface with its own contrasting border and a lifted shadow.
        <span
          className={cn(
            "absolute left-2 top-2 z-10 flex items-center justify-center rounded-md border border-foreground/25 bg-background/90 p-1 shadow-md backdrop-blur-sm transition-opacity",
            selection.pinned
              ? "opacity-100"
              : "opacity-0 focus-within:opacity-100 group-hover:opacity-100",
          )}
        >
          {selection.control}
        </span>
      )}
      <a
        href={b.url}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={b.title}
        className="block"
      >
        <CardImage bookmark={b} />
      </a>

      <div
        className={cn(
          "flex flex-1 flex-col gap-2 p-4",
          // primary-tinted, not accent: `accent` is a neutral one shade off
          // `muted`, so a selected card was all but indistinguishable from a
          // hovered one. The brand tint reads as a state in both themes.
          selection?.selected && "bg-primary/10",
        )}
      >
        {/* Site · domain. The domain is the short, reliable half, so it keeps its
            width (capped at under half the row) and the site name is what
            ellipsizes — "Documentation - Gene… · docs.oracle.com" rather than
            the two half-words a proportional squeeze produced. */}
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <Favicon bookmark={b} />
          {siteName ? (
            <>
              <span className="min-w-0 truncate">{siteName}</span>
              <span aria-hidden className="shrink-0">
                ·
              </span>
              <span className="max-w-[45%] shrink-0 truncate">{b.domain}</span>
            </>
          ) : (
            <span className="min-w-0 truncate">{b.domain}</span>
          )}
        </div>

        <a
          href={b.url}
          target="_blank"
          rel="noreferrer noopener"
          className="line-clamp-2 font-semibold leading-snug [overflow-wrap:anywhere] hover:underline"
        >
          {b.title}
        </a>

        {b.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {b.description}
          </p>
        ) : null}

        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          <CategoryBadge category={b.category} />
          {b.tags.slice(0, 3).map((tag) => (
            <TagBadge key={tag} tag={tag} />
          ))}
        </div>

        {/* Provenance. The two labels ellipsize (never clip mid-glyph) and the
            date and delete button keep their width, so a narrow card reads
            "Chrome · Lap… · Today" at worst, never "Chrome  La". */}
        <div className="mt-auto flex min-w-0 items-center gap-3 pt-2 text-xs text-muted-foreground">
          <span
            className="inline-flex min-w-0 items-center gap-1"
            title={`Saved from ${browser.label}`}
          >
            <browser.Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{browser.label}</span>
          </span>
          <span
            className="inline-flex min-w-0 items-center gap-1"
            title={b.source.deviceName ?? device.label}
          >
            <device.Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{device.label}</span>
          </span>
          <time dateTime={b.source.savedAt} className="ml-auto shrink-0 whitespace-nowrap">
            {formatDay(b.source.savedAt)}
          </time>
          {onDelete ? (
            <button
              type="button"
              onClick={() => onDelete(b.id)}
              aria-label={`Delete ${b.title}`}
              className="shrink-0 rounded-md p-1 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/**
 * List-view variant: horizontal row with a side thumbnail, the same content
 * hierarchy as the card, and provenance pinned to the bottom edge.
 */
export function BookmarkListItem({
  bookmark: b,
  onDelete,
  className,
  selection,
}: BookmarkCardProps) {
  const browser = BROWSER_META[b.source.browser] ?? BROWSER_META.other;
  const device = DEVICE_META[b.source.device] ?? DEVICE_META.other;
  const siteName = distinctSiteName(b);

  return (
    <Card
      className={cn(
        "group flex flex-row items-stretch overflow-hidden transition-shadow hover:shadow-md",
        // See BookmarkCard: brand tint + ring, so selected ≠ merely hovered.
        selection?.selected && "bg-primary/10 ring-2 ring-primary",
        className,
      )}
    >
      {/* The thumbnail is absolutely positioned so a tall source image (e.g. a
          portrait poster) can never inflate the row height — the text column
          alone sets it and the image crops to fit. */}
      <a
        href={b.url}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={b.title}
        tabIndex={-1}
        className="relative hidden w-44 shrink-0 self-stretch sm:block"
      >
        <CardImage
          bookmark={b}
          className="absolute inset-0 aspect-auto h-full w-full"
          initialClassName="text-2xl"
        />
      </a>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FaviconOrSelect bookmark={b} selection={selection} />
          {siteName ? (
            <>
              <span className="line-clamp-1 min-w-0 [overflow-wrap:anywhere]">{siteName}</span>
              <span aria-hidden>·</span>
            </>
          ) : null}
          <span className="line-clamp-1 min-w-0 [overflow-wrap:anywhere]">{b.domain}</span>
          <time dateTime={b.source.savedAt} className="ml-auto shrink-0">
            {formatDay(b.source.savedAt)}
          </time>
        </div>

        <a
          href={b.url}
          target="_blank"
          rel="noreferrer noopener"
          className="line-clamp-1 font-semibold leading-snug hover:underline"
        >
          {b.title}
        </a>

        {b.description ? (
          <p className="line-clamp-1 text-sm text-muted-foreground">{b.description}</p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1.5">
          <CategoryBadge category={b.category} />
          {b.tags.slice(0, 4).map((tag) => (
            <TagBadge key={tag} tag={tag} />
          ))}
          <span
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground"
            title={`Saved from ${browser.label} · ${b.source.deviceName ?? device.label}`}
          >
            <browser.Icon className="size-3.5" aria-hidden />
            <device.Icon className="size-3.5" aria-hidden />
          </span>
          {onDelete ? (
            <button
              type="button"
              onClick={() => onDelete(b.id)}
              aria-label={`Delete ${b.title}`}
              className="rounded-md p-1 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/**
 * Compact-view variant: one dense line — favicon, title, domain, category,
 * date. Meant to be stacked inside a bordered, divided container.
 */
export function BookmarkCompactRow({
  bookmark: b,
  onDelete,
  className,
  selection,
}: BookmarkCardProps) {
  const browser = BROWSER_META[b.source.browser] ?? BROWSER_META.other;

  return (
    <div
      className={cn(
        "group flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50",
        // The tint carries most of the state here (an accent one was a near
        // match for the neutral hover these rows sit next to), deepening on
        // hover; the ring is INSET so it traces the row inside the container's
        // dividers instead of overlapping the neighbouring rows.
        selection?.selected &&
          "bg-primary/10 ring-1 ring-inset ring-primary/30 hover:bg-primary/15",
        className,
      )}
    >
      <FaviconOrSelect bookmark={b} selection={selection} />
      {/* line-clamp-1, not truncate: nowrap titles would push the row's
          intrinsic min-content past the viewport and scroll the page. */}
      <a
        href={b.url}
        target="_blank"
        rel="noreferrer noopener"
        className="line-clamp-1 min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere] hover:underline"
      >
        {b.title}
      </a>
      <span className="hidden w-40 shrink-0 truncate text-xs text-muted-foreground md:inline">
        {b.domain}
      </span>
      {/* Fixed-width SLOT so the domain column left of it lines up across rows
          (variable chip widths were shifting it); inside it the chip hugs its
          content, left-aligned. Outline = light look — the filled black chip
          stays card/list-only. */}
      <span className="hidden w-32 shrink-0 sm:block">
        <CategoryBadge category={b.category} variant="outline" className="max-w-full" />
      </span>
      <span
        className="hidden shrink-0 text-muted-foreground lg:inline-flex"
        title={`Saved from ${browser.label}`}
      >
        <browser.Icon className="size-3.5" aria-hidden />
      </span>
      <time
        dateTime={b.source.savedAt}
        className="w-20 shrink-0 text-right text-xs text-muted-foreground"
      >
        {formatDay(b.source.savedAt)}
      </time>
      {onDelete ? (
        <button
          type="button"
          onClick={() => onDelete(b.id)}
          aria-label={`Delete ${b.title}`}
          className="rounded-md p-1 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** Category and tags share a chip look; the icon tells them apart at a glance. */
function CategoryBadge({
  category,
  className,
  variant,
}: {
  category: string;
  className?: string;
  variant?: React.ComponentProps<typeof Badge>["variant"];
}) {
  // max-w-full: a chip can never be wider than its row, so a long name
  // ellipsizes inside the chip instead of the chip running under the card edge.
  return (
    <Badge
      variant={variant}
      className={cn("max-w-full", className)}
      title={`Category: ${category}`}
    >
      <Folder className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{category}</span>
    </Badge>
  );
}

function TagBadge({ tag, className }: { tag: string; className?: string }) {
  return (
    <Badge variant="muted" className={cn("max-w-full", className)} title={`Tag: ${tag}`}>
      <Hash className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{tag}</span>
    </Badge>
  );
}

function CardImage({
  bookmark: b,
  className,
  initialClassName,
}: {
  bookmark: Bookmark;
  className?: string;
  initialClassName?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  const [faviconFailed, setFaviconFailed] = React.useState(false);
  if (!b.og.image || failed) {
    // Hero fallback 1: the favicon, blown up and heavily blurred as ambient
    // backdrop (the blur hides the upscaling), with a crisp copy centered.
    if (b.og.favicon && !faviconFailed) {
      return (
        <div
          className={cn(
            "relative flex aspect-[1.91/1] w-full items-center justify-center overflow-hidden bg-muted",
            className,
          )}
        >
          <img
            src={b.og.favicon}
            alt=""
            aria-hidden
            loading="lazy"
            onError={() => setFaviconFailed(true)}
            className="absolute inset-0 h-full w-full scale-150 object-cover opacity-50 blur-2xl"
          />
          <img
            src={b.og.favicon}
            alt=""
            loading="lazy"
            className="relative size-10 rounded-lg shadow-sm"
          />
        </div>
      );
    }
    // Hero fallback 2: muted panel with the domain's initial.
    return (
      <div
        className={cn(
          "flex aspect-[1.91/1] w-full items-center justify-center bg-muted",
          className,
        )}
      >
        <span
          className={cn("text-4xl font-semibold text-muted-foreground/50", initialClassName)}
        >
          {(b.og.siteName ?? b.domain).charAt(0).toUpperCase()}
        </span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary external hosts
    <img
      src={b.og.image}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("aspect-[1.91/1] w-full bg-muted object-cover", className)}
    />
  );
}

/**
 * The row's leading square: the favicon normally, the selection checkbox on
 * hover (or always, once `pinned`). Both occupy the SAME 1rem box and swap by
 * opacity — a conditional render here shifted every column right of it by a
 * pixel or two the moment the pointer entered the row.
 *
 * No selection ⇒ the bare favicon, byte-identical to what it rendered before.
 */
function FaviconOrSelect({
  bookmark: b,
  selection,
}: {
  bookmark: Bookmark;
  selection?: BookmarkSelection;
}) {
  if (!selection) return <Favicon bookmark={b} />;
  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      <span
        className={cn(
          "flex items-center justify-center transition-opacity",
          selection.pinned ? "opacity-0" : "opacity-100 group-hover:opacity-0",
        )}
      >
        <Favicon bookmark={b} />
      </span>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-opacity",
          selection.pinned
            ? "opacity-100"
            : "opacity-0 focus-within:opacity-100 group-hover:opacity-100",
        )}
      >
        {selection.control}
      </span>
    </span>
  );
}

function Favicon({ bookmark: b }: { bookmark: Bookmark }) {
  const [failed, setFailed] = React.useState(false);
  if (!b.og.favicon || failed) {
    return <Globe className="size-3.5 shrink-0" aria-hidden />;
  }
  return (
    <img
      src={b.og.favicon}
      alt=""
      onError={() => setFailed(true)}
      className="size-3.5 shrink-0 rounded-sm"
    />
  );
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
