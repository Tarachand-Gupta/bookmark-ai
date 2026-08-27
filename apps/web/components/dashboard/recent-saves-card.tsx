import type { Bookmark } from "@bookmark-ai/types";
import { mergeRecentSaves } from "@/lib/dashboard";
import { FEATURE_ICONS } from "@/components/library/feature-icons";
import { DashboardBookmarkRow } from "./bookmark-row";
import { DashboardCard, DashboardCardEmpty } from "./dashboard-card";
import { allBookmarksHref } from "./links";

/**
 * Recent saves — the dashboard's third first-class noun, and its
 * save-confirmation surface ("did the page I just clipped land?").
 *
 * Cross-device saves are folded in here rather than getting a heading of their
 * own: they're the same objects from the same table, and one save appearing
 * twice under two labels was exactly the duplication the old resume hero
 * produced. The device icon on the row carries that fact instead (see
 * `mergeRecentSaves` and DashboardBookmarkRow).
 */

/** Rows shown before "View all" takes over. Five, not the endpoint's eight: this
 * card is a glance and a doorway, not a second library. */
const VISIBLE_SAVES = 5;

export function RecentSavesCard({
  bookmarks,
  otherDeviceBookmarks,
  total,
  className,
}: {
  bookmarks: Bookmark[];
  /** Newest saves from a device other than this one — folded into the list. */
  otherDeviceBookmarks: Bookmark[];
  total: number;
  className?: string;
}) {
  const rows = mergeRecentSaves(bookmarks, otherDeviceBookmarks, VISIBLE_SAVES);

  return (
    <DashboardCard
      title="Recent saves"
      Icon={FEATURE_ICONS.bookmarks}
      count={total || null}
      viewAllHref={allBookmarksHref()}
      className={className}
      flush
    >
      {rows.length === 0 ? (
        <DashboardCardEmpty>
          Nothing saved yet — anything you clip from the extension lands here.
        </DashboardCardEmpty>
      ) : (
        <ul className="divide-y">
          {rows.map((b) => (
            <li key={b.id}>
              <DashboardBookmarkRow bookmark={b} />
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}
