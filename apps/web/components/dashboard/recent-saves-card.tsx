"use client";

import { BookmarkActions } from "@/components/library/organization/bookmark-actions";
import type { Bookmark } from "@bookmark-ai/types";
import { mergeRecentSaves } from "@/lib/dashboard";
import { FEATURE_ICONS } from "@/components/library/feature-icons";
import { BookmarkCard } from "@bookmark-ai/ui/components/bookmark-card";
import { useBookmarkView } from "@/hooks/use-bookmark-view";
import { SMALL_BOOKMARK_GRID_COLUMNS } from "@/lib/bookmark-view";
import { BookmarkTable } from "@/components/library/bookmark-table";
import { ViewToggle } from "@/components/library/view-toggle";
import { DashboardCard, DashboardCardEmpty } from "./dashboard-card";
import { allBookmarksHref } from "./links";

/**
 * Recent saves — the dashboard's third first-class noun, and its
 * save-confirmation surface ("did the page I just clipped land?").
 *
 * Cross-device saves are folded in here rather than getting a heading of their
 * own: they're the same objects from the same table, and one save appearing
 * twice under two labels was exactly the duplication the old resume hero
 * produced. The layout follows the same device preference as the library.
 */

/** Rows shown before "View all" takes over. Five, not the endpoint's eight: this
 * card is a glance and a doorway, not a second library. */
const VISIBLE_SAVES = 5;

export function RecentSavesCard({
  bookmarks,
  otherDeviceBookmarks,
  total,
  className,
  onMove,
  onEdit,
}: {
  bookmarks: Bookmark[];
  /** Newest saves from a device other than this one — folded into the list. */
  otherDeviceBookmarks: Bookmark[];
  total: number;
  className?: string;
  onMove?: (bookmark: Bookmark) => void;
  onEdit?: (bookmark: Bookmark) => void;
}) {
  const { view, changeView } = useBookmarkView();
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
        <div className="min-w-0 p-3">
          <div className="mb-2 flex justify-end"><ViewToggle view={view} onChange={changeView} /></div>
          {view === "table" ? <BookmarkTable bookmarks={rows} onEdit={onEdit} onMove={onMove} /> : <ul className={`grid gap-3 ${SMALL_BOOKMARK_GRID_COLUMNS}`}>
            {rows.map((b) => {
              const props = { bookmark: b, actions: (onMove || onEdit) ? <BookmarkActions bookmark={b} onMove={onMove} onEdit={onEdit} /> : undefined };
              return <li key={b.id} className="min-w-0">
                <BookmarkCard {...props} className="h-full" />
              </li>;
            })}
          </ul>}
        </div>
      )}
    </DashboardCard>
  );
}
