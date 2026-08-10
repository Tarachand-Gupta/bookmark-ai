import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The signed-in app shell (sidebar column + top bar + content slot) as a static
 * placeholder, used as the Suspense fallback for BOTH /app routes.
 *
 * Why it exists: `SidebarProvider`/`AppSidebar` live INSIDE the page components
 * (DashboardPage, LibraryPage), so a page-level Suspense boundary with no
 * fallback blanked the entire viewport — chrome included — for the ~300-450ms a
 * Home ↔ Library hop takes to resolve that boundary. A shell-shaped fallback
 * keeps the layout on screen and turns a flash of nothing into a normal load.
 *
 * Deliberately plain markup: everything here must be renderable by the SERVER
 * component that passes it as a fallback, and must not pull in the very client
 * chunk whose arrival the boundary is waiting on. So no Sidebar/Header
 * components, only the (client-free) `Skeleton` primitive, with the shell's
 * dimensions mirrored by hand — 16rem sidebar (SIDEBAR_WIDTH in ui/sidebar),
 * `min-h-svh` wrapper, the header's `px-3 py-2.5 sm:px-4`, and main's
 * `p-3 sm:p-4` + `max-w-7xl` cap. Keep them in sync if the shell moves.
 */
export function AppShellSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-label="Loading" className="flex min-h-svh w-full">
      <div
        aria-hidden
        className="hidden w-64 shrink-0 flex-col gap-6 border-r bg-sidebar p-2 md:flex"
      >
        <div className="flex items-center gap-2 p-2">
          <Skeleton className="size-6 rounded-md" />
          <Skeleton className="h-4 w-28" />
        </div>
        {[3, 6, 4].map((rows, group) => (
          <div key={group} className="flex flex-col gap-2 px-2">
            <Skeleton className="h-3 w-20" />
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="flex items-center gap-2 py-1">
                <Skeleton className="size-4 shrink-0 rounded-sm" />
                <Skeleton className="h-3.5 flex-1" style={{ maxWidth: ROW_WIDTHS[i % 4] }} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          aria-hidden
          className="flex items-center gap-2 border-b px-3 py-2.5 sm:px-4"
        >
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="h-4 w-24" />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="hidden h-9 w-80 rounded-md sm:block" />
            <Skeleton className="size-8 rounded-full" />
          </div>
        </div>
        <main className="min-w-0 flex-1 p-3 sm:p-4">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** Fixed (not random) widths — this renders on the server too, and Math.random()
 * per render is a hydration mismatch (same reason as DashboardCardSkeleton's). */
const ROW_WIDTHS = ["78%", "56%", "88%", "64%"];

/**
 * Card placeholders in the library's grid layout — same columns and same
 * image/title/meta stack as BookmarkGrid's own loading state, redrawn here for the
 * server-renderable reason above (that grid is a client module).
 */
export function BookmarkGridSkeleton({
  count = 8,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4",
        className,
      )}
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="aspect-[1.91/1] w-full rounded-xl" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}
