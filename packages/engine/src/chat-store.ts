import { randomUUID } from "node:crypto";
import {
  deleteConversation,
  getConversation,
  insertConversation,
  insertMessage,
  listConversations,
  listMessages,
  touchConversation,
  type Db,
} from "@bookmark-ai/db";
import type { ChatConversation, StoredChatMessage } from "@bookmark-ai/types";

/**
 * Chat persistence orchestration (id generation, title derivation, ordering).
 * Thin logic over the `packages/db` chat query module — the route stays an
 * adapter. Operates on the caller's tenant DB.
 */

/** A minimal UIMessage as it arrives from the client / AI SDK. */
export interface IncomingChatMessage {
  id?: string;
  role: string;
  parts?: unknown[];
}

const MAX_TITLE_LEN = 60;

/** Flatten a UIMessage's text parts into a single string. */
export function messageText(message: IncomingChatMessage | undefined): string {
  if (!message?.parts) return "";
  return message.parts
    .map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text ?? "") : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Derive a conversation title from the first user message text (trimmed ~60 chars). */
export function deriveConversationTitle(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "New chat";
  return t.length > MAX_TITLE_LEN ? `${t.slice(0, MAX_TITLE_LEN - 1).trimEnd()}…` : t;
}

/** Create a new conversation with a derived title. Returns the stored record. */
export async function createConversationRecord(db: Db, titleText: string): Promise<ChatConversation> {
  const now = new Date().toISOString();
  const conversation: ChatConversation = {
    id: randomUUID(),
    title: deriveConversationTitle(titleText),
    createdAt: now,
    updatedAt: now,
  };
  await insertConversation(db, conversation);
  return conversation;
}

/** Look up a conversation, or null if it doesn't exist. */
export async function getConversationRecord(db: Db, id: string): Promise<ChatConversation | null> {
  return getConversation(db, id);
}

/** All conversations, newest updated first. */
export async function listConversationRecords(db: Db): Promise<ChatConversation[]> {
  return listConversations(db);
}

/** Delete a conversation and its messages. Returns whether it existed. */
export async function deleteConversationRecord(db: Db, id: string): Promise<boolean> {
  return deleteConversation(db, id);
}

/** Load a conversation with its full message history (oldest first). */
export async function loadConversationRecord(
  db: Db,
  id: string,
): Promise<{ conversation: ChatConversation; messages: StoredChatMessage[] } | null> {
  const conversation = await getConversation(db, id);
  if (!conversation) return null;
  const rows = await listMessages(db, id);
  const messages: StoredChatMessage[] = rows.map((r) => ({ id: r.id, role: r.role, parts: r.parts }));
  return { conversation, messages };
}

/**
 * Persist one message (user or assistant) and bump the conversation's
 * `updated_at`. A missing message id is filled with a fresh UUID.
 */
export async function appendChatMessage(
  db: Db,
  conversationId: string,
  message: IncomingChatMessage,
): Promise<void> {
  const now = new Date().toISOString();
  // Treat a blank/whitespace id as MISSING, not as a valid key. `?? randomUUID()`
  // alone doesn't catch "" — and an empty-string id is exactly what the AI SDK
  // produces for a response message when no id generator is configured, which
  // would make every assistant turn collide on the same primary key (INSERT OR
  // REPLACE) and wipe all but the last. Belt-and-braces with the route's
  // generateMessageId so no blank id can ever reach the PK.
  const id = typeof message.id === "string" && message.id.trim() !== "" ? message.id : randomUUID();
  await insertMessage(db, {
    id,
    conversationId,
    role: message.role,
    parts: message.parts ?? [],
    createdAt: now,
  });
  await touchConversation(db, conversationId, now);
}
