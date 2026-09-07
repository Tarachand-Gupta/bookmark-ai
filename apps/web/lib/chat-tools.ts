/**
 * Tool-call presentation for Ask AI (CONTRACT §6): one row per tool invocation
 * with tool-specific copy for the running / done / failed phases.
 *
 * Pure and React-free so the copy is unit-testable (chat-tools.test.ts) and so
 * the same words can be lifted by the other clients. The component
 * (components/library/chat-tool-card.tsx) maps `icon` ids to glyphs and renders
 * the rich result bodies underneath.
 */

/** The AI SDK's tool part states — copied as a string union so this module
 * doesn't import `ai` (keeps it trivially testable in node). */
export type ToolPartState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

export type ToolPhase = "running" | "done" | "error";

export type ToolIconId =
  | "search"
  | "semantic"
  | "database"
  | "sessions"
  | "live"
  | "web"
  | "page"
  | "skill"
  | "generic";

export interface ToolView {
  phase: ToolPhase;
  /** The row's primary text ("Searching bookmarks for “x”", "Found 3 bookmarks"). */
  label: string;
  /** Optional muted detail after the label (the query, the SQL purpose, the host). */
  detail?: string;
  icon: ToolIconId;
  /** For `error`: what to show under the row. */
  errorText?: string;
}

const TOOL_NOUNS: Record<string, string> = {
  searchBookmarks: "Bookmark search",
  queryDatabase: "Library query",
  listSessions: "Saved sessions",
  listLiveTabs: "Live tabs",
  webSearch: "Web search",
  fetchUrl: "Page read",
  useSkill: "Skill",
};

