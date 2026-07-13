import { Router } from "express";
import { searchQuerySchema, type SearchResponse } from "@bookmark-ai/types";
import {
  mergeHybrid,
  searchFullText,
  searchSessions,
  searchVector,
  type Db,
} from "@bookmark-ai/db";
import { asyncHandler } from "../lib/async-handler.js";
import { badRequest } from "../lib/http-error.js";
import { embedQuery } from "../services/embeddings.js";
import type { GeminiClient } from "../services/gemini.js";

export function searchRouter(db: Db, gemini: GeminiClient | null): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = searchQuerySchema.safeParse(req.query);
      if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid query");
      const { q, mode, limit } = parsed.data;

      // Sessions match by plain text in both modes (they have no embeddings);
      // results ride alongside so clients can present the two kinds distinctly.
      const sessionsPromise = searchSessions(db, q, 5).catch((err: Error) => {
        console.warn(`[search] session search failed: ${err.message}`);
        return [];
      });

      // Hybrid mode runs both rankings and fuses them (RRF): exact keyword
      // hits and meaning-level matches compete on rank, not raw score. When
      // embeddings are unavailable it degrades to the full-text list alone
      // (fallback: true).
      if (mode === "hybrid") {
        const textPromise = searchFullText(db, q, limit);
        let vectorResults: Awaited<ReturnType<typeof searchVector>> = [];
        let degraded = true;
        if (gemini) {
          try {
            const vector = await embedQuery(gemini, q);
            vectorResults = await searchVector(db, vector, limit);
            degraded = false;
          } catch (err) {
            console.warn(`[search] hybrid embed failed, text only: ${(err as Error).message}`);
          }
        }
        const body: SearchResponse = {
          mode: "hybrid",
          results: mergeHybrid(await textPromise, vectorResults, limit),
          sessionResults: await sessionsPromise,
          ...(degraded ? { fallback: true } : {}),
        };
        res.json(body);
        return;
      }

      // AI mode embeds the query and ranks by cosine similarity; it degrades
      // to full-text transparently when no Gemini key is configured or the
      // embed call fails.
      if (mode === "ai" && gemini) {
        try {
          const vector = await embedQuery(gemini, q);
          const results = await searchVector(db, vector, limit);
          const body: SearchResponse = {
            mode: "ai",
            results,
            sessionResults: await sessionsPromise,
          };
          res.json(body);
          return;
        } catch (err) {
          console.warn(`[search] AI search failed, falling back: ${(err as Error).message}`);
        }
      }

      const results = await searchFullText(db, q, limit);
      const body: SearchResponse = {
        mode: "text",
        results,
        sessionResults: await sessionsPromise,
        ...(mode === "ai" ? { fallback: true } : {}),
      };
      res.json(body);
    }),
  );

  return router;
}
