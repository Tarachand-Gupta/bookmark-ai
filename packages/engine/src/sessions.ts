import { randomUUID } from "node:crypto";
import type { CreateSessionInput, Session } from "@bookmark-ai/types";
import { createSession, type Db } from "@bookmark-ai/db";

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
