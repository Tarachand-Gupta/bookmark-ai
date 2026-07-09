import type { Bookmark } from "@bookmark-ai/types";
import { EMBEDDING_DIM, listUnembedded, storeEmbedding, type Db } from "@bookmark-ai/db";
import type { GeminiClient } from "./gemini.js";

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
  const vector = await gemini.embed(bookmarkToEmbeddingText(b), EMBEDDING_DIM);
  await storeEmbedding(db, b.id, vector);
}

/**
 * Background embed worker: sweeps for bookmarks without vectors. Runs right
 * after every save and on an interval, so transient Gemini failures self-heal.
 */
export function startEmbedWorker(
  gemini: GeminiClient | null,
  db: Db,
  intervalMs = 30_000,
): { kick: () => void; stop: () => void } {
  if (!gemini) {
    return { kick: () => {}, stop: () => {} };
  }
  let running = false;
  let rerun = false;

  const sweep = async () => {
    if (running) {
      // A kick landed mid-sweep — remember it so the fresh row isn't dropped.
      rerun = true;
      return;
    }
    running = true;
    try {
      const pending = await listUnembedded(db, 10);
      for (const b of pending) {
        try {
          await embedBookmark(gemini, db, b);
          console.log(`[embed] ${b.id} ${b.domain}`);
        } catch (err) {
          console.warn(`[embed] failed for ${b.id}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      // sweep runs unawaited from setInterval/kick — never let it reject.
      console.warn(`[embed] sweep failed: ${(err as Error).message}`);
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        void sweep();
      }
    }
  };

  const timer = setInterval(sweep, intervalMs);
  timer.unref?.();
  void sweep();

  return {
    kick: () => void sweep(),
    stop: () => clearInterval(timer),
  };
}
