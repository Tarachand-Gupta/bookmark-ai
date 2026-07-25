import { randomUUID } from "node:crypto";
import type { CreateSessionInput, Session, SessionTab } from "@bookmark-ai/types";
import { createSession, getSession, renameSession as renameSessionQuery, type Db } from "@bookmark-ai/db";
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

/** How many tabs feed the AI naming prompt — bounds token cost on huge snapshots. */
const AI_NAME_TAB_CAP = 40;

/**
 * Suggest and APPLY a concise human title for a saved session, derived from its
 * tabs. Asks Gemini when a client is available; otherwise (and on any AI
 * failure) falls back to a heuristic — so this can never 500. Returns the
 * renamed session plus a `fallback` flag (true = heuristic name), mirroring how
 * search/categorize signal degraded results. Returns null when the id is unknown.
 */
export async function suggestSessionName(
  db: Db,
  gemini: GeminiClient | null,
  id: string,
): Promise<{ session: Session; fallback: boolean } | null> {
  const session = await getSession(db, id);
  if (!session) return null;

  let name: string | null = null;
  let fallback = true;
  if (gemini && session.tabs.length > 0) {
    try {
      name = await aiSessionName(gemini, session.tabs);
      fallback = false;
    } catch (err) {
      console.warn(`[suggestSessionName] Gemini failed, using heuristic: ${(err as Error).message}`);
    }
  }
  name ??= heuristicSessionName(session.tabs, session.tabCount);

  const updated = await renameSessionQuery(db, id, name);
  // Between the load and the write the session could vanish (concurrent delete).
  if (!updated) return null;
  return { session: updated, fallback };
}

async function aiSessionName(gemini: GeminiClient, tabs: SessionTab[]): Promise<string> {
  const lines = tabs.slice(0, AI_NAME_TAB_CAP).map((t) => {
    const title = (t.title || "").trim().slice(0, 120);
    const domain = domainOf(t.url);
    return `- ${title || t.url.slice(0, 120)}${domain ? ` (${domain})` : ""}`;
  });
  const prompt = [
    "Name this saved group of browser tabs with a concise, human title.",
    "Rules: 2-5 words, Title Case, no quotes, no trailing punctuation. Capture the shared theme (topic, project, or task) across the tabs.",
    "",
    `Tabs (${tabs.length} total, showing up to ${AI_NAME_TAB_CAP}):`,
    ...lines,
  ].join("\n");

  const result = await gemini.generateJson<{ name: string }>(prompt, {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  });
  const name = (result.name ?? "").trim().replace(/^["']|["']$/g, "").slice(0, 200);
  if (!name) throw new Error("Gemini returned an empty name");
  return name;
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
