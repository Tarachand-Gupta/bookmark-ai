import type { Bookmark } from "@bookmark-ai/types";
import { FEATURE_ICONS } from "@/components/library/feature-icons";
import { DashboardBookmarkRow } from "./bookmark-row";
import { DashboardCard } from "./dashboard-card";
import { allBookmarksHref } from "./links";

/**
 * Recent saves (doc §3.4): the newest 8 saves as compact rows. Doubles as
 * save-confirmation ("did the page I just clipped land?"), which is why it sits
 * high in tier 2 even though the library is one click away.
 *
 * Row click opens the URL; the category chip jumps to the filtered library
 * (see DashboardBookmarkRow). Empty ⇒ nothing renders.
 */
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
        {bookmarks.map((b) => (
          <DashboardBookmarkRow key={b.id} bookmark={b} />
        ))}
      </div>
    </DashboardCard>
  );
}
