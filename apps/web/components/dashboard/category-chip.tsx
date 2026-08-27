import Link from "next/link";
import { Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import { categoryHref } from "./links";

/**
 * The dashboard's ONE category chip — a muted fill, never a border (nothing on
 * this page nests a bordered box inside a bordered card).
 *
 * Two near-identical chips used to exist: a clickable one in the bookmark row
 * and a differently-padded one in Activity. This is both, and the difference is
 * a prop:
 *
 *  - Recent-saves rows are anchors to the bookmark itself, and an anchor inside
 *    an anchor is invalid HTML (plus a second tab stop per row), so the chip
 *    there is INERT — it labels the row, it isn't a second thing to click.
 *  - Activity's top-3 chips stand on their own, so those link to the filtered
 *    library and are the only interactive thing in that card.
 */
export function CategoryChip({
  category,
  count,
  interactive,
  className,
}: {
  category: string;
  /** Rendered as a trailing tabular number (Activity's facet counts). */
  count?: number;
  /** Link to the filtered library instead of rendering inert text. */
  interactive?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <Folder className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{category}</span>
      {count != null && <span className="shrink-0 tabular-nums">{count}</span>}
    </>
  );
  const base =
    "inline-flex max-w-36 items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground";

  if (!interactive) {
    return <span className={cn(base, className)}>{body}</span>;
  }
  return (
    <Link
      href={categoryHref(category)}
      title={`Show everything in ${category}`}
      className={cn(
        base,
        "transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {body}
    </Link>
  );
}
