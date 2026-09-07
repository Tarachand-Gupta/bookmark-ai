import type { AiUsage } from "@bookmark-ai/types";

/**
 * Free-tier AI usage in units a person can hold in their head — the phone port
 * of apps/web/lib/ai-credits.ts. The server meters TOKENS; every client speaks
 * CREDITS at a FIXED 1 credit = 1,000 tokens, so the shipped weekly budget reads
 * as "2,000 free credits a week" everywhere. Metering is WEEKLY (Monday 00:00
 * UTC) — copy built here only ever says "Monday".
 */
export const TOKENS_PER_CREDIT = 1_000;

/** Tokens → whole credits, FLOORED so the meter never overstates what was spent. */
export function tokensToCredits(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.floor(tokens / TOKENS_PER_CREDIT);
}

export interface CreditsSummary {
  used: number;
  limit: number;
  remaining: number;
  /** 0..1 share of the budget spent — the meter bar's fill. */
  fraction: number;
}

export function creditsSummary(usage: AiUsage | null | undefined): CreditsSummary | null {
  if (!usage) return null;
  const limit = tokensToCredits(usage.limitTokens);
  const used = Math.min(limit, tokensToCredits(usage.usedTokens));
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    fraction: limit > 0 ? Math.min(1, used / limit) : 0,
  };
}

const DAY_MS = 86_400_000;

/** "Resets Monday", or "Resets tomorrow" on a Sunday; unparsable → the weekly fact. */
export function resetLabel(resetsAt: string | null | undefined, now: Date = new Date()): string {
  if (!resetsAt) return "Resets every Monday";
  const ms = Date.parse(resetsAt) - now.getTime();
  if (Number.isNaN(ms)) return "Resets every Monday";
  return ms <= DAY_MS ? "Resets tomorrow" : "Resets Monday";
}
