import { randomUUID } from "node:crypto";
import type { Bookmark, CreateBookmarkInput } from "@bookmark-ai/types";
import { insertBookmark, type Db } from "@bookmark-ai/db";
import type { GeminiClient } from "./gemini.js";
import { scrapeOpenGraph } from "./og.js";
import { categorize } from "./categorize.js";

/**
 * The full save pipeline: scrape OG data → AI categorize → persist.
 * Embedding happens asynchronously afterwards (see embed worker) so saves
 * stay fast even when Gemini is slow.
 */
export async function ingestBookmark(
  db: Db,
  gemini: GeminiClient | null,
  input: CreateBookmarkInput,
): Promise<Bookmark> {
  const url = new URL(input.url);
  const domain = url.hostname.replace(/^www\./, "");
  const scraped = await scrapeOpenGraph(input.url);

  const title = scraped.title ?? input.title ?? domain;
  const description = scraped.description;

  const { category, tags } = await categorize(gemini, {
    url: input.url,
    domain,
    title,
    description,
    og: scraped.og,
  });

  const now = new Date().toISOString();
  return insertBookmark(db, {
    id: randomUUID(),
    url: input.url,
    domain,
    title,
    description,
    og: scraped.og,
    source: {
      browser: input.browser,
      device: input.device,
      deviceName: input.deviceName ?? null,
      os: input.os ?? null,
      savedAt: input.savedAt ?? now,
    },
    category,
    tags,
    createdAt: now,
  });
}
