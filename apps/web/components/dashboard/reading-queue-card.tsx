import type { Bookmark } from "@bookmark-ai/types";
import { BookOpen } from "lucide-react";
import { dominantReadingTag } from "@/lib/dashboard";
import { DashboardBookmarkRow } from "./bookmark-row";
import { DashboardCard } from "./dashboard-card";
import { tagHref } from "./links";

/**
 * Reading queue (doc §3.5) — bookmarks the native reading-list sync tagged
 * `reading`/`article`, newest first, with the full count in the header. This is
 * native-sync's payoff surface.
 *
 * The library filters by ONE tag at a time, so the footer links to whichever of
 * the two tags these items actually carry (see `dominantReadingTag`) and names it
 * — linking to a tag that filters to fewer rows than the header claims would be
 * dishonest. Empty ⇒ nothing renders.
 */
export function ReadingQueueCard({
  queue,
  className,
}: {
  queue: { total: number; items: Bookmark[] };
  className?: string;
}) {
  if (queue.items.length === 0) return null;
  const tag = dominantReadingTag(queue.items);

  return (
    <DashboardCard
      title="Reading list"
      Icon={BookOpen}
      count={queue.total}
      footerHref={tagHref(tag)}
      footerLabel={`Everything tagged #${tag}`}
      className={className}
      flush
    >
      <div className="divide-y">
        {queue.items.map((b) => (
          <DashboardBookmarkRow key={b.id} bookmark={b} />
        ))}
      </div>
    </DashboardCard>
  );
}
