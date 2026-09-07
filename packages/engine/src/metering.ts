import { addWeeklyTokens, getWeeklyTokens, type Db } from "@bookmark-ai/db";

/**
 * Free-tier AI token metering.
 *
 * Users on the SERVER's fallback AI key are metered against a weekly token
 * budget (input + output combined, across every step/tool-call round of a
 * request). Usage lives in the tenant DB's `ai_usage` table, keyed by the start
 * of the calendar week — Monday 00:00 UTC. The global LIMIT is admin-adjustable
 * and lives in the master control plane (read in the API layer); this module
 * only reads/writes the per-user usage counter and computes the week key.
 */

/** Default weekly budget when no admin override is stored in the master DB. */
export const DEFAULT_FREE_AI_WEEKLY_TOKEN_LIMIT = 2_000_000;

/**
 * The ISO date (YYYY-MM-DD) of the Monday that starts the calendar week
 * containing `date`, in UTC. This is the `ai_usage.week_start` key, so usage
 * resets automatically each Monday 00:00 UTC.
 */
export function weekStartUtc(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay: 0=Sun..6=Sat → days since Monday.
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
}

/** Tokens the user has consumed on the server key so far this (UTC) week. */
export async function getWeeklyUsage(db: Db, at: Date = new Date()): Promise<number> {
  return getWeeklyTokens(db, weekStartUtc(at));
}

/**
 * Add a completed request's token total to this week's counter. No-op for a
 * non-positive/NaN total (e.g. a provider that returned no usage). Call from the
 * stream's onFinish with the AI SDK's aggregated `totalUsage`.
 */
export async function recordWeeklyUsage(db: Db, tokens: number, at: Date = new Date()): Promise<void> {
  await addWeeklyTokens(db, weekStartUtc(at), tokens);
}
