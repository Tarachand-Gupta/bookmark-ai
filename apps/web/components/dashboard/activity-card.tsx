import type { DashboardActivity } from "@bookmark-ai/types";
import { Activity } from "lucide-react";
import { CategoryChip } from "./category-chip";
import { DashboardCard, DashboardCardEmpty } from "./dashboard-card";

/**
 * Activity (doc §3.7): exactly three facts computed from SAVES — a 14-day
 * sparkline, the top 3 categories, and the browser split. No streaks, no "you
 * saved 23% more than last week", no telemetry-derived numbers: awareness, not
 * nagging (and §2's privacy stance — we only ever count what the user saved).
 *
 * The quietest card on the page on purpose: it has no header action (there is no
 * "all activity" view to send anyone to) and its browser legend is plain text.
 * Its category chips are the only thing here you can click, and they're the same
 * `CategoryChip` the bookmark rows render inert.
 *
 * `activity` is null below ACTIVITY_MIN_BOOKMARKS (server-side decision) — a
 * sparkline over four saves looks broken, so the card says so in one line rather
 * than drawing it.
 *
 * *2026-08-27 (Tara):* on the DASHBOARD that sentence is now unreachable. This
 * is the one card allowed to be absent rather than empty, so the page gates it
 * on `hasDashboardActivity(activity)` (lib/dashboard.ts) — no saves in the
 * window, no card. The empty branch stays for any other consumer that renders
 * this card unconditionally; it is not the dashboard's path.
 */
export function ActivityCard({
  activity,
  className,
}: {
  activity: DashboardActivity | null;
  className?: string;
}) {
  if (!activity) {
    return (
      <DashboardCard title="Activity" Icon={Activity} className={className} flush>
        <DashboardCardEmpty>
          Save a few more pages and a 14-day picture of your activity shows up here.
        </DashboardCardEmpty>
      </DashboardCard>
    );
  }

  const total = activity.days.reduce((sum, d) => sum + d.count, 0);

  return (
    <DashboardCard title="Activity" Icon={Activity} className={className}>
      <div className="space-y-4">
        <div>
          <p className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>
              <span className="font-medium tabular-nums text-foreground">{total}</span> saved in the
              last {activity.days.length} days
            </span>
            <span className="tabular-nums">{dayLabel(activity.days.at(-1)?.day)}</span>
          </p>
          <Sparkline days={activity.days} />
        </div>

        {activity.topCategories.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground">Top categories</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {activity.topCategories.slice(0, 3).map((c) => (
                <CategoryChip key={c.name} category={c.name} count={c.count} interactive />
              ))}
            </div>
          </div>
        )}

        {activity.browserSplit.length > 0 && <BrowserSplit rows={activity.browserSplit} />}
      </div>
    </DashboardCard>
  );
}

/** Smallest y-axis maximum the sparkline will scale to (see Sparkline). */
const SPARKLINE_MIN_SCALE = 4;

/**
 * 14 bars, inline SVG, no chart library. Bars (not a line) because these are
 * discrete daily counts — a smoothed line would invent values between days.
 *
 * `preserveAspectRatio="none"` lets the fixed 0-100 user space stretch to the
 * card's width; only bar widths/gaps scale with it, which is harmless for rects.
 */
function Sparkline({ days }: { days: { day: string; count: number }[] }) {
  const peak = Math.max(0, ...days.map((d) => d.count));
  // Scale against a FLOOR of 4, not the actual peak: a week of one-save days
  // otherwise renders full-height bars that read as a placeholder graphic ("is this
  // real data?"). A quiet chart for a quiet fortnight is the honest picture; the
  // heading above already states the real total.
  const scaleMax = Math.max(SPARKLINE_MIN_SCALE, peak);
  const slot = 100 / days.length;
  const barWidth = slot * 0.62;
  const height = 32;

  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Saves per day for the last ${days.length} days, highest ${peak}`}
      className="mt-2 h-9 w-full"
    >
      {/* Hairline baseline so the bars sit on something — without it a row of short
          bars floats in the card with no reference line. */}
      <rect x="0" y={height - 0.5} width="100" height="0.5" className="fill-border" />
      {days.map((d, i) => {
        // Floor of 1.5 user units so a zero day still reads as a tick on the
        // baseline instead of vanishing (a gap would look like missing data).
        const barHeight =
          d.count === 0 ? 1.5 : Math.max(2.5, (d.count / scaleMax) * (height - 1));
        return (
          <rect
            key={d.day}
            x={i * slot + (slot - barWidth) / 2}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            className={d.count === 0 ? "fill-muted-foreground/25" : "fill-foreground/75"}
          />
        );
      })}
    </svg>
  );
}

/**
 * "Chrome 62% · Safari 30% · Other 8%" as one proportion bar plus a plain-text
 * legend. The legend used to be four links to the filtered library — four more
 * click targets in the quietest card on the page, for a filter the sidebar
 * already offers. It's a label now.
 */
function BrowserSplit({ rows }: { rows: { name: string; count: number }[] }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  if (total === 0) return null;
  // Neutral, theme-aware shades rather than a colour scale: the split is a
  // proportion, not a categorical palette, and these read correctly in both themes.
  const shades = ["bg-foreground/80", "bg-foreground/55", "bg-foreground/35", "bg-foreground/20"];
  const shown = rows.slice(0, 4);

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">Where you save from</p>
      <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {shown.map((r, i) => (
          <span
            key={r.name}
            className={shades[i % shades.length]}
            style={{ width: `${(r.count / total) * 100}%` }}
            aria-hidden
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {shown.map((r, i) => (
          <span key={r.name} className="inline-flex items-center gap-1.5">
            <span className={`size-2 shrink-0 rounded-full ${shades[i % shades.length]}`} aria-hidden />
            <span className="capitalize">{r.name}</span>
            <span className="tabular-nums">{Math.round((r.count / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** The window's last day, loosely labelled — the server returns UTC `saved_day`
 * keys and the client is free to present them approximately (see the contract). */
function dayLabel(day: string | undefined): string {
  if (!day) return "";
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
