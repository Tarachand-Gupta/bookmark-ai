import type { Bookmark, Session } from "@bookmark-ai/types";
import {
  EMBEDDING_DIM,
  listUnembedded,
  listUnembeddedSessions,
  storeEmbedding,
  storeSessionEmbedding,
  type Db,
} from "@bookmark-ai/db";
import type { GeminiClient } from "./gemini";
import { traced } from "./tracing";

/** Text representation of a bookmark fed to the embedding model. */
export function bookmarkToEmbeddingText(b: Bookmark): string {
  return [
    b.title,
    b.description ?? "",
    b.og.siteName ?? "",
    b.category,
    b.tags.join(" "),
    b.domain,
    b.url,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function embedQuery(gemini: GeminiClient, query: string): Promise<number[]> {
  return gemini.embed(query, EMBEDDING_DIM);
}

/** Embed one bookmark and persist the vector. */
export async function embedBookmark(gemini: GeminiClient, db: Db, b: Bookmark): Promise<void> {
  return traced("embed", "embed-bookmark", { input: { id: b.id, url: b.url } }, async () => {
    const vector = await gemini.embed(bookmarkToEmbeddingText(b), EMBEDDING_DIM);
    await storeEmbedding(db, b.id, vector);
  });
}

/** How many tabs of a session feed its embedding — bounds token cost on a
 * 500-tab snapshot while still covering what such a window is "about". */
const EMBED_TAB_CAP = 30;

/**
 * Text representation of a SAVED SESSION fed to the embedding model: its name,
 * its AI description, and the titles + hostnames of its first `EMBED_TAB_CAP`
 * tabs.
 *
 * The description carries most of the meaning (a name is often just
 * "Aug 11, 1:22 am · 37 tabs"), but tab text is included because a session is
 * embedded on save, BEFORE the summary exists, and again after it lands — the
 * pre-summary vector still has to be worth something. Hostnames, not full URLs:
 * query strings and path ids are noise in embedding space, and the tab title
 * already says what the page was.
 */
export function sessionToEmbeddingText(s: Session): string {
  const tabs = s.tabs.slice(0, EMBED_TAB_CAP).map((t) => {
    const host = hostnameOf(t.url);
    const title = (t.title ?? "").trim();
    return [title, host].filter(Boolean).join(" — ");
  });
  return [s.name, s.description ?? "", ...tabs].filter(Boolean).join("\n");
}

/** Embed one saved session and persist the vector. */
export async function embedSession(gemini: GeminiClient, db: Db, s: Session): Promise<void> {
  return traced("embed", "embed-session", { input: { id: s.id, name: s.name } }, async () => {
    const vector = await gemini.embed(sessionToEmbeddingText(s), EMBEDDING_DIM);
    await storeSessionEmbedding(db, s.id, vector);
  });
}

/**
 * One-shot sweep: embed up to `limit` rows that have no vector yet — bookmarks
 * first, then saved sessions with whatever budget is left. Per-row failures are
 * logged and skipped so one bad row can't stall the rest. Returns how many were
 * embedded IN TOTAL, which keeps the drain loops that call this in a
 * `while (batch === BATCH)` (the post-save hooks and the daily cron) working
 * unchanged: a full batch still means "there may be more".
 *
 * Bookmarks keep priority because they are the primary search surface and far
 * more numerous; a session backlog therefore drains once bookmarks are caught
 * up, bounded by the caller's own caps.
 */
export async function embedPending(gemini: GeminiClient, db: Db, limit = 10): Promise<number> {
  // One sweep = one span; the per-row embed-bookmark/embed-session spans nest.
  return traced(
    "embed",
    "embed-sweep",
    { metadata: { limit }, output: (embedded) => ({ embedded }) },
    async () => {
      const pending = await listUnembedded(db, limit);
      let embedded = 0;
      for (const b of pending) {
        try {
          await embedBookmark(gemini, db, b);
          embedded++;
          console.log(`[embed] ${b.id} ${b.domain}`);
        } catch (err) {
          console.warn(`[embed] failed for ${b.id}: ${(err as Error).message}`);
        }
      }

      const sessionBudget = limit - pending.length;
      if (sessionBudget <= 0) return embedded;
      const pendingSessions = await listUnembeddedSessions(db, sessionBudget);
      for (const s of pendingSessions) {
        try {
          await embedSession(gemini, db, s);
          embedded++;
          console.log(`[embed] session ${s.id} (${s.tabCount} tabs)`);
        } catch (err) {
          console.warn(`[embed] failed for session ${s.id}: ${(err as Error).message}`);
        }
      }
      return embedded;
    },
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
