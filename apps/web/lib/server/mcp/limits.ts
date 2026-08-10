import { bumpMcpUsage, type Db } from "@bookmark-ai/db";

/**
 * Tiered per-user rate limits for MCP `tools/call`. Deliberately generous — an
 * agent legitimately fans out a dozen searches to answer one question — while
 * still bounding a runaway loop and the cost of a leaked token. The tiers stack:
 * ALL of them are checked on every call, so a burst is capped by the minute
 * window and sustained abuse by the day/week windows.
 *
 * These are per USER, shared across every token they hold (the counters live in
 * the user's own DB), and NOT env-configurable: a limit you can quietly raise per
 * environment is a limit nobody can reason about. Change them here.
 */
export const MCP_LIMITS = [
  { kind: "minute", seconds: 60, max: 60 },
  { kind: "five_minutes", seconds: 5 * 60, max: 250 },
  { kind: "hour", seconds: 60 * 60, max: 1500 },
  { kind: "day", seconds: 24 * 60 * 60, max: 8000 },
  { kind: "week", seconds: 7 * 24 * 60 * 60, max: 40000 },
] as const;

export type McpLimitKind = (typeof MCP_LIMITS)[number]["kind"];

/** A resolved window: its bucket key, when it ends, and the cap it enforces. */
export interface McpWindow {
  kind: McpLimitKind;
  bucket: string;
  max: number;
  /** Epoch ms at which this window rolls over — also the counter row's TTL. */
  resetAtMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The `day` and `week` windows are CALENDAR windows, not rolling ones, so their
 * reset time is predictable and explainable ("resets at midnight UTC" / "resets
 * Monday"). `day` = the UTC date; `week` = the UTC date of the ISO week's Monday.
 * The three short windows are epoch-floored (`floor(now / seconds)`), which needs
 * no calendar reasoning and rolls over on a fixed grid.
 */
function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function isoWeekStartUtc(nowMs: number): string {
  const d = new Date(nowMs);
  // getUTCDay(): 0 = Sunday. ISO weeks start Monday, so Sunday is 6 days in.
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  return utcDay(nowMs - daysSinceMonday * DAY_MS);
}

/** Start of the next UTC day / ISO week, in epoch ms. */
function nextUtcDayMs(nowMs: number): number {
  return Date.parse(`${utcDay(nowMs)}T00:00:00.000Z`) + DAY_MS;
}

function nextIsoWeekMs(nowMs: number): number {
  return Date.parse(`${isoWeekStartUtc(nowMs)}T00:00:00.000Z`) + 7 * DAY_MS;
}

/**
 * Resolve every window that applies at `nowMs`. Bucket keys are
 * `<kind>:<window start>` — unique per window instance, so a rolled-over window
 * simply starts at a fresh row (and the old one is swept by its expires_at).
 */
export function mcpWindows(nowMs: number): McpWindow[] {
  return MCP_LIMITS.map(({ kind, seconds, max }) => {
    if (kind === "day") {
      return { kind, bucket: `day:${utcDay(nowMs)}`, max, resetAtMs: nextUtcDayMs(nowMs) };
    }
    if (kind === "week") {
      return { kind, bucket: `week:${isoWeekStartUtc(nowMs)}`, max, resetAtMs: nextIsoWeekMs(nowMs) };
    }
    const windowMs = seconds * 1000;
    const start = Math.floor(nowMs / windowMs) * windowMs;
    return { kind, bucket: `${kind}:${start}`, max, resetAtMs: start + windowMs };
  });
}

/** Seconds until a window resets, rounded up and floored at 1 (never "retry
 * after 0 seconds"). */
export function retryAfterSeconds(window: McpWindow, nowMs: number): number {
  return Math.max(1, Math.ceil((window.resetAtMs - nowMs) / 1000));
}

export type McpLimitVerdict =
  | { allowed: true }
  | { allowed: false; kind: McpLimitKind; retryAfterSeconds: number };

/**
 * Check (and consume) one unit of every tier. Windows are bumped in ascending
 * size order and the first refusal short-circuits, so a caller already over the
 * minute cap doesn't burn day/week budget it can't spend anyway. Slight
 * over-count is possible in the reverse direction (a call refused by an outer
 * window has already consumed the inner ones) — acceptable, and it makes the
 * limiter fail toward stricter, never looser.
 */
export async function enforceMcpLimits(db: Db, nowMs = Date.now()): Promise<McpLimitVerdict> {
  for (const window of mcpWindows(nowMs)) {
    const { allowed } = await bumpMcpUsage(
      db,
      window.bucket,
      new Date(window.resetAtMs).toISOString(),
      window.max,
    );
    if (!allowed) {
      return {
        allowed: false,
        kind: window.kind,
        retryAfterSeconds: retryAfterSeconds(window, nowMs),
      };
    }
  }
  return { allowed: true };
}
