import { Suspense } from "react";
import { LibraryPage } from "@/components/library/library-page";
import { AppShellSkeleton, BookmarkGridSkeleton } from "@/components/library/app-shell-skeleton";

/**
 * The library grid — everything that used to live at bare `/app` (the dashboard
 * took that route over; see ../page.tsx).
 *
 * All library navigation is pathname-relative (usePathname() + shallow
 * history.pushState), so filters, search params, `?section=sessions|live`,
 * `?ai=1` and `?settings=…` deep-links work here unchanged, and legacy `/app?…`
 * links are redirected here query-intact by middleware.ts.
 *
 * The Suspense fallback is the whole app SHELL, not nothing: LibraryPage owns the
 * sidebar and the top bar, so an empty fallback blanked the entire viewport for
 * the few hundred ms a Home → Library hop takes to resolve this boundary.
 */
export default function LibraryRoutePage() {
  return (
    <Suspense
      fallback={
        <AppShellSkeleton>
          {/* Reserves the tag-rail / view-toggle row's height so the grid doesn't
              jump up a line when the real page takes over. */}
          <div className="mb-4 h-9" aria-hidden />
          <BookmarkGridSkeleton />
        </AppShellSkeleton>
      }
    >
      <LibraryPage />
    </Suspense>
  );
}
