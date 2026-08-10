"use client";

import { useState } from "react";
import Link from "next/link";
import type { DashboardLastSession, SessionSummary } from "@bookmark-ai/types";
import { AppWindow, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/dashboard";
import { FEATURE_ICONS } from "@/components/library/feature-icons";
import { SessionIdentity } from "@/components/library/device-badges";
import { DashboardCard } from "./dashboard-card";
import { sessionsHref } from "./links";
import { openTabsInNewWindow } from "./open-tabs";

/**
 * Sessions shelf (doc §3.6): the 3-4 newest saved sessions as rows with their
 * device/browser badges.
 *
 * "Open all" is offered for the TOP row only — that's the only session whose tabs
 * this endpoint returns (`lastSessionTabs`), and shipping a button that needs an
 * extra round-trip per row would trade the page's one-fetch promise for a feature
 * the sessions view already does better. Every other row links there.
 */
/** One footprint for both row affordances (the top row's "Open all" button and
 * every other row's "View" link) so the action column has ONE right edge instead
 * of a ragged one. */
const ROW_ACTION = "min-w-[6.5rem] shrink-0 justify-center";

export function SessionsShelf({
  sessions,
  total,
  lastSessionTabs,
  className,
}: {
  sessions: SessionSummary[];
  total: number;
  lastSessionTabs: DashboardLastSession | null;
  className?: string;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (sessions.length === 0) return null;

  const openTop = async (session: SessionSummary, tabs: DashboardLastSession) => {
    setBusy(true);
    setNote(null);
    try {
      setNote(await openTabsInNewWindow(tabs.tabs.map((t) => t.url), { name: session.name }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DashboardCard
      title="Saved sessions"
      Icon={FEATURE_ICONS.sessions}
      count={total}
      footerHref={sessionsHref()}
      footerLabel="All sessions"
      className={className}
      flush
    >
      {note && (
        <p className="bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
          {note}
        </p>
      )}
      <ul className="divide-y">
        {sessions.map((session) => {
          const openable =
            lastSessionTabs && lastSessionTabs.id === session.id && lastSessionTabs.tabs.length > 0
              ? lastSessionTabs
              : null;
          return (
            <li key={session.id} className="flex items-center gap-2.5 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <Link
                  href={sessionsHref()}
                  className="line-clamp-1 text-sm font-medium hover:underline"
                >
                  {session.name}
                </Link>
                {/* The AI's read of the session, one quiet truncated line — the
                    shelf is a scan surface, so it never wraps to a second line.
                    Same sparkle vocabulary as the sessions view's summary strip. */}
                {session.description && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground/90">
                    <Sparkles className="size-3 shrink-0 text-muted-foreground/70" aria-hidden />
                    <span className="line-clamp-1">
                      <span className="sr-only">AI summary: </span>
                      {session.description}
                    </span>
                  </p>
                )}
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {session.tabCount} tab{session.tabCount === 1 ? "" : "s"}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{relativeTime(session.savedAt)}</span>
                  <SessionIdentity
                    os={session.os}
                    browser={session.browser}
                    device={session.device}
                  />
                </div>
              </div>
              {openable ? (
                <Button
                  size="sm"
                  variant="outline"
                  className={ROW_ACTION}
                  disabled={busy}
                  onClick={() => void openTop(session, openable)}
                >
                  <AppWindow aria-hidden />
                  <span className="hidden sm:inline">Open all</span>
                  <span className="sm:hidden">Open</span>
                </Button>
              ) : (
                // "View", not "Open": this one only navigates to the sessions
                // section — it does NOT open the tabs (only the top row's tabs come
                // back from /api/dashboard). Two rows promising the same verb and
                // doing different things is the confusion QA caught.
                <Button asChild size="sm" variant="ghost" className={ROW_ACTION}>
                  <Link href={sessionsHref()}>View</Link>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </DashboardCard>
  );
}
