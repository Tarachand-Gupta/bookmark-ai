"use client";

import { useState } from "react";
import type { Bookmark } from "@bookmark-ai/types";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/dashboard";
import { safeHref } from "@/lib/safe-href";
import { DEVICE_ICONS } from "@/components/library/device-badges";
import { CategoryChip } from "./category-chip";

/**
 * ONE compact bookmark line for the dashboard — favicon, title, domain, relative
 * time, the device it came from, and an inert category chip.
 *
 * The WHOLE ROW is the anchor, not the title inside it. That's the rule for every
 * row on this dashboard: one row, one destination, one tab stop. It also means
 * nothing else in the row may be interactive, which is why the category chip is
 * inert here (an anchor can't legally contain another anchor) — the same chip
 * links to the filtered library in Activity, where it stands on its own.
 *
 * There is no `dense` variant any more: the four cards are equal-width halves of
 * one grid, so there is no narrow-column case left to shrink type for, and the
 * page's type scale is text-sm rows / text-xs meta everywhere.
 */
export function DashboardBookmarkRow({
  bookmark: b,
  className,
}: {
  bookmark: Bookmark;
  className?: string;
}) {
  const href = safeHref(b.url);
  const device = b.source.device && b.source.device !== "other" ? b.source.device : null;
  const DeviceIcon = device ? (DEVICE_ICONS[device] ?? Globe) : null;
  // Spoken, not drawn: the glyph is a 12px hint, the screen reader gets the words.
  const origin = [b.source.deviceName || device, b.source.browser !== "other" ? b.source.browser : null]
    .filter(Boolean)
    .join(" · ");

  const body = (
    <>
      <RowFavicon bookmark={b} />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-1 text-sm font-medium [overflow-wrap:anywhere]">
          {b.title || b.domain}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{b.domain}</span>
          <span aria-hidden>·</span>
          <time dateTime={b.source.savedAt} className="shrink-0">
            {relativeTime(b.source.savedAt)}
          </time>
          {DeviceIcon && (
            <>
              <span aria-hidden>·</span>
              <DeviceIcon className="size-3 shrink-0" aria-hidden />
              <span className="sr-only">Saved from {origin}</span>
            </>
          )}
        </span>
      </span>
      {/* `@container`: the chip only appears once the ROW is wide enough (24rem)
          that it isn't eating the title's last 150px — this row renders in a
          half-width card at lg and full width on a phone. */}
      <CategoryChip
        category={b.category}
        className="hidden shrink-0 @min-[24rem]:inline-flex"
      />
    </>
  );

  const shell =
    "@container flex min-w-0 items-center gap-2.5 px-4 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

  // A non-http(s) URL is never rendered as a link (see safeHref) — the row stays
  // readable, it just isn't clickable.
  if (!href) {
    return <span className={cn(shell, "text-muted-foreground", className)}>{body}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(shell, "hover:bg-muted/50", className)}
    >
      {body}
    </a>
  );
}

function RowFavicon({ bookmark: b }: { bookmark: Bookmark }) {
  const [failed, setFailed] = useState(false);
  if (!b.og.favicon || failed) {
    return <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary external hosts
    <img
      src={b.og.favicon}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-4 shrink-0 rounded-sm"
    />
  );
}
