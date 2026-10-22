import { randomUUID } from "node:crypto";
import {
  getBookmark,
  getSession,
  listBookmarks,
  listDevices,
  json,
  type Db,
  type SqlExecutor,
} from "@bookmark-ai/db";
import type {
  ChatContext,
  ComposerHandoffInput,
  ComposerHandoff,
  Bookmark,
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
  if (context.type === "folder") {
    const exists = await db.execute({
      sql: "SELECT id FROM organization_folders WHERE id=? AND deleted=0",
      args: [context.folderId],
    });
    if (!exists.rows.length)
      resolved.unavailable.push({ id: context.folderId, reason: "Folder is no longer available" });
    else {
      const data = await listBookmarks(db, {
        folderId: context.folderId,
        includeSubfolders: context.includeSubfolders,
        limit: 10001,
        offset: 0,
      });
      if (data.total > 10000)
        throw new OrganizationError(
          "context-too-large",
          "Select a smaller folder or explicit bookmarks.",
          422,
        );
      for (const b of data.bookmarks) {
        resolved.bookmarkIds!.push(b.id);
        resolved.sources.push({ id: b.id, title: b.title, url: b.url });
      }
    }
  }
  if (context.type === "page")
    resolved.sources.push({ id: "page", title: context.title, url: context.url });
  if (context.type === "session") {
    const s = await getSession(db, context.sessionId);
    if (!s)
      resolved.unavailable.push({
        id: context.sessionId,
        reason: "Session is no longer available",
      });
    else
      for (const [i, t] of s.tabs.entries())
        if (/^https?:\/\//i.test(t.url))
          resolved.sources.push({ id: `${s.id}:${i}`, title: t.title, url: t.url });
  }
  if (context.type === "live_window") {
    const device = (await listDevices(db, new Date(Date.now() - 7 * 86400000).toISOString())).find(
      (d) => d.deviceId === context.deviceId,
    );
    const window = device?.windows.find((w) => w.windowId === context.windowId);
    if (!window)
      resolved.unavailable.push({
        id: `${context.deviceId}:${context.windowId}`,
        reason: "Shared window is no longer available",
      });
    else
      for (const [i, t] of window.tabs.entries())
        if (/^https?:\/\//i.test(t.url))
          resolved.sources.push({
            id: `${context.deviceId}:${context.windowId}:${i}`,
            title: t.title,
            url: t.url,
          });
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
      draft: json(r.draft_json, {} as ComposerHandoffInput["draft"]),
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
