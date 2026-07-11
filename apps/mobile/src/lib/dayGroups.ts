import type { Bookmark } from "@bookmark-ai/types";

export interface DaySection {
  title: string;
  data: Bookmark[];
}

/** Group a newest-first bookmark list into Today / Yesterday / "Jul 10"
 * sections — the iOS way to present time-ordered content. */
export function groupByDay(bookmarks: Bookmark[]): DaySection[] {
  const sections: DaySection[] = [];
  let currentKey = "";
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));

  for (const bookmark of bookmarks) {
    const saved = new Date(bookmark.source.savedAt);
    const key = Number.isNaN(saved.getTime()) ? "Earlier" : dayKey(saved);
    if (key !== currentKey) {
      currentKey = key;
      sections.push({ title: labelFor(key, saved, today, yesterday), data: [] });
    }
    sections[sections.length - 1].data.push(bookmark);
  }
  return sections;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function labelFor(key: string, saved: Date, today: string, yesterday: string): string {
  if (key === "Earlier") return "Earlier";
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const sameYear = saved.getFullYear() === new Date().getFullYear();
  return saved.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
