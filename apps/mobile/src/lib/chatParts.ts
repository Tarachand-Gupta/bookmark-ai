import type { SymbolViewProps } from "expo-symbols";

/**
 * How a UIMessage's parts become things the thread can draw — pure functions,
 * no React, so the grouping and the per-tool copy are unit-testable.
 *
 * The AI SDK's part union is huge and version-coupled (text, reasoning, files,
 * sources, per-tool variants, data parts), so everything here reads a LOOSE
 * shape where every field is optional: a part this build doesn't know about —
 * including one written by a NEWER server — renders nothing instead of crashing
 * the thread.
 */
export interface LoosePart {
  type: string;
  text?: string;
  state?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  mediaType?: string;
  filename?: string;
  url?: string;
}

/** A `file` part as the transcript needs it (attachments on a USER turn). */
export interface FilePartLike {
  mediaType: string;
  filename?: string;
  url: string;
}

export interface UserContent {
  /** Every text part joined — a user turn is one thing the person typed. */
  text: string;
  files: FilePartLike[];
}

export function userContent(parts: readonly LoosePart[]): UserContent {
  let text = "";
  const files: FilePartLike[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      text += part.text ?? "";
    } else if (
      part.type === "file" &&
      typeof part.url === "string" &&
      typeof part.mediaType === "string"
    ) {
      files.push({ mediaType: part.mediaType, filename: part.filename, url: part.url });
    }
  }
  return { text: text.trim(), files };
}

/** The AI SDK tool lifecycle, collapsed to the four states a row draws. */
export type ToolPhase = "input-streaming" | "input-available" | "output-available" | "output-error";

export function toolPhase(state: string | undefined): ToolPhase {
  switch (state) {
    case "input-streaming":
      return "input-streaming";
    case "output-available":
      return "output-available";
    case "output-error":
      return "output-error";
    default:
      // input-available, approval-requested/-responded, or a state this build
      // doesn't know: the call is in flight.
      return "input-available";
  }
}

export interface ToolPartLike {
  type: string;
  toolCallId?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export type AssistantBlock =
  | { kind: "text"; key: string; text: string }
  | { kind: "reasoning"; key: string; text: string; streaming: boolean }
  | { kind: "tool"; key: string; part: ToolPartLike };

export function isToolPart(type: string): boolean {
  return type.startsWith("tool-") || type === "dynamic-tool";
}

/**
 * Group an assistant message's parts into renderable blocks, IN ORDER (a tool
 * row appears exactly where the agent ran it). Adjacent `reasoning` parts merge
 * into one disclosure — Gemini streams a thought per paragraph and a row of five
 * "Thinking" chevrons is noise. `step-start`, `source-*`, `file`, `data-*` and
 * unknown types are dropped. Keys are stable across streaming updates: a
 * reasoning block is keyed by the index of its FIRST part, a tool row by its
 * call id.
 */
export function assistantBlocks(messageId: string, parts: readonly LoosePart[]): AssistantBlock[] {
  const blocks: AssistantBlock[] = [];
  parts.forEach((part, i) => {
    if (part.type === "text") {
      const text = part.text ?? "";
      if (!text.trim()) return;
      blocks.push({ kind: "text", key: `${messageId}-t${i}`, text });
      return;
    }
    if (part.type === "reasoning") {
      const text = part.text ?? "";
      const streaming = part.state === "streaming";
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "reasoning") {
        last.text = joinReasoning(last.text, text);
        last.streaming = last.streaming || streaming;
        return;
      }
      // A finished, empty thought has nothing to disclose.
      if (!text.trim() && !streaming) return;
      blocks.push({ kind: "reasoning", key: `${messageId}-r${i}`, text, streaming });
      return;
    }
    if (isToolPart(part.type)) {
      blocks.push({ kind: "tool", key: part.toolCallId ?? `${messageId}-c${i}`, part });
    }
  });
  return blocks;
}

