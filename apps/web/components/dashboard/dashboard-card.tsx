import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The one card chrome every dashboard card wears — bordered surface, header with
 * an optional count, optional footer link. Same visual language as the library's
 * session cards and the settings panels (rounded-xl border bg-card shadow-sm), so
 * the landing page reads as part of the same app.
 *
 * Cards are data-in / actions-out (no page coupling) so they can be reused if the
 * New Tab Canvas ever ships — see docs/features/dashboard.md §5.
 */
export interface DashboardCardProps {
  title: string;
  Icon?: React.ElementType;
  /** Rendered next to the title as a muted tabular number. */
  count?: number | null;
  /** Top-right affordance (usually a small action button). */
  action?: React.ReactNode;
  /** Footer link — "All bookmarks →". */
  footerHref?: string;
  footerLabel?: string;
  className?: string;
  /** Removes the body padding, for cards whose children are full-bleed rows. */
  flush?: boolean;
  children: React.ReactNode;
}

export function DashboardCard({
  title,
  Icon,
  count,
  action,
  footerHref,
  footerLabel,
  className,
  flush,
  children,
}: DashboardCardProps) {
  return (
    <section
      className={cn("flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm", className)}
    >
      <header className="flex items-center gap-2 px-4 py-3">
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <h2 className="min-w-0 truncate text-sm font-semibold tracking-tight">{title}</h2>
        {count != null && (
          <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{count}</span>
        )}
        {action && <div className="ml-auto flex shrink-0 items-center gap-1.5">{action}</div>}
      </header>
      <div className={cn("min-w-0 flex-1", flush ? "border-t" : "px-4 pb-4")}>{children}</div>
      {footerHref && (
        <Link
          href={footerHref}
          className="flex items-center gap-1 border-t px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {footerLabel ?? "View all"}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </section>
  );
}

/**
 * Fixed-height placeholder so the grid never jumps when the real card lands
 * (principle 4). `rows` approximates the card's content height rather than
 * pretending to know it exactly.
 */
export function DashboardCardSkeleton({
  rows = 4,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border bg-card p-4 shadow-sm", className)}>
      <Skeleton className="h-4 w-32" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-4 shrink-0 rounded-sm" />
            <Skeleton className="h-3.5 flex-1" style={{ maxWidth: SKELETON_WIDTHS[i % 4] }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Fixed (not random) widths — these render on the server too, and Math.random()
 * per render is a hydration mismatch (see app-sidebar's FacetSkeleton). */
const SKELETON_WIDTHS = ["78%", "56%", "88%", "64%"];
