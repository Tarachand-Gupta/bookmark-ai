import { randomUUID } from "node:crypto";
import { getBookmark, json, type Db, type SqlExecutor } from "@bookmark-ai/db";
import {
  chatContextSchema,
  composerHandoffSchema,
  type ChatContext,
  type ComposerHandoffInput,
  type ComposerHandoff,
} from "@bookmark-ai/types";
import { OrganizationError, requestHash } from "./organization";
export interface ResolvedChatContext {
  context: ChatContext;
  bookmarkIds: string[] | null;
  sources: { id: string; title: string; url: string }[];
  unavailable: { id: string; reason: string }[];
}
export async function resolveChatContext(
  db: Db,
  context: ChatContext,
): Promise<ResolvedChatContext> {
  context = chatContextSchema.parse(context);
  const resolved: ResolvedChatContext = {
    context,
    bookmarkIds: context.type === "library" ? null : [],
    sources: [],
    unavailable: [],
  };
  if (context.type === "bookmarks")
    for (const id of [...new Set(context.bookmarkIds)]) {
      const b = await getBookmark(db, id);
      if (b) {
        resolved.bookmarkIds!.push(id);
        resolved.sources.push({ id, title: b.title, url: b.url });
      } else resolved.unavailable.push({ id, reason: "Bookmark is no longer available" });
    }
  return resolved;
}
export async function createComposerHandoff(
  db: Db,
  accountId: string,
  input: ComposerHandoffInput,
  now = new Date(),
): Promise<ComposerHandoff> {
  const tx = await db.transaction("write");
  try {
    const hash = requestHash(input);
    const existing = (
      await tx.execute({
        sql: "SELECT * FROM composer_handoffs WHERE account_id=? AND operation_id=?",
        args: [accountId, input.operationId],
      })
    ).rows[0];
    if (existing) {
      if (String(existing.request_hash) !== hash)
        throw new OrganizationError(
          "operation-id-reused",
          "This operation ID belongs to another handoff.",
          409,
        );
      await tx.commit();
      return {
        id: String(existing.id),
        expiresAt: String(existing.expires_at),
        ...(existing.claimed_at ? { claimedAt: String(existing.claimed_at) } : {}),
      };
    }
    const id = randomUUID(),
      expiresAt = new Date(now.getTime() + 600_000).toISOString();
    await tx.execute({
      sql: "INSERT INTO composer_handoffs(id,account_id,operation_id,request_hash,draft_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",
      args: [
        id,
        accountId,
        input.operationId,
        hash,
        JSON.stringify(input.draft),
        now.toISOString(),
        expiresAt,
      ],
    });
    await tx.commit();
    return { id, expiresAt };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}
export async function claimComposerHandoff(
  db: Db,
  accountId: string,
  id: string,
  now = new Date(),
): Promise<ComposerHandoff> {
  const tx = await db.transaction("write");
  try {
    const r = (
      await tx.execute({
        sql: "SELECT * FROM composer_handoffs WHERE id=? AND account_id=?",
        args: [id, accountId],
      })
    ).rows[0];
    if (!r)
      throw new OrganizationError("handoff-not-found", "Handoff not found for this account.", 404);
    if (!r.claimed_at && String(r.expires_at) <= now.toISOString())
      throw new OrganizationError(
        "handoff-expired",
        "This handoff expired. Recreate it from the extension draft.",
        410,
      );
    const draft = composerHandoffSchema.shape.draft.safeParse(json(r.draft_json, null));
    if (!draft.success)
      throw new OrganizationError(
        "handoff-unavailable",
        "This saved context is no longer supported. Recreate the handoff.",
        410,
      );
    const claimedAt = r.claimed_at ? String(r.claimed_at) : now.toISOString();
    await tx.execute({
      sql: "UPDATE composer_handoffs SET claimed_at=COALESCE(claimed_at,?) WHERE id=? AND account_id=?",
      args: [claimedAt, id, accountId],
    });
    await tx.commit();
    return {
      id,
      expiresAt: String(r.expires_at),
      claimedAt,
      draft: draft.data,
    };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}
export async function persistTurnContext(
  db: SqlExecutor,
  conversationId: string,
  messageId: string,
  resolved: ResolvedChatContext,
) {
  await db.execute({
    sql: "INSERT OR IGNORE INTO chat_turn_contexts(conversation_id,message_id,context_json,created_at) VALUES(?,?,?,?)",
    args: [conversationId, messageId, JSON.stringify(resolved), new Date().toISOString()],
  });
}