function joinReasoning(a: string, b: string): string {
  if (!a.trim()) return b;
  if (!b.trim()) return a;
  return `${a.trimEnd()}\n\n${b.trimStart()}`;
}

/** Label for the reasoning disclosure. Persisted parts carry no timing, so a
 * reopened conversation reads "Thoughts" rather than inventing a duration. */
export function thoughtLabel(streaming: boolean, seconds: number | null): string {
  if (streaming) return "Thinking";
  if (seconds === null) return "Thoughts";
  if (seconds >= 90) return `Thought for ${Math.round(seconds / 60)} min`;
  return `Thought for ${Math.max(1, Math.round(seconds))} s`;
}

// ── Tool rows ─────────────────────────────────────────────────────────────────

export interface ToolRowCopy {
  label: string;
  symbol: SymbolViewProps["name"];
  fallback: string;
  /** The red state. The server never emits `output-error`: EVERY tool failure
   * (a blocked address, a bad query, an unknown skill) arrives as
   * `output-available` whose output carries a string `error`. Both shapes land
   * here, and the row draws them identically — red, with `error` shown. */
  failed: boolean;
  error: string | null;
}

interface ToolSpec {
  symbol: SymbolViewProps["name"];
  fallback: string;
  running: (input: unknown) => string;
  done: (output: unknown, input: unknown) => string;
  failed: (input: unknown) => string;
}

const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…` : s;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

const quote = (s: string) => `“${truncate(s, 60)}”`;

/** `https://www.example.com/a/b` → `example.com`; anything unparsable comes back as-is. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

/** One entry per tool in the agent's `tools` map (apps/web/app/api/chat/route.ts);
 * the key is the raw tool name (a part's type is `tool-${name}`). Copy per the
 * shared contract, so a row here and its web/macOS counterpart read the same. */
