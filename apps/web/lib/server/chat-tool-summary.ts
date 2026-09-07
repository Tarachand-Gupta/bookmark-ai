/**
 * COMPACT MODEL VIEWS of list-shaped tool output.
 *
 * The chat streams every tool's FULL output to the browser, where it renders as
 * an interactive card (device → window sections, tables, filter boxes). The
 * MODEL doesn't need that: handing it 92 tab titles cost tokens and latency and
 * tempted it to re-list them as prose. These pure functions turn each output
 * into a short text digest — the first `GROUP_LIMIT` items per group plus
 * counts plus an explicit "already shown to the user in a card" note — which the
 * route wires up as the AI SDK's `toModelOutput`.
 *
 * Pure and dependency-free so it is unit-tested away from the route.
 */

/** How many items of any one group the model sees spelled out. */
export const MODEL_GROUP_LIMIT = 15;

/** Hard caps on any single string that reaches the model or the stored output. */
export const MAX_TITLE_CHARS = 160;
export const MAX_URL_CHARS = 300;
/** Absolute ceiling on a digest, so a pathological result can't blow the turn. */
export const MAX_SUMMARY_CHARS = 6_000;

/** Trim + ellipsize; always returns a string. */
export function clampText(value: unknown, max: number): string {
  const s = typeof value === "string" ? value.trim() : value == null ? "" : String(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export const clampTitle = (v: unknown): string => clampText(v, MAX_TITLE_CHARS);
export const clampUrl = (v: unknown): string => clampText(v, MAX_URL_CHARS);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "…and 77 more, already rendered for the user in a card." */
function moreLine(hidden: number, noun: string): string[] {
  return hidden > 0
    ? [`  … ${plural(hidden, `more ${noun}`, `more ${noun}s`)} not listed here — ALL of them are already rendered for the user in an interactive card.`]
    : [];
}

function finish(lines: string[]): string {
  return clampText(lines.join("\n"), MAX_SUMMARY_CHARS);
}

/** `{ error }` / `{ enabled: false }` shapes pass through as their own JSON. */
function passthroughError(output: unknown): string | null {
  const rec = output as Record<string, unknown> | null;
  if (rec && typeof rec === "object" && typeof rec.error === "string") return JSON.stringify({ error: rec.error });
  return null;
}

// ── listLiveTabs ─────────────────────────────────────────────────────────────

export interface LiveTabsSummaryInput {
  enabled?: boolean;
  error?: string;
  devices?: {
    label?: string;
    browser?: string;
    lastSeenAgeSeconds?: number;
    tabCount?: number;
    hiddenTabCount?: number;
    windows?: { windowId?: number; tabs?: { title?: string; url?: string }[] }[];
  }[];
}

export function summarizeLiveTabs(output: LiveTabsSummaryInput): string {
  const err = passthroughError(output);
  if (err) return err;
  if (output.enabled === false) {
    return "Live sharing is OFF for this account — there are no live tabs to read. Tell the user how to turn it on (extension popup → Live).";
  }
  const devices = output.devices ?? [];
  if (devices.length === 0) return "Live sharing is on, but no device is sharing tabs right now.";

  const total = devices.reduce((n, d) => n + (d.tabCount ?? 0), 0);
  const lines: string[] = [
    `${plural(total, "open tab")} across ${plural(devices.length, "device")}. The FULL list is already rendered for the user as an interactive card — do NOT re-list it. Summarize instead: counts per device, the recurring themes, and at most 5 notable tabs as links.`,
    "",
  ];
  for (const d of devices) {
    const windows = d.windows ?? [];
    lines.push(
      `Device "${clampTitle(d.label) || "Unnamed"}" (${d.browser ?? "other"}, ${plural(d.tabCount ?? 0, "tab")} in ${plural(windows.length, "window")}, last seen ${d.lastSeenAgeSeconds ?? 0}s ago):`,
    );
    const tabs = windows.flatMap((w) => w.tabs ?? []);
    for (const t of tabs.slice(0, MODEL_GROUP_LIMIT)) {
      const url = clampUrl(t.url);
      lines.push(`  - ${clampTitle(t.title) || url} — ${url}`);
    }
    lines.push(...moreLine(tabs.length - Math.min(tabs.length, MODEL_GROUP_LIMIT), "tab"));
  }
  return finish(lines);
}

// ── searchBookmarks ──────────────────────────────────────────────────────────

export interface BookmarkSearchSummaryInput {
  error?: string;
  mode?: string;
  fallback?: boolean;
  results?: { title?: string; url?: string; category?: string; day?: string }[];
}

export function summarizeBookmarkSearch(output: BookmarkSearchSummaryInput): string {
  const err = passthroughError(output);
  if (err) return err;
  const results = output.results ?? [];
  if (results.length === 0) return "No bookmarks matched. Say so plainly and suggest different words or a different mode.";
  const lines: string[] = [
    `${plural(results.length, "matching bookmark")} (mode ${output.mode ?? "hybrid"}${output.fallback ? ", heuristic fallback" : ""}). All of them are already rendered for the user as cards — synthesize and link at most 5.`,
    "",
  ];
  for (const r of results.slice(0, MODEL_GROUP_LIMIT)) {
    const url = clampUrl(r.url);
    lines.push(`- ${clampTitle(r.title) || url} — ${url} [${r.category ?? "?"}${r.day ? `, ${r.day}` : ""}]`);
  }
  lines.push(...moreLine(results.length - Math.min(results.length, MODEL_GROUP_LIMIT), "result"));
  return finish(lines);
}

// ── listSessions ─────────────────────────────────────────────────────────────

export interface SessionsSummaryInput {
  error?: string;
  total?: number;
  sessions?: {
    name?: string;
    description?: string | null;
    tabCount?: number;
    browser?: string;
    savedAt?: string;
    tabs?: { title?: string; url?: string }[];
  }[];
}

/** Sessions carry up to 15 tabs each; the model only needs a handful per session. */
const SESSION_TAB_LIMIT = 5;

export function summarizeSessions(output: SessionsSummaryInput): string {
  const err = passthroughError(output);
  if (err) return err;
  const sessions = output.sessions ?? [];
  if (sessions.length === 0) return "No saved sessions matched.";
  const lines: string[] = [
    `${plural(output.total ?? sessions.length, "saved session")} (showing ${sessions.length}). Rendered for the user as a card — summarize, don't re-list every tab.`,
    "",
  ];
  for (const s of sessions.slice(0, MODEL_GROUP_LIMIT)) {
    lines.push(
      `- "${clampTitle(s.name)}" — ${plural(s.tabCount ?? 0, "tab")}, ${s.browser ?? "other"}, saved ${s.savedAt ?? "?"}${s.description ? `: ${clampText(s.description, 240)}` : ""}`,
    );
    const tabs = s.tabs ?? [];
    for (const t of tabs.slice(0, SESSION_TAB_LIMIT)) {
      const url = clampUrl(t.url);
      lines.push(`    · ${clampTitle(t.title) || url} — ${url}`);
    }
    if (tabs.length > SESSION_TAB_LIMIT) {
      lines.push(`    · … ${tabs.length - SESSION_TAB_LIMIT} more tabs in this session (shown to the user in the card)`);
    }
  }
  lines.push(...moreLine(sessions.length - Math.min(sessions.length, MODEL_GROUP_LIMIT), "session"));
  return finish(lines);
}

// ── queryDatabase ────────────────────────────────────────────────────────────

export interface SqlSummaryInput {
  error?: string;
  columns?: string[];
  rows?: unknown[][];
  rowCount?: number;
  truncated?: boolean;
}

/** How many SQL rows the model sees. Aggregates are usually short; a wide SELECT
 * is exactly the case where the card, not the prose, is the answer. */
const SQL_ROW_LIMIT = 20;

export function summarizeSqlResult(output: SqlSummaryInput): string {
  const err = passthroughError(output);
  if (err) return err;
  const columns = output.columns ?? [];
  const rows = output.rows ?? [];
  if (rows.length === 0) return "0 rows.";
  const cell = (v: unknown) => clampText(v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : v, MAX_TITLE_CHARS);
  const lines: string[] = [
    `${plural(output.rowCount ?? rows.length, "row")}${output.truncated ? " (truncated by the row cap)" : ""}. The full table is already rendered for the user — quote only the numbers that answer the question.`,
    columns.join(" | "),
    ...rows.slice(0, SQL_ROW_LIMIT).map((r) => columns.map((_, i) => cell(r[i])).join(" | ")),
  ];
  lines.push(...moreLine(rows.length - Math.min(rows.length, SQL_ROW_LIMIT), "row"));
  return finish(lines);
}
