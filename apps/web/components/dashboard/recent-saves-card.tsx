import type { Bookmark } from "@bookmark-ai/types";
import { FEATURE_ICONS } from "@/components/library/feature-icons";
import { DashboardBookmarkRow } from "./bookmark-row";
import { DashboardCard } from "./dashboard-card";
import { allBookmarksHref } from "./links";

/**
 * Recent saves (doc §3.4): the newest few saves as compact rows. Doubles as
 * save-confirmation ("did the page I just clipped land?"), which is why it sits
 * high in tier 2 even though the library is one click away.
 *
 * Six DENSE rows, not the endpoint's full eight at full height: this card is a
 * glance ("it landed") and a doorway, not a second library — at eight normal rows
 * it was the tallest thing on the page and dragged its whole grid row with it.
 * The count the header would show is on the footer's destination anyway.
 *
 * Row click opens the URL; the category chip jumps to the filtered library
 * (see DashboardBookmarkRow). Empty ⇒ nothing renders.
 */

/** Rows shown before "All bookmarks" takes over. */
const VISIBLE_SAVES = 6;

export function RecentSavesCard({
  bookmarks,
  className,
}: {
  bookmarks: Bookmark[];
  className?: string;
}) {
  if (bookmarks.length === 0) return null;

  return (
    <DashboardCard
      title="Recent saves"
      Icon={FEATURE_ICONS.bookmarks}
      footerHref={allBookmarksHref()}
      footerLabel="All bookmarks"
      className={className}
      flush
    >
      <div className="divide-y">
        {bookmarks.slice(0, VISIBLE_SAVES).map((b) => (
          <DashboardBookmarkRow key={b.id} bookmark={b} dense />
        ))}
      </div>
    </DashboardCard>
  );
}