const TOOLS: Record<string, ToolSpec> = {
  searchBookmarks: {
    symbol: "magnifyingglass",
    fallback: "⌕",
    running: (input) => {
      const q = str(obj(input).query);
      return q ? `Searching bookmarks for ${quote(q)}` : "Searching bookmarks";
    },
    done: (output) => {
      const n = arr(obj(output).results).length;
      return n === 0 ? "No bookmarks found" : `Found ${plural(n, "bookmark", "bookmarks")}`;
    },
    failed: () => "Search failed",
  },
  queryDatabase: {
    symbol: "tablecells",
    fallback: "▦",
    running: () => "Querying your library",
    done: (output) => {
      const out = obj(output);
      const n = num(out.rowCount) ?? arr(out.rows).length;
      const truncated = out.truncated === true;
      return `${n.toLocaleString()}${truncated ? "+" : ""} ${n === 1 && !truncated ? "row" : "rows"}`;
    },
    failed: () => "Query failed",
  },
  listSessions: {
    symbol: "square.stack",
    fallback: "▤",
    running: () => "Listing saved sessions",
    done: (output) => {
      const out = obj(output);
      return plural(num(out.total) ?? arr(out.sessions).length, "session", "sessions");
    },
    failed: () => "Couldn't list sessions",
  },
  listLiveTabs: {
    symbol: "dot.radiowaves.left.and.right",
    fallback: "◉",
    running: () => "Checking live tabs",
    done: (output) => {
      const out = obj(output);
      if (out.enabled === false) return "Live sharing is off";
      const devices = arr(out.devices);
      const tabs = devices.reduce<number>((sum, d) => sum + (num(obj(d).tabCount) ?? 0), 0);
      return `${plural(tabs, "tab", "tabs")} on ${plural(devices.length, "device", "devices")}`;
    },
    failed: () => "Live tabs unavailable",
  },
  webSearch: {
    symbol: "globe",
    fallback: "◍",
    running: (input) => {
      const q = str(obj(input).query);
      return q ? `Searching the web for ${quote(q)}` : "Searching the web";
    },
    done: (output) => plural(arr(obj(output).results).length, "source", "sources"),
    failed: () => "Web search failed",
  },
  fetchUrl: {
    symbol: "doc.text",
    fallback: "▥",
    running: (input) => {
      const url = str(obj(input).url);
      return url ? `Reading ${hostOf(url)}` : "Reading page";
    },
    done: (output, input) => {
      const title = str(obj(output).title);
      const url = str(obj(output).url) ?? str(obj(input).url);
      return `Read ${title ? truncate(title, 70) : url ? hostOf(url) : "page"}`;
    },
    failed: (input) => {
      const url = str(obj(input).url);
      return url ? `Couldn't read ${hostOf(url)}` : "Couldn't read page";
    },
  },
  useSkill: {
    symbol: "sparkles",
    fallback: "✦",
    running: (input) => {
      const name = str(obj(input).name);
      return name ? `Loading skill ${quote(name)}` : "Loading skill";
    },
    done: (output, input) => {
      const name = str(obj(output).name) ?? str(obj(input).name);
      return name ? `Using skill ${quote(name)}` : "Using skill";
    },
    failed: (input) => {
      const name = str(obj(input).name);
      return name ? `Skill ${quote(name)} not found` : "Skill not found";
    },
  },
  // The agent writing a skill for the user (management stays a web/macOS
  // surface — the phone only narrates the step).
  createSkill: {
    symbol: "square.and.pencil",
    fallback: "✎",
    running: (input) => {
      const name = str(obj(input).name);
      return name ? `Creating skill ${quote(name)}` : "Creating skill";
    },
    done: (output, input) => {
      const name = str(obj(output).name) ?? str(obj(input).name);
      return name ? `Created skill ${quote(name)}` : "Created skill";
    },
    failed: (input) => {
      const name = str(obj(input).name);
      return name ? `Couldn't create skill ${quote(name)}` : "Couldn't create skill";
    },
  },
  installSkill: {
    symbol: "arrow.down.circle",
    fallback: "⇩",
    running: (input) => {
      const url = str(obj(input).url);
      return url ? `Installing skill from ${hostOf(url)}` : "Installing skill";
    },
    done: (output) => {
      const name = str(obj(output).name);
      return name ? `Installed skill ${quote(name)}` : "Installed skill";
    },
    failed: (input) => {
      const url = str(obj(input).url);
      return url ? `Couldn't install skill from ${hostOf(url)}` : "Couldn't install skill";
    },
  },
};

/** `searchBookmarks` → "search bookmarks" — for tools this build has no copy for. */
function humanize(name: string): string {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

function genericSpec(name: string): ToolSpec {
  const words = humanize(name) || "tool";
  return {
    symbol: "sparkles",
    fallback: "✦",
    running: () => `Running ${words}`,
    done: () => `${words.charAt(0).toUpperCase()}${words.slice(1)} finished`,
    failed: () => `${words.charAt(0).toUpperCase()}${words.slice(1)} failed`,
  };
}

/** The raw tool name behind a part: `tool-<name>`, or `toolName` for dynamic tools. */
export function toolName(part: { type: string; toolName?: string }): string {
  if (part.type === "dynamic-tool") return part.toolName ?? "tool";
  return part.type.startsWith("tool-") ? part.type.slice(5) : part.type;
}

export function toolRowCopy(part: ToolPartLike): ToolRowCopy {
  const name = toolName(part);
  const spec = TOOLS[name] ?? genericSpec(name);
  const base = { symbol: spec.symbol, fallback: spec.fallback, failed: false, error: null };
  switch (toolPhase(part.state)) {
    case "output-error":
      return {
        ...base,
        label: spec.failed(part.input),
        failed: true,
        error: str(part.errorText) ?? "The tool failed.",
      };
    case "output-available": {
      const err = str(obj(part.output).error);
      if (err) return { ...base, label: spec.failed(part.input), failed: true, error: err };
      return { ...base, label: spec.done(part.output, part.input) };
    }
    default:
      return { ...base, label: spec.running(part.input) };
  }
}

/** Pretty-printed input args for the row's disclosure; null when there are none
 * (listLiveTabs takes no parameters — an empty `{}` block is clutter). */
export function formatToolInput(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input === "object" && !Array.isArray(input) && Object.keys(input).length === 0) {
    return null;
  }
  try {
    return truncate(JSON.stringify(input, null, 2), 1200);
  } catch {
    return String(input);
  }
}

