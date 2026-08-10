"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { NoAccessNotice } from "@/components/no-access-notice";
import { AccountSetup } from "@/components/library/account-setup";
import { AddBookmarkDialog } from "@/components/library/add-bookmark-dialog";
import { AppSidebar } from "@/components/library/app-sidebar";
import { FirstRunPanel } from "@/components/library/first-run-panel";
import { LibraryHeader } from "@/components/library/library-header";
import { SettingsDialog, type SectionId } from "@/components/library/settings-dialog";
import { useMeta, useRefresh } from "@/hooks/use-library";
import { useLiveDevices } from "@/hooks/use-live";
import { useDashboard } from "@/hooks/use-dashboard";
import { rankContinueTargets } from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import type { LibraryFilters } from "@/lib/api";
import { ActivityCard } from "./activity-card";
import { ContinueCard } from "./continue-card";
import { DashboardCardSkeleton } from "./dashboard-card";
import { McpPromoCard, useMcpPromo } from "./mcp-promo-card";
import { Omnibox } from "./omnibox";
import { ReadingQueueCard } from "./reading-queue-card";
import { RecentSavesCard } from "./recent-saves-card";
import { SessionsShelf } from "./sessions-shelf";
import { SetupCard } from "./setup-card";
import { LIBRARY_PATH } from "./links";

/**
 * The dashboard — what `/app` now lands on (docs/features/dashboard.md). The
 * library grid moved to `/app/library`; every legacy `/app?…` deep link is
 * redirected there by middleware, so nothing that used to work stopped working.
 *
 * Shape of the page: ONE aggregated fetch (`useDashboard`, stale-while-revalidate
 * from a localStorage snapshot) for everything that lives in this account's DB,
 * plus the existing live SSE hook layered on top for "right now" state — the live
 * server is a different origin, so /api/dashboard can't speak for it.
 *
 * Two invariants worth keeping:
 *  - every card renders null when it has no data (no hollow boxes), so a fresh
 *    account sees the omnibox, the first-run panel and the setup card only;
 *  - nothing here renders an error card. A failed revalidate keeps the snapshot
 *    on screen; a dead live server simply omits its card.
 */
