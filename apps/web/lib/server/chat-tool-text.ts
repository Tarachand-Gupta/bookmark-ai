/**
 * Per-ROW size caps for the chat agent's tool results.
 *
 * Tool output is NOT summarized for the model — it reads every page verbatim, and
 * bounds the context by PAGING instead (packages/types/src/chat-tools.ts). What
 * still has to be bounded is a single row: a pathological page title or a URL
 * with a kilobyte of query string would otherwise blow a 50-row page out of
 * proportion. These clamps apply at the point each tool builds its rows.
 */

export const MAX_TITLE_CHARS = 160;
export const MAX_URL_CHARS = 300;
/** Session/AI descriptions get a little more room — they're the summary itself. */
export const MAX_DESCRIPTION_CHARS = 400;

/** Trim + ellipsize; always returns a string. */
export function clampText(value: unknown, max: number): string {
  const s = typeof value === "string" ? value.trim() : value == null ? "" : String(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export const clampTitle = (v: unknown): string => clampText(v, MAX_TITLE_CHARS);
export const clampUrl = (v: unknown): string => clampText(v, MAX_URL_CHARS);
export const clampDescription = (v: unknown): string => clampText(v, MAX_DESCRIPTION_CHARS);

/**
 * Case-insensitive substring match over the fields a tool lets the model filter
 * on. Server-side narrowing beats blind paging: "the tab about DigitalOcean" is
 * one filtered call, not eight pages.
 */
export function matchesQuery(query: string | undefined, ...fields: (string | null | undefined)[]): boolean {
  const q = query?.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => typeof f === "string" && f.toLowerCase().includes(q));
}