function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return "∅";
  if (typeof cell === "object") {
    try {
      return JSON.stringify(cell);
    } catch {
      return String(cell);
    }
  }
  return String(cell);
}

function bullets(items: string[], total: number, shown: number): string {
  if (items.length === 0) return "Nothing found";
  return total > shown ? [...items, `… and ${total - shown} more`].join("\n") : items.join("\n");
}

/** A compact, human summary of a tool's output for the disclosure — the answer
 * itself is the payload, this is just "what did the step see". */
export function summarizeToolOutput(name: string, output: unknown): string | null {
  if (output === undefined) return null;
  const out = obj(output);
  const err = str(out.error);
  if (err) return err;
  switch (name) {
    case "searchBookmarks": {
      const results = arr(out.results);
      return bullets(
        results.slice(0, 6).map((r) => {
          const b = obj(r);
          const title = str(b.title) ?? str(b.url) ?? "Untitled";
          const category = str(b.category);
          return `• ${truncate(title, 80)}${category ? ` · ${category}` : ""}`;
        }),
        results.length,
        6,
      );
    }
    case "queryDatabase": {
      const columns = arr(out.columns).map(cellText);
      const rows = arr(out.rows).slice(0, 6);
      const lines = [
        columns.join(" | "),
        ...rows.map((r) => arr(r).map(cellText).join(" | ")),
      ].filter((l) => l.length > 0);
      return lines.length > 0 ? truncate(lines.join("\n"), 800) : "No rows";
    }
    case "listSessions": {
      const sessions = arr(out.sessions);
      return bullets(
        sessions.slice(0, 6).map((s) => {
          const x = obj(s);
          const tabs = num(x.tabCount);
          return `• ${truncate(str(x.name) ?? "Untitled", 80)}${
            tabs !== null ? ` · ${plural(tabs, "tab", "tabs")}` : ""
          }`;
        }),
        num(out.total) ?? sessions.length,
        6,
      );
    }
    case "listLiveTabs": {
      if (out.enabled === false) return "Live tab sharing is off for this account.";
      const devices = arr(out.devices);
      return bullets(
        devices.slice(0, 8).map((d) => {
          const x = obj(d);
          return `• ${str(x.label) ?? "Device"} · ${plural(num(x.tabCount) ?? 0, "tab", "tabs")}`;
        }),
        devices.length,
        8,
      );
    }
    case "webSearch": {
      const results = arr(out.results);
      return bullets(
        results.slice(0, 6).map((r) => {
          const x = obj(r);
          const url = str(x.url);
          return `• ${truncate(str(x.title) ?? url ?? "Untitled", 80)}${url ? ` — ${hostOf(url)}` : ""}`;
        }),
        results.length,
        6,
      );
    }
    case "fetchUrl": {
      const title = str(out.title);
      const text = str(out.text);
      const summary = [title, text ? truncate(text, 400) : null].filter(Boolean).join("\n");
      return summary || null;
    }
    case "useSkill": {
      const instructions = str(out.instructions);
      return instructions ? truncate(instructions, 400) : null;
    }
    case "createSkill":
    case "installSkill": {
      // What the skill is, not its instructions — those belong to the skills
      // page on the web/macOS, where a skill is managed.
      const name = str(out.name);
      const description = str(out.description);
      const summary = [name, description ? truncate(description, 300) : null]
        .filter(Boolean)
        .join("\n");
      return summary || null;
    }
    default:
      try {
        return truncate(JSON.stringify(output, null, 2), 800);
      } catch {
        return null;
      }
  }
}
