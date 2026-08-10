import { randomUUID } from "node:crypto";
import type { CreateSessionInput, Session, SessionTab } from "@bookmark-ai/types";
import {
  applySessionSummary,
  createSession,
  getSession,
  renameSession as renameSessionQuery,
  type Db,
} from "@bookmark-ai/db";
import type { GeminiClient } from "./gemini";

/** Persist a saved browser session (snapshot of open tabs). */
export async function saveSession(db: Db, input: CreateSessionInput): Promise<Session> {
  const now = new Date().toISOString();
  const savedAt = input.savedAt ?? now;
  const name = input.name?.trim() || defaultName(savedAt, input.tabs.length);
  return createSession(db, {
    id: randomUUID(),
    name,
    tabs: input.tabs,
    browser: input.browser,
    device: input.device,
    os: input.os ?? null,
    savedAt,
    createdAt: now,
  });
}

/**
 * Rename a saved session. Returns the updated session, or null when the id
 * doesn't exist (the route maps that to a 404). Thin adapter over the db query.
 */
export async function renameSession(db: Db, id: string, name: string): Promise<Session | null> {
  return renameSessionQuery(db, id, name.trim());
}

/** How many tabs feed the AI summary prompt — bounds token cost on huge snapshots. */
const AI_NAME_TAB_CAP = 40;

/** Hard caps on what we persist, whatever the model returns (the prompt asks for
 * these too — this is the belt to that suspenders). */
export const SESSION_NAME_MAX = 80;
export const SESSION_DESCRIPTION_MAX = 220;

/** The AI's read of a saved session: its title plus 1-2 sentences of context. */
export interface SessionSummary {
  name: string;
  description: string;
}

/**
 * Does this session name look machine-generated rather than typed by a human?
 *
 * The post-save enrichment may replace an AUTO name with an AI one but must
 * NEVER clobber a name the user chose, and the clients don't flag which is
 * which — so the shapes they generate are recognized here, server-side:
 *  - `saveSession`'s own default (client sent no name): "Aug 11, 3:42 PM · 8 tabs",
 *    or "Session · 8 tabs" when `savedAt` is unparseable.
 *  - the mobile save-window path (`SessionsScreen.saveWindow`) and the web
 *    Ongoing view's per-window Save: "<device label> · Window 2".
 * Anything else — including a blank/whitespace name — is treated as the user's.
 *
 * Deliberately anchored patterns: a name merely CONTAINING "· 4 tabs" mid-string
 * ("Verilog · 4 tabs of docs") stays the user's.
 */
export function isAutoSessionName(name: string | null | undefined): boolean {
  const trimmed = (name ?? "").trim();
  if (trimmed === "") return true; // nothing to protect
  // "<anything with a digit in it, i.e. a timestamp> · N tabs" or "Session · N tabs".
  if (/^(?:session\s*|[^·]*\d[^·]*)·\s*\d+\s+tabs?$/i.test(trimmed)) return true;
  // "<device label> · Window 2" (mobile + web Ongoing promote).
  if (/·\s*window\s+\d+$/i.test(trimmed)) return true;
  return false;
}

/**
 * Prompt for one Gemini call that produces BOTH the title and the description.
 * Pure (no I/O) so its shape is unit-testable.
 *
 * The title rules deliberately ALLOW a comma-separated multi-theme title: a
 * 100-tab window is often three unrelated jobs at once, and squashing it into
 * one noun phrase ("Various Research") destroys the only information the user
 * wanted. `currentName` is passed only when it's a name the user typed (see
 * `isAutoSessionName`) — a machine default is noise, not signal.
 */
