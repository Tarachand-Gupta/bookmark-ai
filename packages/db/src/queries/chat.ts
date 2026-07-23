import type { Db } from "../client";

/**
 * Persisted AI chat storage (tenant DB) + the free-tier weekly token meter.
 *
 * A chat message stores the FULL UIMessage `parts` array verbatim as JSON
 * (`parts_json`) so tool calls, tool results, reasoning and text all round-trip
 * losslessly — the read path parses it back into a `parts` array. Conversations
 * are ordered by `updated_at` (newest first); messages by `created_at` ascending.
 */

export interface ChatConversationRow {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageRow {
  id: string;
  conversationId: string;
  role: string;
  /** The UIMessage `parts` array, parsed from `parts_json`. */
  parts: unknown[];
  createdAt: string;
}

export interface InsertConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface InsertChatMessage {
  id: string;
  conversationId: string;
  role: string;
  parts: unknown[];
  createdAt: string;
}

function rowToConversation(row: Record<string, unknown>): ChatConversationRow {
  return {
    id: String(row.id),
    title: String(row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function parseParts(raw: unknown): unknown[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToMessage(row: Record<string, unknown>): ChatMessageRow {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    role: String(row.role),
    parts: parseParts(row.parts_json),
    createdAt: String(row.created_at),
  };
}

/**
 * Insert a conversation. `INSERT OR IGNORE` keeps it idempotent (re-import of an
 * export bundle, or a client retry with a client-chosen id, is a no-op rather
 * than a primary-key throw).
 */
export async function insertConversation(db: Db, c: InsertConversation): Promise<void> {
  await db.execute({
    sql: `INSERT OR IGNORE INTO chat_conversations (id, title, created_at, updated_at)
          VALUES (?, ?, ?, ?)`,
    args: [c.id, c.title, c.createdAt, c.updatedAt],
  });
}

export async function getConversation(db: Db, id: string): Promise<ChatConversationRow | null> {
  const rs = await db.execute({
    sql: "SELECT id, title, created_at, updated_at FROM chat_conversations WHERE id = ?",
    args: [id],
  });
  const row = rs.rows[0];
  return row ? rowToConversation(row as unknown as Record<string, unknown>) : null;
}

/** All conversations, newest updated first. */
export async function listConversations(db: Db): Promise<ChatConversationRow[]> {
  const rs = await db.execute(
    "SELECT id, title, created_at, updated_at FROM chat_conversations ORDER BY updated_at DESC",
  );
  return rs.rows.map((r) => rowToConversation(r as unknown as Record<string, unknown>));
}

/** Refresh a conversation's `updated_at` (bumps it to the top of the list). */
export async function touchConversation(db: Db, id: string, updatedAt: string): Promise<void> {
  await db.execute({
    sql: "UPDATE chat_conversations SET updated_at = ? WHERE id = ?",
    args: [updatedAt, id],
  });
}

/** Delete a conversation and all its messages. Returns whether a row was removed. */
export async function deleteConversation(db: Db, id: string): Promise<boolean> {
  await db.execute({ sql: "DELETE FROM chat_messages WHERE conversation_id = ?", args: [id] });
  const rs = await db.execute({ sql: "DELETE FROM chat_conversations WHERE id = ?", args: [id] });
  return rs.rowsAffected > 0;
}

/**
 * Insert a message. `INSERT OR REPLACE` by primary key so a client retry (same
 * message id) overwrites rather than duplicating — the parts are identical on a
 * legitimate retry, and a regenerated assistant turn carries a fresh id anyway.
 */
export async function insertMessage(db: Db, m: InsertChatMessage): Promise<void> {
  await db.execute({
    sql: `INSERT OR REPLACE INTO chat_messages (id, conversation_id, role, parts_json, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [m.id, m.conversationId, m.role, JSON.stringify(m.parts ?? []), m.createdAt],
  });
}

/** All messages in a conversation, oldest first. */
export async function listMessages(db: Db, conversationId: string): Promise<ChatMessageRow[]> {
  const rs = await db.execute({
    sql: `SELECT id, conversation_id, role, parts_json, created_at
          FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC`,
    args: [conversationId],
  });
  return rs.rows.map((r) => rowToMessage(r as unknown as Record<string, unknown>));
}

// ── Free-tier weekly token meter (ai_usage) ──

/** Total tokens recorded for a given week (Monday 00:00 UTC key), 0 if none. */
export async function getWeeklyTokens(db: Db, weekStart: string): Promise<number> {
  const rs = await db.execute({
    sql: "SELECT tokens FROM ai_usage WHERE week_start = ?",
    args: [weekStart],
  });
  return Number(rs.rows[0]?.tokens ?? 0);
}

/**
 * Atomically add `tokens` to a week's counter (creating the row if needed). The
 * `INSERT OR IGNORE` + guarded `UPDATE … SET tokens = tokens + ?` pair is safe
 * under concurrent writes (Turso serializes writes per DB).
 */
export async function addWeeklyTokens(db: Db, weekStart: string, tokens: number): Promise<void> {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  await db.execute({
    sql: "INSERT OR IGNORE INTO ai_usage (week_start, tokens) VALUES (?, 0)",
    args: [weekStart],
  });
  await db.execute({
    sql: "UPDATE ai_usage SET tokens = tokens + ? WHERE week_start = ?",
    args: [Math.round(tokens), weekStart],
  });
}
