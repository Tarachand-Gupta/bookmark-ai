"use client";

import { useState } from "react";
import Link from "next/link";
import type { Bookmark } from "@bookmark-ai/types";
import {
  AppWindow,
  ArrowRight,
  ExternalLink,
  Globe,
  Layers,
  PlayCircle,
  Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { relativeTime, type ContinueTarget } from "@/lib/dashboard";
import { deviceFreshness, formatDeviceAge } from "@/lib/live-format";
import { BROWSER_ICONS, DEVICE_ICONS } from "@/components/library/device-badges";
import { DashboardBookmarkRow } from "./bookmark-row";
import { DashboardCard } from "./dashboard-card";
import { allBookmarksHref, deviceHref, liveHref, sessionsHref } from "./links";
import { openTabsInNewWindow } from "./open-tabs";

/**
 * "Continue where you left off" — the hero, and the whole reason the dashboard
 * exists (docs/features/dashboard.md §3.2: resume beats browse).
 *
 * The ranking is `rankContinueTargets` (lib/dashboard.ts, unit-tested), capped at
 * two; this component renders BOTH of them as equally rich rows and labels each
 * one honestly — "Active now" vs "Earlier today" — because a card that overstates
 * freshness is worse than no card.
 *
 * The old separate "Live now" card is folded in here: it listed the same devices
 * this hero was already ranking, so the landing page showed one device twice with
 * two different verbs. One list, each row carrying what it actually is (device,
 * browser, tab/window counts, freshness) plus a peek at what's inside it, and the
 * footer goes to the full live view for everything the cap left out.
 *
 * Renders null with no targets (principle 3: no empty cards).
 */

/** How many tab titles a row previews. Three is enough to recognize a window;
 * more turns the hero into a tab list, which is what the live view is for. */
const PREVIEW_TABS = 3;

export function ContinueCard({
  targets,
  liveDeviceCount = 0,
  className,
}: {
  targets: ContinueTarget[];
  /** Devices currently mirroring tabs — the header's "N live" pill. Not derived
   * from `targets`: the ranking drops idle/stale devices the live view still
   * lists, and the pill must agree with THAT page, not with this card. */
  liveDeviceCount?: number;
  className?: string;
}) {
  const [note, setNote] = useState<string | null>(null);
  if (targets.length === 0) return null;
  // The ranking already de-dupes live devices, but a second row repeating the
  // first would be pure noise — never render one.
  const rows = targets.filter((t, i) => i === 0 || !sameTarget(targets[0], t));
  const footer = footerLink(rows);

  return (
    <DashboardCard
      title="Continue where you left off"
      Icon={PlayCircle}
      action={liveDeviceCount > 0 ? <LivePill count={liveDeviceCount} /> : undefined}
      footerHref={footer.href}
      footerLabel={footer.label}
      className={className}
      flush
    >
      <ul className="divide-y">
        {rows.map((target, i) => (
          <li key={targetKey(target)}>
            {/* Only the top row gets the solid button: it's the one the ranking
                actually recommends, and two dark buttons stacked read as a
                choice rather than a suggestion. */}
            <ResumeRow target={target} emphasis={i === 0} onNote={setNote} />
          </li>
        ))}
      </ul>
      {note && (
        <p className="border-t bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
          {note}
        </p>
      )}
    </DashboardCard>
  );
}

/** "2 live" — emerald only while it's true, and never rendered at zero. */
function LivePill({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-500">
      <span aria-hidden className="size-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
      <span className="tabular-nums">{count} live</span>
    </span>
  );
}

/** Where the footer hands off: the live view when any row is a live device, the
 * sessions view when the best we have is a saved window, the library otherwise.
 * Linking to Live from a card holding no live rows would promise a page that's
 * empty for this user. */
function footerLink(targets: ContinueTarget[]): { href: string; label: string } {
  if (targets.some((t) => t.kind === "live")) {
    return { href: liveHref(), label: "All live sessions" };
  }
  if (targets.some((t) => t.kind === "session")) {
    return { href: sessionsHref(), label: "All sessions" };
  }
  return { href: allBookmarksHref(), label: "All bookmarks" };
}

/** Stable per-target key (two live rows are two different devices). */
function targetKey(target: ContinueTarget): string {
  if (target.kind === "live") return `live:${target.device.deviceId}`;
  if (target.kind === "session") return `session:${target.tabs.id}`;
  return "bookmarks";
}

function ResumeRow({
  target,
  emphasis,
  onNote,
}: {
  target: ContinueTarget;
  emphasis: boolean;
  onNote: (note: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);

  const openAll = async (urls: string[], name?: string) => {
    setBusy(true);
    onNote(null);
    try {
      onNote(await openTabsInNewWindow(urls, { name }));
    } finally {
      setBusy(false);
    }
  };

  if (target.kind === "live") {
    const device = target.device;
    const DeviceIcon = DEVICE_ICONS[device.device] ?? Globe;
    const BrowserIcon = BROWSER_ICONS[device.browser] ?? Globe;
    // The dot follows the live view's own presence rule (filled = seen in the
    // last 10 min), not the ranking's coarser label.
    const { filled } = deviceFreshness(device.lastSeenAgeSeconds);
    const windows = device.windows.length;
    const tabs = previewOrder(device.windows);

    return (
      <RowShell
        Icon={DeviceIcon}
        dot={filled}
        title={device.label || "This device"}
        status={target.label}
        statusFresh={filled}
        meta={
          <>
            <BrowserIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="capitalize">{device.browser}</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              {device.tabCount} tab{device.tabCount === 1 ? "" : "s"}
            </span>
            {windows > 1 && (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{windows} windows</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>{formatDeviceAge(device.lastSeenAgeSeconds)}</span>
          </>
        }
        preview={<TabPreview tabs={tabs} total={device.tabCount} />}
        actions={
          <>
            <Button asChild size="sm" variant={emphasis ? "default" : "outline"}>
              <Link href={liveHref()}>
                <Radio aria-hidden />
                Open live view
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || target.urls.length === 0}
              onClick={() => void openAll(target.urls, device.label)}
            >
              <ExternalLink aria-hidden />
              Open tabs here
            </Button>
          </>
        }
      />
    );
  }

  if (target.kind === "session") {
    const name = target.session?.name ?? "Last saved session";
    const tabCount = target.session?.tabCount ?? target.tabs.tabs.length;
    return (
      <RowShell
        Icon={Layers}
        title={name}
        status={target.label}
        meta={
          <>
            <span className="tabular-nums">
              {tabCount} tab{tabCount === 1 ? "" : "s"}
            </span>
            <span aria-hidden>·</span>
            <span>saved window</span>
          </>
        }
        // Reversed: session tabs are stored in window order (oldest leftmost),
        // and the preview leads with what was touched last — see previewOrder.
        preview={<TabPreview tabs={[...target.tabs.tabs].reverse()} total={tabCount} />}
        actions={
          <>
            <Button
              size="sm"
              variant={emphasis ? "default" : "outline"}
              disabled={busy || target.tabs.tabs.length === 0}
              onClick={() => void openAll(target.tabs.tabs.map((t) => t.url), name)}
            >
              <AppWindow aria-hidden />
              Open all in new window
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href={sessionsHref()}>
                All sessions
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </>
        }
      />
    );
  }

  // Saved-elsewhere bookmarks: the preview IS the payload here, so these stay
  // real DashboardBookmarkRows (each title opens its page) rather than the inert
  // text lines a tab preview uses.
  return (
    <RowShell
      Icon={Globe}
      title="Saved on another device"
      status={relativeTime(target.bookmarks[0]?.source.savedAt ?? "")}
      meta={<span>pick up what you saved elsewhere</span>}
      preview={
        <div className="min-w-0 divide-y overflow-hidden rounded-lg border">
          {target.bookmarks.slice(0, PREVIEW_TABS).map((b) => (
            <DashboardBookmarkRow key={b.id} bookmark={b} dense className="px-2.5" />
          ))}
        </div>
      }
      actions={
        <Button asChild size="sm" variant={emphasis ? "default" : "outline"}>
          {/* These are BOOKMARKS, so this goes to the library (narrowed to the
              device they came from when they all share one) — not to sessions. */}
          <Link href={otherDeviceBookmarksHref(target.bookmarks)}>
            View saves
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      }
    />
  );
}

/**
 * One resume row's chrome: identity tile, title + honest freshness, a meta line,
 * the peek at what's inside, then the verbs. Every kind wears the same shape so
 * the hero reads as one list instead of three bespoke panels.
 *
 * `@container` (not viewport breakpoints): this row renders in a 7/12 hero at lg
 * and full-width when the grid collapses, so the preview's domain column has to
 * react to the ROW's width.
 */
function RowShell({
  Icon,
  dot,
  title,
  status,
  statusFresh,
  meta,
  preview,
  actions,
}: {
  Icon: React.ElementType;
  /** Presence dot on the icon tile: true = filled/pulsing, false = hollow ring,
   * undefined = no dot at all (nothing live to claim). */
  dot?: boolean;
  title: string;
  status: string;
  statusFresh?: boolean;
  meta: React.ReactNode;
  preview?: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <div className="@container flex min-w-0 flex-col gap-2.5 px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="relative mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          {dot !== undefined && (
            <span
              aria-hidden
              className={cn(
                "absolute -right-0.5 -top-0.5 size-2 rounded-full",
                dot
                  ? "bg-emerald-500 motion-safe:animate-pulse"
                  : "border border-muted-foreground/60 bg-card",
              )}
            />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate font-semibold">{title}</span>
            {status && (
              <span
                className={cn(
                  "shrink-0 text-xs font-medium",
                  statusFresh ? "text-emerald-600 dark:text-emerald-500" : "text-muted-foreground",
                )}
              >
                {status}
              </span>
            )}
          </p>
          <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {meta}
          </p>
        </div>
      </div>
      {preview}
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

/**
 * What's actually inside the window — the thing counts alone can't tell you
 * ("14 tabs" is not a reason to switch devices; "the three docs you were reading"
 * is). Titles only, no favicons: the row already carries a device+browser
 * identity, and three more 16px images per row is noise plus three requests.
 *
 * Inert text, not links: opening ONE of someone's live tabs from a preview line
 * is a different intent than the row's two explicit verbs.
 */
/**
 * Preview ordering: what the user touched LAST, first — they recognize their
 * most recent tabs far better than a window's oldest, leftmost ones (owner
 * feedback). The live payload carries no timestamps, so the proxies are: the
 * focused window's ACTIVE tab is what was on screen at the last checkpoint,
 * and within a window newer tabs live to the RIGHT — so active tabs lead and
 * each window's list is walked right-to-left.
 */
function previewOrder(
  windows: { focused?: boolean; tabs: { url: string; title?: string; active?: boolean }[] }[],
): { url: string; title?: string }[] {
  const ordered = [...windows].sort((a, b) => Number(b.focused ?? false) - Number(a.focused ?? false));
  const active = ordered.flatMap((w) => w.tabs.filter((t) => t.active));
  const rest = ordered.flatMap((w) => [...w.tabs].reverse().filter((t) => !t.active));
  return [...active, ...rest];
}

function TabPreview({
  tabs,
  total,
}: {
  tabs: { url: string; title?: string | null }[];
  total: number;
}) {
  const shown = tabs.slice(0, PREVIEW_TABS);
  if (shown.length === 0) return null;
  // Against `total` (the device/session's real tab count), never against the
  // truncated array the payload happened to include.
  const more = Math.max(0, total - shown.length);

  return (
    <ul className="min-w-0 space-y-1 rounded-lg border bg-muted/30 px-2.5 py-2">
      {shown.map((tab, i) => {
        const title = tab.title?.trim();
        const host = hostOf(tab.url);
        return (
          <li key={`${i}:${tab.url}`} className="flex min-w-0 items-baseline gap-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate">{title || host || tab.url}</span>
            {title && host && (
              <span className="hidden max-w-[45%] shrink-0 truncate text-muted-foreground @min-[22rem]:inline">
                {host}
              </span>
            )}
          </li>
        );
      })}
      {more > 0 && (
        <li className="text-xs text-muted-foreground tabular-nums">+{more} more</li>
      )}
    </ul>
  );
}

/** Display host for a preview line. Live/session snapshots legitimately contain
 * chrome://, about:blank and redacted origins, so an unparseable URL falls back
 * to itself rather than throwing. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Where "Saved on another device" hands off: the library, filtered to `?device=`
 * when every one of those saves came from the same device type (a real library
 * facet — see FILTER_KEYS in library-page.tsx), else the unfiltered library.
 * "other" isn't a filter worth applying, so it doesn't narrow.
 */
function otherDeviceBookmarksHref(bookmarks: Bookmark[]): string {
  const devices = new Set(
    bookmarks.map((b) => b.source.device).filter((d) => d && d !== "other"),
  );
  const [only] = devices.size === 1 ? devices : [];
  return only ? deviceHref(only) : allBookmarksHref();
}

/** Two ranked targets that are really the same thing (same live device / same
 * saved session), so the second row can be dropped. */
function sameTarget(a: ContinueTarget, b: ContinueTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "live" && b.kind === "live") return a.device.deviceId === b.device.deviceId;
  if (a.kind === "session" && b.kind === "session") return a.tabs.id === b.tabs.id;
  // The ranking produces at most one "bookmarks" target, so same kind = same row.
  return true;
}
