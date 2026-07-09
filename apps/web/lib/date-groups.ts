import type { Bookmark } from "@bookmark-ai/types";

export interface BookmarkGroup {
  key: string;
  label: string;
  items: Bookmark[];
}

const ORDER = ["today", "yesterday", "week", "month", "year", "older"] as const;
type BucketKey = (typeof ORDER)[number];

const LABELS: Record<BucketKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  month: "This month",
  year: "This year",
  older: "Older",
};

/** Local calendar day as YYYY-MM-DD. */
function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Bucket bookmarks (assumed sorted newest-first) into relative date groups:
 * Today, Yesterday, This week, This month, This year, Older.
 *
 * Buckets by each bookmark's stored day string — `savedAt`'s date portion, i.e.
 * the server's `saved_day` — compared against local calendar boundaries. That's
 * the exact notion of "day" the sidebar's Recent-days facet uses, so the group
 * headers and the sidebar never disagree (a bookmark saved near midnight can't
 * land in "Today" here while the facet calls it "Yesterday"). Empty buckets are
 * dropped; order runs newest → oldest. Weeks start on Monday.
 */
export function groupBookmarksByDate(
  bookmarks: Bookmark[],
  now: Date = new Date(),
): BookmarkGroup[] {
  const at = (year: number, month: number, day: number) => localYmd(new Date(year, month, day));
  const today = localYmd(now);
  const yesterday = at(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const dow = (now.getDay() + 6) % 7; // 0 = Monday
  const weekStart = at(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  const monthStart = at(now.getFullYear(), now.getMonth(), 1);
  const yearStart = at(now.getFullYear(), 0, 1);

  const groups: Record<BucketKey, Bookmark[]> = {
    today: [],
    yesterday: [],
    week: [],
    month: [],
    year: [],
    older: [],
  };

  for (const b of bookmarks) {
    const day = String(b.source.savedAt).slice(0, 10); // == server saved_day
    let key: BucketKey;
    if (day === today) key = "today";
    else if (day === yesterday) key = "yesterday";
    else if (day >= weekStart) key = "week";
    else if (day >= monthStart) key = "month";
    else if (day >= yearStart) key = "year";
    else key = "older";
    groups[key].push(b);
  }

  return ORDER.filter((k) => groups[k].length > 0).map((k) => ({
    key: k,
    label: LABELS[k],
    items: groups[k],
  }));
}
