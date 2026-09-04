import { randomUUID } from "node:crypto";
import {
  deleteConversation,
  getConversation,
  getMessageConversationId,
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

/**
 * Does a message carry anything the model or a transcript can use? Text or
 * reasoning with content, any tool part (`tool-*` / `dynamic-tool`), a file, a
 * source. `step-start`, empty text and unknown parts don't count — a provider
 * error mid-stream (an invalid own key, a 429) leaves an assistant message that
 * is `step-start`-only, and persisting/replaying it produces blank turns.
 */
export function hasMeaningfulParts(parts: unknown[] | undefined): boolean {
  if (!Array.isArray(parts)) return false;
  return parts.some((p) => {
    if (!p || typeof p !== "object") return false;
    const part = p as { type?: unknown; text?: unknown };
    const type = typeof part.type === "string" ? part.type : "";
    if (type === "text" || type === "reasoning") {
      return typeof part.text === "string" && part.text.trim() !== "";
    }
    return (
      type === "file" ||
      type === "dynamic-tool" ||
      type === "source-url" ||
      type === "source-document" ||
      type.startsWith("tool-")
    );
  });
}

/** Drop assistant turns with nothing in them; user (and other) messages are always kept. */
export function pruneEmptyAssistantMessages<T extends { role: string; parts?: unknown[] }>(
  messages: T[],
): T[] {
  return messages.filter((m) => m.role !== "assistant" || hasMeaningfulParts(m.parts));
}

/**
 * The stored history + the incoming message(s), as the model should see them:
 * a stored copy of an incoming id is replaced by the incoming version (a
 * regenerate re-sends the same user message, which was already persisted
 * before the failed turn), and empty assistant turns are dropped.
 */
export function mergeConversationMessages<T extends { id?: string; role: string; parts?: unknown[] }>(
  history: T[],
  incoming: T[],
): T[] {
  const incomingIds = new Set(incoming.map((m) => m.id).filter((id): id is string => typeof id === "string" && id !== ""));
  const kept = history.filter((m) => !(typeof m.id === "string" && incomingIds.has(m.id)));
  return pruneEmptyAssistantMessages([...kept, ...incoming]);
}

/** Flatten a UIMessage's text parts into a single string. */
export function messageText(message: IncomingChatMessage | undefined): string {
  if (!message?.parts) return "";
  return message.parts
    .map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text ?? "") : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The text a conversation title is derived from: the message's text, else the
 * first attachment's filename (an attachment-only message — a dropped
 * README.md or a pasted screenshot — must not become "New chat"), else "".
 */
export function messageTitleText(message: IncomingChatMessage | undefined): string {
  const text = messageText(message);
  if (text) return text;
  const file = message?.parts?.find(
    (p): p is { type: "file"; filename?: unknown } =>
      !!p && typeof p === "object" && (p as { type?: unknown }).type === "file",
  );
  if (!file) return "";
  const filename = typeof file.filename === "string" ? file.filename.trim() : "";
  return filename || "Attachment";
}

/** Derive a conversation title from the first user message text (trimmed ~60 chars). */
export function deriveConversationTitle(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "New chat";
  return t.length > MAX_TITLE_LEN ? `${t.slice(0, MAX_TITLE_LEN - 1).trimEnd()}…` : t;
}

/**
 * Create a new conversation with a derived title. Returns the stored record. An
 * `id` may be supplied so the caller can mint it up front (the chat route puts
 * it in the `X-Conversation-Id` response header BEFORE the insert has landed and
 * runs the insert off the critical path); otherwise a fresh UUID is used.
 */
export async function createConversationRecord(
  db: Db,
  titleText: string,
  id: string = randomUUID(),
): Promise<ChatConversation> {
  const now = new Date().toISOString();
  const conversation: ChatConversation = {
    id,
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
 * `updated_at`. A missing message id is filled with a fresh UUID. Returns the
 * id the row was stored under (it can differ from `message.id` — see below).
 */
export async function appendChatMessage(
  db: Db,
  conversationId: string,
  message: IncomingChatMessage,
): Promise<{ id: string }> {
  const now = new Date().toISOString();
  // Treat a blank/whitespace id as MISSING, not as a valid key. `?? randomUUID()`
  // alone doesn't catch "" — and an empty-string id is exactly what the AI SDK
  // produces for a response message when no id generator is configured, which
  // would make every assistant turn collide on the same primary key (INSERT OR
  // REPLACE) and wipe all but the last. Belt-and-braces with the route's
  // generateMessageId so no blank id can ever reach the PK.
  let id = typeof message.id === "string" && message.id.trim() !== "" ? message.id : randomUUID();
  // INTEGRITY: ids are CLIENT-supplied for user turns and chat_messages is keyed
  // on the id alone, so a client that re-uses an id across conversations (a
  // buggy id generator, a replayed request) would otherwise REPLACE the row —
  // relocating the old conversation's turn into the new one and orphaning the
  // old thread. Scope the id to its conversation: an id that already lives in a
  // DIFFERENT conversation gets a fresh one; a same-conversation re-send (a
  // retry after a network error) still upserts in place. Assistant ids are
  // server-minted per response, but the guard applies to every role.
  const owner = await getMessageConversationId(db, id);
  if (owner && owner !== conversationId) id = randomUUID();
  await insertMessage(db, {
    id,
    conversationId,
    role: message.role,
    parts: message.parts ?? [],
    createdAt: now,
  });
  await touchConversation(db, conversationId, now);
  return { id };
}
