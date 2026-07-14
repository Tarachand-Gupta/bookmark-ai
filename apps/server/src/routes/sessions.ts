import { Router } from "express";
import { createSessionSchema } from "@bookmark-ai/types";
import { deleteSession, getSession, listSessions, type Db } from "@bookmark-ai/db";
import { saveSession } from "@bookmark-ai/engine";
import { asyncHandler } from "../lib/async-handler.js";
import { badRequest, notFound } from "../lib/http-error.js";

/** CRUD for saved browser sessions (snapshots of open tabs). */
export function sessionsRouter(db: Db): Router {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = createSessionSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid body");
      const session = await saveSession(db, parsed.data);
      res.status(201).json({ session });
    }),
  );

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const sessions = await listSessions(db);
      res.json({ sessions });
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const session = await getSession(db, req.params.id ?? "");
      if (!session) throw notFound("Session not found");
      res.json({ session });
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const deleted = await deleteSession(db, req.params.id ?? "");
      if (!deleted) throw notFound("Session not found");
      res.status(204).end();
    }),
  );

  return router;
}
