/**
 * Pure date-range helpers behind the Date filter (see
 * components/library/date-range-filter.tsx): the quick-preset math and the
 * trigger's label.
 *
 * Two bound shapes travel through the URL and the API: a date-only YYYY-MM-DD,
 * which means the WHOLE day (that's what the calendar produces, and it's the
 * shape the filter has always used), and a full ISO datetime, which the sub-day
 * presets need — "last hour" has no calendar-day expression. The server widens
 * both (packages/db/src/date-bounds.ts); everything here only has to produce and
 * describe them.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** True for a whole-day bound (as opposed to an instant). */
export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value);
}

export interface DateRangePreset {
  /** Stable key — also what the filter remembers to label the trigger. */
  id: string;
  label: string;
  /** The `from` bound, as an ISO datetime. `to` is deliberately left open
   * ("up to now") so the range keeps including new saves without re-applying. */
  from: (now: Date) => string;
}

const HOUR = 3_600_000;

/**
 * One calendar month back, clamping the day to the target month's length so
 * "Aug 31 minus a month" is Jul 31 and "Mar 31 minus a month" is Feb 28 rather
 * than the Mar 3 that a naive setMonth(-1) rolls over into.
 */
export function oneMonthBack(now: Date): Date {
  const target = new Date(now.getTime());
  const day = now.getDate();
  // Day 1 first: setMonth on a 31st can't overflow from a day the month has.
  target.setDate(1);
  target.setMonth(target.getMonth() - 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

/** Quick windows, in the order the popover's rail lists them. */
export const DATE_RANGE_PRESETS: DateRangePreset[] = [
  { id: "1h", label: "Last hour", from: (now) => new Date(now.getTime() - HOUR).toISOString() },
  {
    id: "12h",
    label: "Last 12 hours",
    from: (now) => new Date(now.getTime() - 12 * HOUR).toISOString(),
  },
  {
    id: "24h",
    label: "Last 24 hours",
    from: (now) => new Date(now.getTime() - 24 * HOUR).toISOString(),
  },
  {
    id: "7d",
    label: "Last 7 days",
    from: (now) => new Date(now.getTime() - 7 * 24 * HOUR).toISOString(),
  },
  { id: "1mo", label: "Last month", from: (now) => oneMonthBack(now).toISOString() },
  {
    id: "year",
    // LOCAL Jan 1 midnight, not UTC: "this year" is a calendar claim the user
    // makes in their own timezone, and the cards label their dates locally too.
    label: "This year",
    from: (now) => new Date(now.getFullYear(), 0, 1).toISOString(),
  },
];

/** Parse either bound shape into a Date. A date-only value is read as LOCAL
 * midnight so the label matches the calendar the user clicked. */
function toDate(value: string): Date | null {
  const parsed = new Date(isDateOnly(value) ? `${value}T00:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function day(d: Date, withYear: boolean): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

function instant(d: Date): string {
  return `${day(d, false)}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/**
 * The trigger's label for an applied range. Whole-day bounds read as dates
 * ("Aug 3 – Aug 10, 2026", the year stated once when both ends share it);
 * anything carrying a time reads as an instant, and a one-sided range says which
 * side it's open on ("Since Aug 10, 3:00 PM") — a bare date there would look like
 * a single-day filter.
 */
export function formatRangeLabel(from?: string, to?: string): string {
  const f = from ? toDate(from) : null;
  const t = to ? toDate(to) : null;
  // Unparseable (hand-edited URL) — show the raw value rather than "Invalid Date".
  if (from && !f) return to && t ? `${from} – ${instant(t)}` : from;
  if (to && !t) return to;
  const timed = (from && !isDateOnly(from)) || (to && !isDateOnly(to));
  if (f && t) {
    if (timed) return `${instant(f)} – ${instant(t)}`;
    const sameYear = f.getFullYear() === t.getFullYear();
    return `${day(f, !sameYear)} – ${day(t, true)}`;
  }
  if (f) return timed ? `Since ${instant(f)}` : `Since ${day(f, true)}`;
  if (t) return timed ? `Until ${instant(t)}` : `Until ${day(t, true)}`;
  return "Date";
}
