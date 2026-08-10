import { Suspense } from "react";
import { DashboardPage } from "@/components/dashboard/dashboard-page";
import { DashboardCardSkeleton } from "@/components/dashboard/dashboard-card";
import { AppShellSkeleton } from "@/components/library/app-shell-skeleton";

/**
 * `/app` is the DASHBOARD — the landing page (docs/features/dashboard.md). The
 * library grid it used to render now lives at `/app/library` (see ./library/page.tsx).
 *
 * Back-compat: every legacy deep link into the library through bare `/app`
 * (`?q=`, `?category=`, `?section=live`, `?settings=devices`, …) is redirected to
 * `/app/library` WITH its query intact by middleware.ts — see
 * LEGACY_LIBRARY_PARAMS there. Nothing that used to resolve stopped resolving.
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12">
            <DashboardCardSkeleton rows={1} className="md:col-span-2 lg:col-span-12" />
            <DashboardCardSkeleton rows={2} className="md:col-span-2 lg:col-span-8" />
            <DashboardCardSkeleton rows={2} className="md:col-span-2 lg:col-span-4" />
            <DashboardCardSkeleton rows={6} className="md:col-span-2 lg:col-span-8" />
            <DashboardCardSkeleton rows={4} className="md:col-span-1 lg:col-span-4" />
            <DashboardCardSkeleton rows={3} className="md:col-span-1 lg:col-span-6" />
            <DashboardCardSkeleton rows={3} className="md:col-span-1 lg:col-span-6" />
          </div>
        </AppShellSkeleton>
      }
    >
      <DashboardPage />
    </Suspense>
  );
}