export function DashboardPage() {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const [refreshKey, refresh] = useRefresh();
  const meta = useMeta(refreshKey);

  // Snapshot namespace: the Clerk user id once known ("anon" in keyless
  // self-host mode, which has exactly one user). null until Clerk resolves, so
  // the fetch happens ONCE, under the right key.
  const dashboard = useDashboard(isLoaded ? (user?.id ?? "anon") : null);
  // The same SSE stream the live view uses, so the hero's live rows update
  // themselves after paint without another dashboard fetch.
  const live = useLiveDevices({ fast: false });
  // One cheap GET, off the aggregator's critical path (see useMcpPromo). Read
  // here rather than inside the card because the grid needs to know whether the
  // side column has anything in it at all.
  const mcpPromo = useMcpPromo();

  const [addOpen, setAddOpen] = useState(false);
  const [settings, setSettings] = useState<{ open: boolean; section: SectionId }>({
    open: false,
    section: "ai",
  });
  const openSettings = useCallback((section: SectionId = "ai") => {
    setSettings({ open: true, section });
  }, []);

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
  const liveDevices = live.data?.enabled ? live.data.devices : null;

  const continueTargets = useMemo(
    () =>
      data
        ? rankContinueTargets({
            liveDevices,
            lastSessionTabs: data.lastSessionTabs,
            recentSessions: data.recentSessions,
            otherDeviceBookmarks: data.otherDeviceBookmarks,
          })
        : [],
    [data, liveDevices],
  );

  // First paint with nothing cached: skeletons, not an empty page.
  const showSkeletons = !data && dashboard.loading;
  const firstRun = !!data && data.totalBookmarks === 0 && data.totalSessions === 0;
  // "Connect an agent to your library" is a pitch that needs a library — an
  // account with nothing in it gets the first-run panel's one job instead.
  const showMcpPromo = mcpPromo.show && !firstRun;

  // Every card renders null when it has no data (principle 3), and a null card
  // inside a 12-column grid used to leave a hole its neighbours couldn't fill —
  // the "empty area between cards" the owner saw. The layout is therefore TWO
  // flex columns (below), and each column's span is decided from whether it has
  // any content: an empty side column hands its 5 columns back to the main one
  // instead of leaving them blank. Conditions mirror each card's own empty rule.
  const mainHasCards =
    !!data && (continueTargets.length > 0 || data.recentBookmarks.length > 0);
  const sideHasCards =
    !!data &&
    (!!data.activity ||
      data.readingQueue.items.length > 0 ||
      data.recentSessions.length > 0 ||
      showMcpPromo);
  const mainSpan = sideHasCards ? "lg:col-span-7" : "lg:col-span-12";
  const sideSpan = mainHasCards ? "lg:col-span-5" : "lg:col-span-12";

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
              {dashboard.provisioning ? (
                <AccountSetup />
              ) : dashboard.forbidden ? (
                <NoAccessNotice />
              ) : (
                /* Two COLUMNS, not a masonry of independently-spanning cards.
                   Cards used to be placed straight into a 12-column grid, where
                   each grid row is as tall as its tallest member and the shorter
                   partner either stretched (dead space above its footer) or left
                   a gap under itself. Columns of their own — each a flex stack
                   with its own gap — end where their content ends, independently.
                   items-start keeps a column from being stretched to its
                   sibling's height. Below lg it's ONE column: at md the content
                   area is only ~510px next to the sidebar, and a 7/5 split there
                   made two cramped 250px columns. */
                <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
                  <Omnibox className="lg:col-span-12" />

                  {showSkeletons ? (
                    // Same two-column geometry as the real thing, so nothing
                    // jumps sideways when the data lands (principle 4).
                    <>
                      <div className="flex min-w-0 flex-col gap-4 lg:col-span-7">
                        <DashboardCardSkeleton rows={5} />
                        <DashboardCardSkeleton rows={6} />
                      </div>
                      <div className="flex min-w-0 flex-col gap-4 lg:col-span-5">
                        <DashboardCardSkeleton rows={4} />
                        <DashboardCardSkeleton rows={3} />
                        <DashboardCardSkeleton rows={3} />
                      </div>
                    </>
                  ) : (
                    data && (
                      <>
                        {/* Unfinished setup leads the page, right under the
                            omnibox — at the bottom it was the last thing anyone
                            saw (owner feedback), and a setup task is exactly
                            what a half-configured account should act on first.
                            (On firstRun the FirstRunPanel below owns this job —
                            see the comment there.) */}
                        {!firstRun && (
                          <SetupCard
                            totalBookmarks={data.totalBookmarks}
                            liveEnabled={live.data ? live.data.enabled : null}
                            onAdd={() => setAddOpen(true)}
                            onOpenSettings={openSettings}
                            className="lg:col-span-12"
                          />
                        )}
                        {/* Left: the two cards that want width — the resume hero
                            (rich rows with tab previews) and what just landed. */}
                        {mainHasCards && (
                          <div className={cn("flex min-w-0 flex-col gap-4", mainSpan)}>
                            <ContinueCard
                              targets={continueTargets}
                              liveDeviceCount={liveDevices?.length ?? 0}
                            />
                            <RecentSavesCard bookmarks={data.recentBookmarks} />
                          </div>
                        )}
                        {/* Right: awareness, then the two shelves. Activity leads
                            it — that's the slot the old Live now card held, and
                            Activity used to sit two rows lower where nobody
                            scrolled. Splitting 2 wide cards / 3 rail cards is
                            also what keeps the columns ENDING near each other:
                            three tall cards on the left left ~400px of nothing
                            beside them. */}
                        {sideHasCards && (
                          <div className={cn("flex min-w-0 flex-col gap-4", sideSpan)}>
                            <ActivityCard activity={data.activity} />
                            <ReadingQueueCard queue={data.readingQueue} />
                            <SessionsShelf
                              sessions={data.recentSessions}
                              total={data.totalSessions}
                              lastSessionTabs={data.lastSessionTabs}
                            />
                            {showMcpPromo && (
                              <McpPromoCard
                                onDismiss={mcpPromo.dismiss}
                                onOpenSettings={openSettings}
                              />
                            )}
                          </div>
                        )}
                        {/* On a genuinely empty account, SetupCard (rendered up
                            top, under the omnibox) and FirstRunPanel would
                            duplicate each other's steps — FirstRunPanel is the
                            richer teaching surface, so firstRun suppresses the
                            SetupCard (see the comment at the top of this
                            fragment). A genuinely empty account gets the library's own
                            first-run teaching panel folded in (doc §6) rather
                            than a screen of nothing under the omnibox. */}
                        {firstRun && (
                          <div className="lg:col-span-12">
                            <FirstRunPanel onAdd={() => setAddOpen(true)} />
                          </div>
                        )}
                      </>
                    )
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
        onOpenChange={(open) => setSettings((s) => ({ ...s, open }))}
      />
    </SidebarProvider>
  );
}
