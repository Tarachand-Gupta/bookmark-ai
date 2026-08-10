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
export function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The bookmark's save day in the VIEWER's timezone. Falls back to the string's
 * date portion only when `savedAt` won't parse — the buckets are string
 * comparisons, so an empty value there would sort into "Older" silently.
 */
export function bookmarkLocalDay(b: Bookmark): string {
  const parsed = new Date(b.source.savedAt);
  if (Number.isNaN(parsed.getTime())) return String(b.source.savedAt).slice(0, 10);
  return localYmd(parsed);
}

/**
 * Bucket bookmarks (assumed sorted newest-first) into relative date groups:
 * Today, Yesterday, This week, This month, This year, Older.
 *
 * Both sides of every comparison are LOCAL calendar days: the boundaries below
 * and each bookmark's own day, derived from `new Date(savedAt)` in the viewer's
 * timezone. Slicing the ISO string instead took its UTC date, which east of
 * Greenwich disagrees with the local one for anything saved before the UTC
 * rollover — on IST a 04:00 save grouped under "Yesterday" while the card in it
 * said "Today" (BookmarkCard.formatDay is local). Empty buckets are dropped;
 * order runs newest → oldest. Weeks start on Monday.
 *
 * Known, deliberate divergence: the sidebar's Recent-days facet filters on the
 * server's UTC `saved_day` column, so a near-midnight bookmark can sit in a
 * different bucket here than under that facet. Fixing that means changing what
 * `saved_day` means server-side — out of scope for this presentational grouping.
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
    const day = bookmarkLocalDay(b);
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
