import { Router } from "express";
import { createBookmarkSchema, listBookmarksQuerySchema } from "@bookmark-ai/types";
import { deleteBookmark, getBookmark, listBookmarks, type Db } from "@bookmark-ai/db";
import { asyncHandler } from "../lib/async-handler.js";
import { badRequest, notFound } from "../lib/http-error.js";
import { enrichBookmark, saveBookmarkFast, type GeminiClient } from "@bookmark-ai/engine";

export function bookmarksRouter(
  db: Db,
  gemini: GeminiClient | null,
  onSaved: () => void,
): Router {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = createBookmarkSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid body");
      // Instant save → 201; OG scrape + AI categorization enrich the row
      // afterwards (clients see the richer tags on their next fetch).
      const bookmark = await saveBookmarkFast(db, parsed.data);
      res.status(201).json({ bookmark });
      void enrichBookmark(db, gemini, bookmark.id, parsed.data)
        .catch((err: Error) =>
          console.warn(`[enrich] ${bookmark.url}: ${err.message} — keeping instant-save data`),
        )
        // Kick the embed worker either way: enrichment cleared the embedding,
        // and even a failed enrichment leaves heuristic text worth embedding.
        .finally(() => onSaved());
    }),
  );

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = listBookmarksQuerySchema.safeParse(req.query);
      if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid query");
      const result = await listBookmarks(db, parsed.data);
      res.json(result);
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const bookmark = await getBookmark(db, req.params.id ?? "");
      if (!bookmark) throw notFound("Bookmark not found");
      res.json({ bookmark });
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const deleted = await deleteBookmark(db, req.params.id ?? "");
      if (!deleted) throw notFound("Bookmark not found");
      res.status(204).end();
    }),
  );

  return router;
}
