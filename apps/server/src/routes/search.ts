import { Router } from "express";
import { searchQuerySchema } from "@bookmark-ai/types";
import type { Db } from "@bookmark-ai/db";
import { performSearch, type GeminiClient } from "@bookmark-ai/engine";
import { asyncHandler } from "../lib/async-handler.js";
import { badRequest } from "../lib/http-error.js";

export function searchRouter(db: Db, gemini: GeminiClient | null): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = searchQuerySchema.safeParse(req.query);
      if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid query");
      res.json(await performSearch(db, gemini, parsed.data));
    }),
  );

  return router;
}
