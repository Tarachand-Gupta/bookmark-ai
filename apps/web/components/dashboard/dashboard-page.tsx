"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { NoAccessNotice } from "@/components/no-access-notice";
import { AccountSetup } from "@/components/library/account-setup";
import { AddBookmarkDialog } from "@/components/library/add-bookmark-dialog";
import { AppSidebar } from "@/components/library/app-sidebar";
import { FirstRunPanel } from "@/components/library/first-run-panel";
import { LibraryHeader } from "@/components/library/library-header";
import {
  SECTION_IDS,
  SettingsDialog,
  type SectionId,
} from "@/components/library/settings-dialog";
import { useMeta, useRefresh } from "@/hooks/use-library";
import { useLiveDevices } from "@/hooks/use-live";
import { useDashboard } from "@/hooks/use-dashboard";
import { hasDashboardActivity, rankLiveDevices } from "@/lib/dashboard";
import type { LibraryFilters } from "@/lib/api";
import { ActivityCard } from "./activity-card";
import { DashboardCardSkeleton } from "./dashboard-card";
import { InstallCard } from "./install-card";
import { LiveNowCard } from "./live-now-card";
import { Omnibox } from "./omnibox";
import { RecentSavesCard } from "./recent-saves-card";
import { SavedSessionsCard } from "./saved-sessions-card";
import { SetupStrip } from "./setup-strip";
import { LIBRARY_PATH } from "./links";

/**
 * The dashboard — what `/app` lands on (docs/features/dashboard.md). The library
 * grid moved to `/app/library`; every legacy `/app?…` deep link is redirected
 * there by middleware, so nothing that used to work stopped working.
 *
 * Shape of the page, top to bottom:
 *
 *   Omnibox                       ← full width, the universal entry
 *   ┌ Recent saves ──┬ Saved sessions ┐
 *   ├ Live now ──────┼ Activity* ─────┤   ← ONE 2-column grid, equal halves
 *   └ Install nudge* ┴                ┘   ← * conditional, see below
 *   Setup strip                   ← full width, disappears for good when done
 *
 * THREE first-class nouns (all bookmarks, saved sessions, live sessions) plus
 * one awareness card, each a single noun with a single shape: a header with one
 * "View all →" link, then 3-5 uniform rows where the ROW is the click target.
 * That replaces the old asymmetric 7/5 grid whose column spans changed with the
 * data, and the "Continue where you left off" hero that mixed live devices,
 * saved sessions and cross-device bookmarks into one ranked list with two or
 * three buttons per row.
 *
 * Two invariants worth keeping:
 *  - CARDS NEVER RE-SPAN. Two equal columns, no col-spans, no geometry that
 *    depends on what came back; the cards that stay put say one quiet sentence
 *    when they're empty. A layout that reflows around missing data is a layout
 *    nobody can learn.
 *    Two cards may be ABSENT rather than empty, and both are deliberate
 *    exceptions Tara asked for (2026-08-27, recorded in the doc): Activity, for
 *    which an empty sparkline is worse than no sparkline, and the install nudge,
 *    which is a nudge and has nothing to say once you've acted on it. Absent
 *    cards just leave the last cell empty — nothing stretches to fill it.
 *  - nothing here renders an error card. A failed revalidate keeps the snapshot
 *    on screen; a dead live server simply shows the live card's empty state.
 */
