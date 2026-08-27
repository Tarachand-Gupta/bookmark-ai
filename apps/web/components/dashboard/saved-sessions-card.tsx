"use client";

import { useState } from "react";
import Link from "next/link";
import type { DashboardLastSession, SessionSummary } from "@bookmark-ai/types";
import { AppWindow, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/dashboard";
import { SessionIdentity } from "@/components/library/device-badges";
import { FEATURE_ICONS } from "@/components/library/feature-icons";
import { DashboardCard, DashboardCardEmpty } from "./dashboard-card";
import { sessionsHref } from "./links";
import { openTabsInNewWindow } from "./open-tabs";

/**
 * Saved sessions — the dashboard's second first-class noun.
 *
 * This card leads with the most recent session, which is the job the old
 * "Continue where you left off" hero was doing for saved windows before it got
 * mixed in with live devices and cross-device bookmarks.
 *
 * Rows are uniform: name, tab count, when, and the device badge. The AI's
 * session description is deliberately NOT here — it wrapped rows to different
 * heights, which is the one thing a scan surface can't afford. It's on the
 * sessions view, one click away.
 *
 * "Open all in new window" is offered for the TOP row only, and only when that
 * session's tabs actually came back in this payload (`lastSessionTabs`) — it's
 * the card's single inline action. Every other row just navigates.
 */

/** Rows before "View all" takes over — the endpoint returns four. */
const VISIBLE_SESSIONS = 4;

export function SavedSessionsCard({
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
  const rows = sessions.slice(0, VISIBLE_SESSIONS);
  // Only the top row, and only when its tabs are in hand (see the doc comment).
  const openable =
    rows[0] && lastSessionTabs?.id === rows[0].id && lastSessionTabs.tabs.length > 0
      ? lastSessionTabs
      : null;

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
      count={total || null}
      viewAllHref={sessionsHref()}
      className={className}
      flush
    >
      {rows.length === 0 ? (
        <DashboardCardEmpty>
          No saved sessions yet — the extension can snapshot a whole window of tabs.
        </DashboardCardEmpty>
      ) : (
        <>
          {/* Result of an "Open all" (pop-up blocker, cap reached). Muted, not
              amber: this is an outcome, not a warning, and the page has exactly
              one notice treatment. */}
          {note && (
            <p className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">{note}</p>
          )}
          <ul className="divide-y">
            {rows.map((session) => {
              const canOpen = openable && session.id === rows[0].id ? openable : null;
              return (
                <li key={session.id} className="flex min-w-0 items-center">
                  <Link
                    href={sessionsHref()}
                    className="group flex min-w-0 flex-1 items-center gap-2.5 py-2.5 pl-4 pr-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-sm font-medium">{session.name}</span>
                      <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="shrink-0 tabular-nums">
                          {session.tabCount} tab{session.tabCount === 1 ? "" : "s"}
                        </span>
                        <span aria-hidden>·</span>
                        <time dateTime={session.savedAt} className="shrink-0">
                          {relativeTime(session.savedAt)}
                        </time>
                        <SessionIdentity
                          os={session.os}
                          browser={session.browser}
                          device={session.device}
                        />
                      </span>
                    </span>
                    {/* One glyph per right edge: rows without the button get the
                        chevron, the row WITH it doesn't need a second hint. */}
                    {!canOpen && (
                      <ChevronRight
                        className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground"
                        aria-hidden
                      />
                    )}
                  </Link>
                  {canOpen && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mr-4 shrink-0"
                      disabled={busy}
                      title="Open all of this session's tabs in a new window"
                      onClick={() => void openTop(session, canOpen)}
                    >
                      <AppWindow aria-hidden />
                      Open all
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </DashboardCard>
  );
}
