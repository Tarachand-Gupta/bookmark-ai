import { Suspense } from "react";
import { DashboardPage } from "@/components/dashboard/dashboard-page";
import { DashboardCardSkeleton } from "@/components/dashboard/dashboard-card";
import { AppShellSkeleton } from "@/components/library/app-shell-skeleton";

/**
 * `/app` is the DASHBOARD — the landing page (docs/features/dashboard.md). The
 * library grid it used to render now lives at `/app/library` (see ./library/page.tsx).
 *
 * Back-compat: every legacy deep link into the library through bare `/app`
 * (`?q=`, `?category=`, `?section=live`, …) is redirected to `/app/library` WITH
 * its query intact by middleware.ts — see LEGACY_LIBRARY_PARAMS there. Nothing
 * that used to resolve stopped resolving. The one exception is `?settings=<id>`,
 * which THIS page handles itself (DashboardPage opens the Settings modal at that
 * section) so a settings deep link — the header avatar's "Manage account", the
 * extension's gear — no longer throws you onto the grid to get there.
 *
 * Both routes share this segment's layout, so the Ask AI dock mounted there stays
 * alive across Home ↔ Library navigation.
 *
 * The Suspense fallback is the app SHELL plus this page's own card grid — the
 * sidebar and top bar live inside DashboardPage, so an empty fallback blanked the
 * whole viewport while the boundary resolved (same fix as ./library/page.tsx).
 */
export default function AppPage() {
  return (
    <Suspense
      fallback={
        <AppShellSkeleton>
          {/* The omnibox strip, then the 2×2 card grid — the exact geometry
              DashboardPage paints, so the boundary resolving doesn't move
              anything sideways. Row heights follow the card ORDER: recent saves
              (5 rows), saved sessions, live now, activity. The install nudge
              gets no placeholder — it's a client-only decision that renders
              nothing until it settles, so a skeleton for it would promise a card
              that may never arrive. */}
          <div className="flex flex-col gap-4">
            <DashboardCardSkeleton rows={1} />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <DashboardCardSkeleton rows={5} />
              <DashboardCardSkeleton rows={4} />
              <DashboardCardSkeleton rows={4} />
              <DashboardCardSkeleton rows={4} />
            </div>
          </div>
        </AppShellSkeleton>
      }
    >
      <DashboardPage />
    </Suspense>
  );
}