export function DashboardPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, isLoaded } = useUser();
  const [refreshKey, refresh] = useRefresh();
  const meta = useMeta(refreshKey);

  // Snapshot namespace: the Clerk user id once known ("anon" in keyless
  // self-host mode, which has exactly one user). null until Clerk resolves, so
  // the fetch happens ONCE, under the right key.
  const dashboard = useDashboard(isLoaded ? (user?.id ?? "anon") : null);
  // The same SSE stream the live view uses, so the Live now card updates itself
  // after paint without another dashboard fetch.
  const live = useLiveDevices({ fast: false });

  const [addOpen, setAddOpen] = useState(false);
  const [settings, setSettings] = useState<{ open: boolean; section: SectionId }>({
    open: false,
    section: "ai",
  });
  const openSettings = useCallback((section: SectionId = "ai") => {
    setSettings({ open: true, section });
  }, []);

  // Deep link: /app?settings=<sectionId> opens Settings at that section. The
  // library has always honoured it (the extension's gear, the MCP promo); the
  // header avatar's "Manage account" now navigates to it too, and the dashboard
  // is where that lands from Home — so it needs the exact same handling. Unknown
  // values fall back to the dialog's default section, and the ref keeps an
  // unrelated param change from yanking the user off a section they navigated to
  // inside the dialog.
  const handledSettingsParam = useRef<string | null>(null);
  useEffect(() => {
    const param = searchParams.get("settings");
    if (!param) {
      handledSettingsParam.current = null;
      return;
    }
    if (param === handledSettingsParam.current) return;
    handledSettingsParam.current = param;
    openSettings(SECTION_IDS.includes(param as SectionId) ? (param as SectionId) : undefined);
  }, [searchParams, openSettings]);

  // Strip the ?settings param (preserving the rest) when the dialog closes, so
  // the deep-linked URL doesn't linger and re-open on the next param change.
  // Pure URL cleanup — no server data changes, so replace it shallowly via the
  // History API (an RSC round-trip here would re-fetch the whole dashboard).
  const clearSettingsParam = useCallback(() => {
    if (!searchParams.get("settings")) return;
    const params = new URLSearchParams(searchParams);
    params.delete("settings");
    window.history.replaceState(null, "", params.size ? `${pathname}?${params}` : pathname);
  }, [pathname, searchParams]);

  // The library is one click away from every card — warm it once so the jump is
  // instant instead of paying for the route's first RSC fetch on click.
  useEffect(() => {
    router.prefetch(LIBRARY_PATH);
  }, [router]);

  // Sidebar navigation from the dashboard: all of it goes to the library route
  // (client-side push, the /app layout and its chat dock stay mounted).
  const goToLibrary = useCallback(
    (search?: string) => router.push(search ? `${LIBRARY_PATH}?${search}` : LIBRARY_PATH),
    [router],
  );
  const onFilterChange = useCallback(
    (filters: LibraryFilters) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, value);
      }
      goToLibrary(params.toString());
    },
    [goToLibrary],
  );

  const data = dashboard.data;
  // `null` (live off / unreachable) and `[]` (on, nobody home) are DIFFERENT
  // sentences in the card — keep them distinct all the way down.
  const liveDevices = useMemo(
    () => (live.data?.enabled ? rankLiveDevices(live.data.devices) : null),
    [live.data],
  );

  // First paint with nothing cached: skeletons, not an empty page.
  const showSkeletons = !data && dashboard.loading;
  const firstRun = !!data && data.totalBookmarks === 0 && data.totalSessions === 0;

  return (
    <SidebarProvider>
      <AppSidebar
        meta={meta.data}
        metaLoading={meta.loading}
        aiEnabled={null}
        filters={{}}
        onFilterChange={onFilterChange}
        homeActive
        onShowHome={() => {}}
        sessionCount={data?.totalSessions ?? null}
        sessionsLoading={dashboard.loading}
        onShowSessions={() => goToLibrary("section=sessions")}
        onShowLive={() => goToLibrary("section=live")}
        onAdd={() => setAddOpen(true)}
        onOpenSettings={openSettings}
      />
      <SidebarInset>
        {/* Same header as the library, minus the search box — search lives in the
            omnibox here (passing no query handlers hides that block). */}
        <LibraryHeader title="Home" />
        <div
          className="flex min-w-0 flex-1 items-stretch"
          style={{ paddingRight: "var(--chat-dock-w, 0px)" }}
        >
          <main className="min-w-0 flex-1 p-3 sm:p-4">
            <div className="mx-auto w-full max-w-7xl">
              {/* every hook hits the same API — any of them reporting it means
                  the account isn't ready (mirrors LibraryPage's `settingUp`) */}
              {dashboard.provisioning || meta.provisioning ? (
                <AccountSetup />
              ) : dashboard.forbidden ? (
                <NoAccessNotice />
              ) : (
                <div className="flex flex-col gap-4">
                  <Omnibox />

                  {showSkeletons ? (
                    // Same geometry as the real thing, so nothing jumps sideways
                    // when the data lands (principle 4).
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <DashboardCardSkeleton rows={5} />
                      <DashboardCardSkeleton rows={4} />
                      <DashboardCardSkeleton rows={4} />
                      <DashboardCardSkeleton rows={4} />
                    </div>
                  ) : (
                    data &&
                    // An account with literally nothing in it gets the library's
                    // own teaching panel INSTEAD of the grid: four empty cards
                    // saying "nothing yet" four different ways is worse than one
                    // panel that says what to do first.
                    (firstRun ? (
                      <FirstRunPanel onAdd={() => setAddOpen(true)} />
                    ) : (
                      <>
                        {/* TWO EQUAL COLUMNS. Reading order IS the hierarchy —
                            recent saves, saved sessions, live now, activity —
                            and it's the same order when this stacks to one
                            column on a phone. No col-spans, no
                            content-dependent widths.
                            The last two children are conditional (see the file
                            header): they either occupy the next cell or they
                            don't exist, which is a flow decision, never a span
                            one. With both gone the grid is three cards and the
                            bottom-right cell is simply empty. */}
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                          <RecentSavesCard
                            bookmarks={data.recentBookmarks}
                            otherDeviceBookmarks={data.otherDeviceBookmarks}
                            total={data.totalBookmarks}
                          />
                          <SavedSessionsCard
                            sessions={data.recentSessions}
                            total={data.totalSessions}
                            lastSessionTabs={data.lastSessionTabs}
                          />
                          <LiveNowCard devices={liveDevices} />
                          {hasDashboardActivity(data.activity) && (
                            <ActivityCard activity={data.activity} />
                          )}
                          <InstallCard />
                        </div>
                        {/* Below the grid, not above it: setup is temporary, the
                            cards are the page. Renders nothing once every step
                            is done or the strip is dismissed — and it no longer
                            carries the "install the extension" step at all, the
                            install card above owns that job. */}
                        <SetupStrip
                          totalBookmarks={data.totalBookmarks}
                          liveEnabled={live.data ? live.data.enabled : null}
                          onAdd={() => setAddOpen(true)}
                          onOpenSettings={openSettings}
                        />
                      </>
                    ))
                  )}
                </div>
              )}
            </div>
          </main>
        </div>
      </SidebarInset>
      <AddBookmarkDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={() => {
          refresh();
          dashboard.refresh();
        }}
      />
      <SettingsDialog
        open={settings.open}
        initialSection={settings.section}
        onOpenChange={(open) => {
          setSettings((s) => ({ ...s, open }));
          if (!open) clearSettingsParam();
        }}
      />
    </SidebarProvider>
  );
}
