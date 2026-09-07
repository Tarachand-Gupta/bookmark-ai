import type { AiUsage } from "@bookmark-ai/types";

/**
 * Free-tier AI usage, in units a person can hold in their head.
 *
 * The server meters TOKENS (see packages/engine/src/metering.ts + the 402 wall in
 * app/api/chat/route.ts), and a raw "312,480 / 2,000,000 tokens" is hostile: the
 * unit is invisible to the user and the numbers are too big to read. So the UI
 * speaks CREDITS at a fixed 1 credit = 1,000 tokens, which turns the shipped
 * default budget into a clean "2,000 free credits a week".
 *
 * Two rules this module exists to keep honest:
 *  - the rate is FIXED and shared (never derived per surface), so the meter in
 *    Settings, the chat greeting and the setup card can't disagree;
 *  - metering is WEEKLY, resetting Monday 00:00 UTC. The copy helpers below only
 *    ever say weekly / "resets Monday". "Monthly" is wrong and would be a lie.
 *
 * Deliberately dependency-free (no engine, no DB, no React): the settings route
 * imports it on the server and three client components import it in the browser.
 */

/** Tokens per displayed credit. 2,000,000 tokens ⇒ 2,000 credits. */
export const TOKENS_PER_CREDIT = 1_000;

/** ms in a day — the reset math is plain UTC arithmetic, no date library. */
const DAY_MS = 86_400_000;

/**
 * Tokens → whole credits, FLOORED. Floor rather than round/ceil so the meter can
 * never overstate what someone has spent (599 tokens reads as 0 credits used,
 * not 1), and so `used` can only reach the limit when the budget is genuinely
 * gone. Non-finite/negative input collapses to 0 — a bad meter read must never
 * render "NaN of 2,000".
 */
export function tokensToCredits(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.floor(tokens / TOKENS_PER_CREDIT);
}

/**
 * The ISO timestamp of the next Monday 00:00 UTC strictly AFTER `at` — i.e. when
 * the current week's counter rolls over. Mirrors `weekStartUtc` in
 * packages/engine/src/metering.ts (Monday-keyed weeks, UTC), computed here
 * independently so this module stays importable from client bundles.
 *
 * "Strictly after" matters on Mondays: at Monday 00:00:01 UTC the user is in a
 * BRAND-NEW week, so the reset they care about is next Monday, seven days out —
 * not the boundary they just crossed.
 */
export function nextWeeklyResetUtc(at: Date = new Date()): string {
  const midnight = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  // getUTCDay: 0=Sun..6=Sat → days until the next Monday, never 0.
  const daysUntilMonday = ((8 - new Date(midnight).getUTCDay()) % 7) || 7;
  return new Date(midnight + daysUntilMonday * DAY_MS).toISOString();
}

/** Whole days from `now` until the reset, rounded UP (0 never shown: the reset
 * is always at least a fraction of a day away). Used for the tooltip only. */
export function daysUntilReset(resetsAt: string, now: Date = new Date()): number {
  const ms = Date.parse(resetsAt) - now.getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

/** "1,000" — grouped digits, so the meter's two numbers scan as a pair. */
export function formatCredits(credits: number): string {
  return credits.toLocaleString("en-US");
}

/** Everything a meter needs, derived once from the wire payload. */
export interface AiCreditsView {
  usedCredits: number;
  limitCredits: number;
  remainingCredits: number;
  /** 0–100, computed from raw TOKENS (not the floored credits) so the bar moves
   * before the first whole credit is spent and pins at 100 when the wall hits. */
  percentUsed: number;
  /** True once the server would 402 the next metered request. */
  exhausted: boolean;
  /** ISO timestamp of the next Monday 00:00 UTC. */
  resetsAt: string;
}

/**
 * Normalize a settings payload's `aiUsage` into display units. Returns null for
 * a missing/unusable meter (limit ≤ 0 would make every ratio meaningless), which
 * every surface treats as "say nothing about credits" rather than guessing.
 */
export function toCreditsView(usage: AiUsage | null | undefined): AiCreditsView | null {
  if (!usage) return null;
  const { usedTokens, limitTokens } = usage;
  if (!Number.isFinite(limitTokens) || limitTokens <= 0) return null;
  const used = Number.isFinite(usedTokens) && usedTokens > 0 ? usedTokens : 0;
  const limitCredits = tokensToCredits(limitTokens);
  // Clamp used credits to the limit: the last request is allowed to overshoot
  // the budget (it's charged after it streams), and "1,004 of 1,000" reads as a
  // bug rather than as a limit.
  const usedCredits = Math.min(limitCredits, tokensToCredits(used));
  return {
    usedCredits,
    limitCredits,
    remainingCredits: Math.max(0, limitCredits - usedCredits),
    percentUsed: Math.min(100, Math.max(0, (used / limitTokens) * 100)),
    exhausted: used >= limitTokens,
    resetsAt: usage.resetsAt,
  };
}
