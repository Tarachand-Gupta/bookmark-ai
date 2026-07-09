import { Router } from "express";
import { getMeta, type Db } from "@bookmark-ai/db";
import { asyncHandler } from "../lib/async-handler.js";

export function metaRouter(db: Db, aiEnabled: boolean): Router {
  const router = Router();

  router.get(
    "/meta",
    asyncHandler(async (_req, res) => {
      res.json(await getMeta(db));
    }),
  );

  router.get("/health", (_req, res) => {
    res.json({ ok: true, ai: aiEnabled });
  });

  return router;
}
