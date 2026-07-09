import { Router } from "express";
import { randomUUID } from "node:crypto";
import { createSessionSchema } from "@bookmark-ai/types";
import { createSession, deleteSession, getSession, listSessions, type Db } from "@bookmark-ai/db";
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
      const now = new Date().toISOString();
      const savedAt = parsed.data.savedAt ?? now;
      const name = parsed.data.name?.trim() || defaultName(savedAt, parsed.data.tabs.length);
      const session = await createSession(db, {
        id: randomUUID(),
        name,
        tabs: parsed.data.tabs,
        browser: parsed.data.browser,
        device: parsed.data.device,
        savedAt,
        createdAt: now,
      });
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
