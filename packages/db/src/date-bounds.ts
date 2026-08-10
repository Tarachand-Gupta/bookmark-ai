/**
 * Turning a caller-supplied date bound into a `saved_at` comparison string.
 *
 * `saved_at` is ISO-8601 text ("2026-08-11T09:14:03.221Z"), so a plain
 * lexicographic `>=`/`<` compare IS chronological — no SQLite date functions, and
 * the existing index stays usable. Two things make that only true with care:
 *
 * 1. The bound has to be in the SAME shape the rows are stored in. Everything the
 *    API writes goes in as `new Date().toISOString()` (UTC, `Z`, millis), so an
 *    offset-bearing input like "2026-08-11T14:44:03+05:30" must be normalized to
 *    that form or it compares as a *string* against a different timezone's digits.
 * 2. The upper bound must be EXCLUSIVE. An inclusive `saved_at <= '…T23:59:59.999Z'`
 *    silently drops a second-precision row "…T23:59:59Z", because the strings
 *    diverge at 'Z' vs '.' and 'Z' (0x5A) > '.' (0x2E) — so the no-millis
 *    timestamp sorts AFTER the millis-bearing bound. A half-open interval against
 *    the next instant/day has no such edge.
 *
 * Both helpers return the input unchanged when it won't parse: a list request
 * must degrade to "matches nothing / filters loosely", never throw. The zod
 * schema (`listBookmarksQuerySchema`) already rejects malformed bounds at the
 * route, so this is belt-and-braces for direct/engine callers.
 */

/** A whole-day bound — the date-only form the sidebar/day facet still speaks. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Inclusive lower bound for `saved_at >= ?`.
 * Date-only "2026-08-11" → "2026-08-11T00:00:00.000Z" (the day's first instant);
 * a datetime → the same instant normalized to UTC `Z` form.
 */
export function savedAtLowerBound(value: string): string {
  if (DATE_ONLY.test(value)) return `${value}T00:00:00.000Z`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString();
}

/**
 * EXCLUSIVE upper bound for `saved_at < ?`, so a caller-supplied `to` stays
 * inclusive while the SQL is half-open.
 * Date-only "2026-08-11" → "2026-08-12T00:00:00.000Z" (the whole day is in);
 * a datetime → that instant + 1ms (the instant itself is in).
 */
export function savedAtUpperBoundExclusive(value: string): string {
  if (DATE_ONLY.test(value)) {
    const next = new Date(`${value}T00:00:00.000Z`);
    // Belt-and-braces: the regex above admits an impossible day ("2026-02-30"),
    // which V8 parses leniently (→ Mar 2) rather than rejecting, so this only
    // trips on a stranger input — but a NaN escaping here would stringify to the
    // literal "Invalid Date" and silently match nothing.
    if (Number.isNaN(next.getTime())) return value;
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  // +1ms is the smallest step the stored precision can distinguish.
  return new Date(parsed.getTime() + 1).toISOString();
}
