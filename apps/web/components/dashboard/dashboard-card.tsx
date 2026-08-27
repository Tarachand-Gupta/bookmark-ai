import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The ONE card chrome on the dashboard — solid border, rounded-xl, header with
 * an optional count and at most ONE header action.
 *
 * There is deliberately no dashed variant and no footer link any more. Dashed
 * chrome used to mark "this card goes away", which meant the page carried two
 * card languages at once; the one thing that still goes away (the setup strip)
 * sits below the grid where it can't be mistaken for a data card. The footer
 * link and the header action were also two ways to say "View all" — the header
 * one wins because it sits where a scanner's eye already is (next to the title),
 * and it keeps every card to a single navigational verb.
 *
 * Cards are data-in / actions-out (no page coupling) so they can be reused if
 * the New Tab Canvas ever ships — see docs/features/dashboard.md §5.
 */
export interface DashboardCardProps {
  title: string;
  Icon?: React.ElementType;
  /** Rendered next to the title as a muted tabular number. */
  count?: number | null;
  /** The card's single header action: a quiet "View all →" text link. */
  viewAllHref?: string;
  viewAllLabel?: string;
  /** Alternative to `viewAllHref` for a card that goes AWAY instead of leading
   * somewhere — in practice the shared `DismissButton` on the install nudge.
   * Still one header action: pass one or the other, never both. */
  headerAction?: React.ReactNode;
  className?: string;
  /** Removes the body padding, for cards whose children are full-bleed rows. */
  flush?: boolean;
  children: React.ReactNode;
}

export function DashboardCard({
  title,
  Icon,
  count,
  viewAllHref,
  viewAllLabel = "View all",
  headerAction,
  className,
  flush,
  children,
}: DashboardCardProps) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-xl border bg-card text-card-foreground shadow-sm",
        className,
      )}
    >
      <header className="flex items-center gap-2 px-4 py-3">
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <h2 className="min-w-0 truncate text-base font-semibold tracking-tight">{title}</h2>
        {count != null && (
          <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{count}</span>
        )}
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {viewAllLabel}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
        {!viewAllHref && headerAction && <span className="ml-auto shrink-0">{headerAction}</span>}
      </header>
      <div className={cn("min-w-0 flex-1", flush ? "border-t" : "px-4 pb-4")}>{children}</div>
    </section>
  );
}

/**
 * A card's empty body: one quiet sentence, never a call to action.
 *
 * The grid is FIXED at four cards (see dashboard-page), so a card with no data
 * still has to render something — and the thing it renders must not compete with
 * the cards that do have data. Whatever the user would have to do about it lives
 * in the setup strip below the grid, once, instead of in four different boxes.
 */
export function DashboardCardEmpty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-sm text-muted-foreground">{children}</p>;
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
            <Skeleton className="size-4 shrink-0 rounded-md" />
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