export function buildSessionSummaryPrompt(tabs: SessionTab[], currentName?: string): string {
  const shown = tabs.slice(0, AI_NAME_TAB_CAP);
  const lines = shown.map((t) => {
    const title = (t.title || "").trim().slice(0, 120);
    const domain = domainOf(t.url);
    return `- ${title || t.url.slice(0, 120)}${domain ? ` (${domain})` : ""}`;
  });
  const userLabel = currentName?.trim();
  return [
    "You are labelling a saved snapshot of someone's open browser tabs.",
    "Return a title and a description of what this window of tabs was about.",
    "",
    "TITLE:",
    `- At most ${SESSION_NAME_MAX} characters. Title Case. No quotes, no trailing punctuation.`,
    "- Use the tabs' own vocabulary: real topic, product, library, company or task names.",
    '- Never generic filler ("Various Tabs", "Web Browsing", "Mixed Research", "Miscellaneous").',
    "- One clear theme → one tight phrase, e.g. “Verilog FPGA Timing Closure”.",
    "- Several unrelated themes → list them comma-separated, most prominent first, at most 4,",
    "  e.g. “Verilog Research, Google Cloud Billing, YouTube Tutorials”. Do NOT force unrelated",
    "  tabs into a single label.",
    "",
    "DESCRIPTION:",
    `- 1-2 sentences, at most ${SESSION_DESCRIPTION_MAX - 20} characters total.`,
    "- Say what the person was doing and name the standout sites or topics.",
    '- Plain and factual. No preamble like "This session contains…", no marketing tone.',
    // Observed in QA: without this the model opens every summary with "The user
    // was…", which reads like a report about the reader rather than a note to them.
    '- Describe the window directly. Never open with "The user", "This session" or "The person".',
    ...(userLabel
      ? [
          "",
          `The user's own label for this group is “${userLabel.slice(0, 120)}” — useful context for`,
          "vocabulary, but write the title from the tabs themselves.",
        ]
      : []),
    "",
    `Tabs (${tabs.length} total, showing ${shown.length}):`,
    ...lines,
  ].join("\n");
}

/**
 * Validate + clamp a raw model response into a `SessionSummary`. Pure; returns
 * null when the model gave nothing usable for the title (the caller then treats
 * the whole call as a failure and falls back to the heuristic name).
 */
export function parseSessionSummary(raw: unknown): SessionSummary | null {
  const obj = (raw ?? {}) as { name?: unknown; description?: unknown };
  const name = clamp(stripQuotes(typeof obj.name === "string" ? obj.name : ""), SESSION_NAME_MAX);
  if (!name) return null;
  const description = clampSentences(
    stripQuotes(typeof obj.description === "string" ? obj.description : ""),
    SESSION_DESCRIPTION_MAX,
  );
  return { name, description };
}

/**
 * ONE Gemini call → `{name, description}` for a window of tabs. Returns null
 * (never throws) when there is no AI key, nothing to summarize, or the call
 * fails — callers keep whatever name they already had, mirroring the `fallback`
 * semantics used by categorize/search.
 */
