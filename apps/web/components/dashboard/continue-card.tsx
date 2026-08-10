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
import { BROWSER_ICONS, DEVICE_ICONS } from "@/components/library/device-badges";
import { DashboardBookmarkRow } from "./bookmark-row";
import { allBookmarksHref, deviceHref, liveHref, sessionsHref } from "./links";
import { openTabsInNewWindow } from "./open-tabs";

/**
 * "Continue where you left off" — the hero, and the whole reason the dashboard
 * exists (docs/features/dashboard.md §3.2: resume beats browse).
 *
 * The ranking is `rankContinueTargets` (lib/dashboard.ts, unit-tested); this
 * component only renders the winner richly plus at most ONE runner-up row, and
 * labels itself honestly — "Active now" vs "Earlier today on …" — because a card
 * that overstates freshness is worse than no card.
 *
 * Renders null with no targets (principle 3: no empty cards).
 */
export function ContinueCard({
  targets,
  className,
}: {
  targets: ContinueTarget[];
  className?: string;
}) {
  const [note, setNote] = useState<string | null>(null);
  const winner = targets[0];
  const second = targets[1];
  if (!winner) return null;
  // The ranking already de-dupes live devices, but a runner-up row repeating the
  // winner would be pure noise — never render one.
  const runnerUp = second && !sameTarget(winner, second) ? second : null;

  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm",
        className,
      )}
    >
      {/* Same header grammar as DashboardCard (icon + title) so the hero reads as
          one of the set rather than a differently-built box. */}
      <header className="flex items-center gap-2 px-4 py-3">
        <PlayCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight">Continue where you left off</h2>
      </header>
      <Winner target={winner} onNote={setNote} />
      {note && (
        <p className="border-t bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
          {note}
        </p>
      )}
      {runnerUp && <RunnerUp target={runnerUp} />}
    </section>
  );
}

function Winner({
  target,
  onNote,
}: {
  target: ContinueTarget;
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
    const active = target.label === "Active now";
    const windows = device.windows.length;
    return (
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div className="flex items-start gap-3">
          <span className="relative mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <DeviceIcon className="size-4 text-muted-foreground" aria-hidden />
            {active && (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-emerald-500 motion-safe:animate-pulse"
              />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="truncate font-semibold">{device.label || "This device"}</span>
              <span
                className={cn(
                  "shrink-0 text-xs font-medium",
                  active ? "text-emerald-600 dark:text-emerald-500" : "text-muted-foreground",
                )}
              >
                {target.label}
              </span>
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
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
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
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
        </div>
      </div>
    );
  }

  if (target.kind === "session") {
    const name = target.session?.name ?? "Last saved session";
    const tabCount = target.session?.tabCount ?? target.tabs.tabs.length;
    return (
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Layers className="size-4 text-muted-foreground" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="truncate font-semibold">{name}</span>
              <span className="shrink-0 text-xs font-medium text-muted-foreground">
                {target.label}
              </span>
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              <span className="tabular-nums">
                {tabCount} tab{tabCount === 1 ? "" : "s"}
              </span>{" "}
              — pick the whole window back up.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={busy || target.tabs.tabs.length === 0}
            onClick={() => void openAll(target.tabs.tabs.map((t) => t.url), name)}
          >
            <AppWindow aria-hidden />
            Open all in new window
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={sessionsHref()}>
              All sessions
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-1">
      <p className="px-4 pb-2 text-sm text-muted-foreground">
        {target.label} — pick up what you saved elsewhere.
      </p>
      <div className="divide-y border-t">
        {target.bookmarks.map((b) => (
          <DashboardBookmarkRow key={b.id} bookmark={b} />
        ))}
      </div>
    </div>
  );
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
 * saved session), so the runner-up row can be dropped. */
function sameTarget(a: ContinueTarget, b: ContinueTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "live" && b.kind === "live") return a.device.deviceId === b.device.deviceId;
  if (a.kind === "session" && b.kind === "session") return a.tabs.id === b.tabs.id;
  // The ranking produces at most one "bookmarks" target, so same kind = same row.
  return true;
}

/** The single allowed runner-up: one quiet line, one action. */
function RunnerUp({ target }: { target: ContinueTarget }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const label =
    target.kind === "live"
      ? `${target.device.label || "Device"} · ${target.device.tabCount} tabs`
      : target.kind === "session"
        ? (target.session?.name ?? "Last saved session")
        : target.label;

  const Icon = target.kind === "live" ? Radio : target.kind === "session" ? Layers : Globe;

  // The right-hand meta is the row's FRESHNESS, never a second copy of the label:
  // live/session labels already read as times ("Active now", "Saved 3h ago"), and
  // a bookmarks runner-up — whose label is the plain "Saved on another device" —
  // borrows the newest of those saves (the API returns them newest-first).
  const meta =
    target.kind === "bookmarks"
      ? relativeTime(target.bookmarks[0]?.source.savedAt ?? "")
      : target.label;

  return (
    <>
      <div className="flex items-center gap-2.5 border-t px-4 py-2.5 text-sm">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {meta && (
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{meta}</span>
        )}
        {target.kind === "live" ? (
          <Button asChild size="sm" variant="ghost" className="shrink-0">
            {/* "View", not "Open": this only navigates to the live view — the
                verbs that actually open tabs keep "Open …" (see sessions shelf). */}
            <Link href={liveHref()}>View</Link>
          </Button>
        ) : target.kind === "session" ? (
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0"
            disabled={busy || target.tabs.tabs.length === 0}
            onClick={() => {
              setBusy(true);
              void openTabsInNewWindow(
                target.tabs.tabs.map((t) => t.url),
                { name: target.session?.name },
              )
                .then(setNote)
                .finally(() => setBusy(false));
            }}
          >
            Open all
          </Button>
        ) : (
          <Button asChild size="sm" variant="ghost" className="shrink-0">
            {/* These are BOOKMARKS, so "View" goes to the library (narrowed to the
                device they came from when they all share one) — it used to point at
                Saved sessions, which is a different surface entirely. */}
            <Link href={otherDeviceBookmarksHref(target.bookmarks)}>View</Link>
          </Button>
        )}
      </div>
      {note && (
        <p className="border-t bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
          {note}
        </p>
      )}
    </>
  );
}