/** "listLiveTabs" → "list live tabs"; "web_search" → "web search". */
export function humanizeToolName(name: string): string {
  const spaced = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return spaced || "tool";
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? singular : pluralForm}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function count(value: unknown): number | undefined {
  if (Array.isArray(value)) return value.length;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Tools return `{ error }` instead of throwing so a failure can't break the
 * stream — surface that as the error phase too, not as a green check. */
function outputError(output: unknown): string | undefined {
  return str(asRecord(output)?.error);
}

function quote(s: string): string {
  return `“${s}”`;
}

/**
 * The row's count for a PAGED tool result: the true `page.total` when the tool
 * knew it, else the rows on this page. Ranked search reports `total: null`, so
 * it falls back to what came back.
 */
function pageTotal(output: Record<string, unknown>, shown: number): { n: number; partial: boolean } {
  const page = asRecord(output.page);
  const total = count(page?.total);
  if (total === undefined) return { n: shown, partial: page?.hasMore === true };
  return { n: total, partial: total > shown };
}

/** " · showing 50" when a page is only part of the result. */
function pageSuffix(shown: number, partial: boolean): string {
  return partial ? ` · showing ${shown.toLocaleString("en-US")}` : "";
}

/** Tools whose success adds a row to the user's skills. */
const SKILL_WRITING_TOOLS = new Set(["createSkill", "installSkill"]);

/**
 * How many skills a finished message created or installed — a settled
 * `createSkill` / `installSkill` part whose output carries `{ skill }`. The
 * chat uses this to tell an open Skills manager to refresh.
 */
export function skillsCreatedIn(
  parts: readonly { type: string; state?: string; output?: unknown; toolName?: string }[],
): number {
  let n = 0;
  for (const part of parts) {
    const name =
      part.type === "dynamic-tool" ? part.toolName : part.type.startsWith("tool-") ? part.type.slice(5) : undefined;
    if (!name || !SKILL_WRITING_TOOLS.has(name)) continue;
    if (part.state !== "output-available") continue;
    if (asRecord(asRecord(part.output)?.skill)) n++;
  }
  return n;
}

/**
 * Build the row copy for one tool part. `state` decides the phase, the tool
 * name picks the vocabulary, and input/output fill in the numbers.
 */
export function describeToolPart(
  toolName: string,
  state: ToolPartState,
  input: unknown,
  output: unknown,
  errorText?: string,
): ToolView {
  const inp = asRecord(input) ?? {};
  const out = asRecord(output) ?? {};
  const running = state === "input-streaming" || state === "input-available";
  const failed = state === "output-error" || state === "output-denied";
  // The server never emits `output-error`: EVERY tool failure arrives as
  // `output-available` with `{ error: "…" }` (e.g. `blocked address 10.0.0.1`,
  // `Skill "x" is disabled`). That is the error state — red row, the error text
  // under it, no result body. `output-error`/`errorText` stays handled for a
  // provider-level failure.
  const softError = state === "output-available" ? outputError(output) : undefined;

  switch (toolName) {
    case "searchBookmarks": {
      const query = str(inp.query);
      const semantic = inp.mode === "semantic" || out.mode === "ai";
      const icon: ToolIconId = semantic ? "semantic" : "search";
      if (running) {
        return { phase: "running", icon, label: query ? `Searching bookmarks for ${quote(query)}` : "Searching bookmarks" };
      }
      if (failed || softError) {
        return { phase: "error", icon, label: "Bookmark search failed", detail: query && quote(query), errorText: softError ?? errorText };
      }
      const shown = count(out.results) ?? 0;
      const { n, partial } = pageTotal(out, shown);
      return {
        phase: "done",
        icon,
        label: `Found ${plural(n, "bookmark")}${partial ? "+" : ""}${pageSuffix(shown, partial)}${out.fallback ? " · text fallback" : ""}`,
        detail: query && quote(query),
      };
    }
    case "queryDatabase": {
      const purpose = str(inp.purpose);
      if (running) return { phase: "running", icon: "database", label: "Querying your library", detail: purpose };
      if (failed || softError) {
        return { phase: "error", icon: "database", label: "Library query failed", detail: purpose, errorText: softError ?? errorText };
      }
      const shown = count(out.rowCount) ?? count(out.rows) ?? 0;
      const { n, partial } = pageTotal(out, shown);
      return {
        phase: "done",
        icon: "database",
        label: `${plural(n, "row")}${pageSuffix(shown, partial)}${out.truncated ? " · clipped" : ""}`,
        detail: purpose,
      };
    }
    case "listSessions": {
      const query = str(inp.query);
      if (running) return { phase: "running", icon: "sessions", label: "Listing saved sessions", detail: query && quote(query) };
      if (failed || softError) {
        return { phase: "error", icon: "sessions", label: "Couldn't list saved sessions", detail: query && quote(query), errorText: softError ?? errorText };
      }
      const shown = count(out.sessions) ?? 0;
      // Turns stored before paging carried a bare `total`; they labelled the
      // page's own length, so only a real `page` changes the number.
      const { n, partial } = pageTotal(out, shown);
      return {
        phase: "done",
        icon: "sessions",
        label: `${plural(n, "session")}${pageSuffix(shown, partial)}`,
        detail: query && quote(query),
      };
    }
    case "listLiveTabs": {
      const filter = str(inp.query) ?? str(out.query);
      if (running) {
        return {
          phase: "running",
          icon: "live",
          label: filter ? `Looking for ${quote(filter)} in your live tabs` : "Checking live tabs",
        };
      }
      if (failed || softError) {
        return { phase: "error", icon: "live", label: "Live tabs unavailable", errorText: softError ?? errorText };
      }
      if (out.enabled === false) return { phase: "done", icon: "live", label: "Live sharing is off" };
      const devices = Array.isArray(out.devices) ? (out.devices as unknown[]) : [];
      // Tabs ON THIS PAGE — the row counts what the card is showing, while
      // `page.total` (below) is how many the lookup actually matched.
      const shownTabs = devices.reduce<number>((sum, d) => {
        const windows = Array.isArray(asRecord(d)?.windows) ? (asRecord(d)!.windows as unknown[]) : [];
        return sum + windows.reduce<number>((n, w) => n + (count(asRecord(w)?.tabs) ?? 0), 0);
      }, 0);
      const { n, partial } = pageTotal(out, shownTabs);
      return {
        phase: "done",
        icon: "live",
        label: `${plural(n, "tab")} on ${plural(devices.length, "device")}${pageSuffix(shownTabs, partial)}`,
        detail: filter && quote(filter),
      };
    }
    case "webSearch": {
      const query = str(inp.query);
      if (running) return { phase: "running", icon: "web", label: query ? `Searching the web for ${quote(query)}` : "Searching the web" };
      if (failed || softError) {
        return { phase: "error", icon: "web", label: "Web search failed", detail: query && quote(query), errorText: softError ?? errorText };
      }
      const n = count(out.results) ?? 0;
      return { phase: "done", icon: "web", label: plural(n, "source"), detail: query && quote(query) };
    }
    case "fetchUrl": {
      const url = str(out.url) ?? str(inp.url);
      const host = url ? hostOf(url) : undefined;
      if (running) return { phase: "running", icon: "page", label: host ? `Reading ${host}` : "Reading page" };
      if (failed || softError) {
        return { phase: "error", icon: "page", label: host ? `Couldn't read ${host}` : "Couldn't read the page", errorText: softError ?? errorText };
      }
      const title = str(out.title);
      return { phase: "done", icon: "page", label: `Read ${title ?? host ?? "page"}`, detail: title ? host : undefined };
    }
    case "useSkill": {
      const name = str(out.name) ?? str(inp.name);
      if (running) return { phase: "running", icon: "skill", label: name ? `Loading skill ${quote(name)}` : "Loading skill" };
      if (failed || softError) {
        return { phase: "error", icon: "skill", label: name ? `Skill ${quote(name)} unavailable` : "Skill unavailable", errorText: softError ?? errorText };
      }
      return { phase: "done", icon: "skill", label: name ? `Using skill ${quote(name)}` : "Using skill" };
    }
    case "createSkill": {
      // CONTRACT §3b.3: "Creating skill “{name}”" → "Created skill “{name}”".
      const name = str(asRecord(out.skill)?.name) ?? str(inp.name);
      if (running) return { phase: "running", icon: "skill", label: name ? `Creating skill ${quote(name)}` : "Creating skill" };
      if (failed || softError) {
        return { phase: "error", icon: "skill", label: name ? `Couldn't create skill ${quote(name)}` : "Couldn't create the skill", errorText: softError ?? errorText };
      }
      return { phase: "done", icon: "skill", label: name ? `Created skill ${quote(name)}` : "Created skill" };
    }
    case "installSkill": {
      // "Installing skill from {host}" → "Installed skill “{name}”".
      const url = str(inp.url);
      const host = url ? hostOf(url) : undefined;
      const name = str(asRecord(out.skill)?.name);
      if (running) return { phase: "running", icon: "skill", label: host ? `Installing skill from ${host}` : "Installing skill" };
      if (failed || softError) {
        return { phase: "error", icon: "skill", label: host ? `Couldn't install skill from ${host}` : "Couldn't install the skill", errorText: softError ?? errorText };
      }
      return { phase: "done", icon: "skill", label: name ? `Installed skill ${quote(name)}` : "Installed skill", detail: host };
    }
    default: {
      const human = humanizeToolName(toolName);
      if (running) return { phase: "running", icon: "generic", label: `Running ${human}` };
      if (failed || softError) return { phase: "error", icon: "generic", label: `${capitalize(human)} failed`, errorText: softError ?? errorText };
      return { phase: "done", icon: "generic", label: `Ran ${human}` };
    }
  }
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** The short noun for a tool — used by the disclosure heading. */
export function toolNoun(toolName: string): string {
  return TOOL_NOUNS[toolName] ?? capitalize(humanizeToolName(toolName));
}

/**
 * Compact JSON for the input/output disclosure: pretty-printed, but cut at
 * `max` characters with an ellipsis so a 200-row SQL result can't balloon the
 * transcript. Strings and primitives are shown as-is.
 */
export function compactJson(value: unknown, max = 1500): string {
  let text: string;
  if (value === undefined) return "";
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Seconds a reasoning stretch took, rounded for the "Thought for N s" label
 * (never 0 — anything under a second reads as "1 s"). */
export function reasoningSeconds(startedAt: number, endedAt: number): number {
  const ms = Math.max(0, endedAt - startedAt);
  return Math.max(1, Math.round(ms / 1000));
}
