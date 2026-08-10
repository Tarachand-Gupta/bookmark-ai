"use client";

import { useState } from "react";
import Link from "next/link";
import type { Bookmark } from "@bookmark-ai/types";
import { Folder, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/dashboard";
import { safeHref } from "@/lib/safe-href";
import { BROWSER_ICONS, DEVICE_ICONS } from "@/components/library/device-badges";
import { categoryHref } from "./links";

/**
 * One compact bookmark line for the dashboard's Recent saves / Reading queue /
 * Continue cards: favicon, title, domain, a CLICKABLE category chip, relative
 * time and a device+browser origin badge.
 *
 * Deliberately not packages/ui's `BookmarkCompactRow`: that variant is built for
 * the library's compact view (fixed w-40/w-32/w-20 columns sized to a full-width
 * grid, a non-interactive category chip, no device badge). The dashboard needs a
 * narrower row whose chip is a filter link — the doc's "every card is a verb"
 * rule — so this is its own small component rather than a prop explosion there.
 */
export function DashboardBookmarkRow({
  bookmark: b,
  dense,
  className,
}: {
  bookmark: Bookmark;
  /** Tighter line height + smaller favicon/type, for cards that must stay small
   * next to a taller neighbour (Recent saves, the hero's saved-elsewhere peek).
   * Still a 32px+ hit area — this trims padding, not tappability. */
  dense?: boolean;
  className?: string;
}) {
  const href = safeHref(b.url);
  const BrowserIcon = BROWSER_ICONS[b.source.browser] ?? Globe;
  const DeviceIcon = DEVICE_ICONS[b.source.device] ?? Globe;
  const origin = [b.source.deviceName || b.source.device, b.source.browser]
    .filter((v) => v && v !== "other")
    .join(" · ");

  return (
    // `@container`, so the category chip below can react to how wide THIS ROW is
    // rather than how wide the window is: the same row renders in a full-width
    // Recent saves card and in a 4-column Reading list card that is ~300px at md
    // (and no wider at lg), where a viewport-based chip left ~12 characters of title.
    <div
      className={cn(
        "group @container flex items-center px-4 transition-colors hover:bg-muted/50",
        dense ? "gap-2 py-1.5" : "gap-2.5 py-2.5",
        className,
      )}
    >
      <RowFavicon bookmark={b} dense={dense} />
      <div className="min-w-0 flex-1">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className={cn(
              "line-clamp-1 font-medium [overflow-wrap:anywhere] hover:underline",
              dense ? "text-[13px]" : "text-sm",
            )}
          >
            {b.title || b.domain}
          </a>
        ) : (
          <span
            className={cn(
              "line-clamp-1 font-medium text-muted-foreground",
              dense ? "text-[13px]" : "text-sm",
            )}
          >
            {b.title || b.url}
          </span>
        )}
        <div
          className={cn(
            "flex items-center gap-1.5 text-muted-foreground",
            dense ? "text-[11px]" : "mt-0.5 text-xs",
          )}
        >
          <span className="truncate">{b.domain}</span>
          <span aria-hidden>·</span>
          <time dateTime={b.source.savedAt} className="shrink-0">
            {relativeTime(b.source.savedAt)}
          </time>
          {origin && (
            <span className="hidden shrink-0 items-center gap-1 sm:inline-flex" title={`Saved from ${origin}`}>
              <span aria-hidden>·</span>
              <DeviceIcon className="size-3" aria-hidden />
              <BrowserIcon className="size-3" aria-hidden />
            </span>
          )}
        </div>
      </div>
      {/* The chip is the card's second verb: it jumps to the filtered library —
          but only once the row is wide enough (24rem) that it isn't stealing the
          title's last 150px. Narrow cards get the title, which is the point of the row. */}
      <Link
        href={categoryHref(b.category)}
        title={`Show everything in ${b.category}`}
        className="hidden max-w-[9rem] shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground @min-[24rem]:inline-flex"
      >
        <Folder className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{b.category}</span>
      </Link>
    </div>
  );
}

function RowFavicon({ bookmark: b, dense }: { bookmark: Bookmark; dense?: boolean }) {
  const [failed, setFailed] = useState(false);
  const size = dense ? "size-3.5" : "size-4";
  if (!b.og.favicon || failed) {
    return <Globe className={cn(size, "shrink-0 text-muted-foreground")} aria-hidden />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary external hosts
    <img
      src={b.og.favicon}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn(size, "shrink-0 rounded-sm")}
    />
  );
}
