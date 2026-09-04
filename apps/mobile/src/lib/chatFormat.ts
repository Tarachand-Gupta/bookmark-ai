import { ageLabel } from "./live";

/**
 * Presentation helpers for the Ask AI history list. Pure functions, no React —
 * the components stay about layout. (Tool-row copy and part grouping live in
 * ./chatParts.)
 */

/** A week, in seconds: the point where "N days ago" stops being useful. */
const WEEK_SECONDS = 7 * 86400;

/**
 * Relative age for a conversation's `updatedAt` (an ISO timestamp). Delegates to
 * the live tab's `ageLabel` for anything inside a week so both lists speak the
 * same phrases ("just now", "12 min ago", "3 days ago"), then falls back to a
 * short date. Unlike the live server's ages, this one HAS to read the local
 * clock: /api/chat/conversations returns timestamps, not deltas.
 */
export function conversationTimeLabel(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const seconds = (Date.now() - t) / 1000;
  if (seconds < 0) return "just now"; // clock skew — never render "in -3 min"
  if (seconds < WEEK_SECONDS) return ageLabel(seconds);
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