export async function summarizeSession(
  gemini: GeminiClient | null,
  tabs: SessionTab[],
  currentName?: string,
): Promise<SessionSummary | null> {
  if (!gemini || tabs.length === 0) return null;
  try {
    const raw = await gemini.generateJson<{ name?: string; description?: string }>(
      buildSessionSummaryPrompt(tabs, currentName),
      {
        type: "object",
        properties: { name: { type: "string" }, description: { type: "string" } },
        required: ["name", "description"],
      },
    );
    return parseSessionSummary(raw);
  } catch (err) {
    console.warn(`[summarizeSession] Gemini failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Summarize a saved session and APPLY the result: the explicit "Summarize"
 * affordance (POST /api/sessions/:id/ai-name). Always rewrites the name — the
 * user asked for it by clicking — and stores the description alongside. With no
 * AI available it degrades to the heuristic name and a null description, so this
 * can never 500; `fallback: true` reports that. Returns null on an unknown id.
 */
export async function summarizeSessionById(
  db: Db,
  gemini: GeminiClient | null,
  id: string,
): Promise<{ session: Session; fallback: boolean } | null> {
  const session = await getSession(db, id);
  if (!session) return null;

  const summary = await summarizeSession(
    gemini,
    session.tabs,
    isAutoSessionName(session.name) ? undefined : session.name,
  );
  const updated = await applySessionSummary(db, id, {
    name: summary?.name ?? heuristicSessionName(session.tabs, session.tabCount),
    // A failed/absent AI call must not wipe a description generated earlier.
    description: summary ? summary.description || null : session.description,
  });
  // Between the load and the write the session could vanish (concurrent delete).
  if (!updated) return null;
  return { session: updated, fallback: summary === null };
}

/**
 * Post-save enrichment (Next `after()` in POST /api/sessions): give a freshly
 * saved session its AI description, plus an AI title when the name it was saved
 * with was machine-generated. Runs AFTER the 201 so saves stay ~50ms.
 *
 * Never throws and never overwrites a user-typed name. Returns the updated
 * session, or null when there was nothing to do (no AI key, AI failed, row gone).
 */
export async function enrichSessionSummary(
  db: Db,
  gemini: GeminiClient | null,
  id: string,
): Promise<Session | null> {
  if (!gemini) return null;
  const session = await getSession(db, id);
  if (!session) return null;

  const auto = isAutoSessionName(session.name);
  const hint = auto ? undefined : session.name;
  let summary = await summarizeSession(gemini, session.tabs, hint);
  if (!summary && session.tabs.length > 0) {
    // ONE retry. Observed failure in QA (2026-08-11): Gemini occasionally blows
    // the client's 20s timeout, and unlike bookmark embeddings there is no cron
    // sweep behind this path — the only other route to a summary is the user
    // noticing and clicking Summarize. A single cheap second attempt keeps the
    // "every save gets a title" promise honest; if it also fails we leave the
    // saved name/description exactly as they were.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    summary = await summarizeSession(gemini, session.tabs, hint);
  }
  if (!summary) return null;
  return applySessionSummary(db, id, {
    // Only an auto name is replaceable; a name the user typed is theirs.
    ...(auto ? { name: summary.name } : {}),
    description: summary.description || null,
  });
}

/** Heuristic title: most-frequent domain + remaining tab count, e.g. "github.com + 5 more". */
function heuristicSessionName(tabs: SessionTab[], tabCount: number): string {
  const counts = new Map<string, number>();
  for (const t of tabs) {
    const d = domainOf(t.url);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let top: string | null = null;
  let topN = 0;
  for (const [d, n] of counts) {
    if (n > topN) {
      top = d;
      topN = n;
    }
  }
  if (!top) return `Session · ${tabCount} tab${tabCount === 1 ? "" : "s"}`;
  const rest = tabCount - topN;
  return rest > 0 ? `${top} + ${rest} more` : top;
}

function stripQuotes(s: string): string {
  return s.trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
}

/** Clamp to `max` characters on a word boundary, adding an ellipsis when cut. */
function clamp(s: string, max: number): string {
  const text = s.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\-–—]$/, "")}…`;
}

/**
 * Clamp prose: prefer dropping the trailing PARTIAL sentence over cutting a word
 * in half, so an over-long description reads as finished rather than truncated
 * ("…deploying containers to Cloud Run." beats "…with some browsing on Hacker…").
 * Falls back to the word-boundary ellipsis when no sentence end lands late
 * enough to keep most of the text.
 */
function clampSentences(s: string, max: number): string {
  const text = s.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  const lastEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
    /[.!?]$/.test(window) ? window.length - 1 : -1,
  );
  // 60 chars ≈ one real sentence: enough to stand alone as the summary. Below
  // that, dropping the rest would lose too much, so ellipsize instead.
  if (lastEnd >= 60) return text.slice(0, lastEnd + 1).trim();
  return clamp(text, max);
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A friendly fallback name when the client doesn't supply one. */
function defaultName(savedAt: string, count: number): string {
  const d = new Date(savedAt);
  const when = Number.isNaN(d.getTime())
    ? "Session"
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
  return `${when} · ${count} tab${count === 1 ? "" : "s"}`;
}
