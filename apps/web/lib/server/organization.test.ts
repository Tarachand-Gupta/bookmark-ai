import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import {
  ensureSchema,
  runMigrations,
  TENANT_MIGRATIONS,
  insertBookmark,
  getBookmark,
  updateBookmarkContent,
  listBookmarks,
  type Db,
} from "@bookmark-ai/db";
import {
  executeOrganizationOperation,
  editBookmark,
  undoOrganizationOperation,
  retryOrganizationOperation,
  getOrganizationOperation,
  getOrganization,
  createOrganizationSelection,
  saveBookmarkWithOperation,
  createComposerHandoff,
  claimComposerHandoff,
  resolveChatContext,
  exportUserData,
  importUserData,
  createConversationRecord,
  appendChatMessage,
  persistTurnContext,
  loadConversationRecord,
  deleteConversationRecord,
  runReadOnlySql,
} from "@bookmark-ai/engine";
let db: Db, dir: string;
let seq = 0;
const op = () => `test-operation-${++seq}`;
async function seed(id: string, tags: string[] = []) {
  return insertBookmark(db, {
    id,
    url: `https://example.invalid/${id}`,
    domain: "example.invalid",
    title: id,
    description: null,
    og: {},
    source: { browser: "other", device: "other", savedAt: "2026-10-01T00:00:00.000Z" },
    category: "Research",
    tags,
    createdAt: "2026-10-01T00:00:00.000Z",
  });
}
async function folder(name: string, parentId: string | null = null) {
  const r = await executeOrganizationOperation(db, {
    operationId: op(),
    action: "folder.create",
    name,
    parentId,
  });
  expect(r.status).toBe("completed");
  expect(r.results[0]).toMatchObject({ entityType: "folder", label: name });
  return r.entityId!;
}
async function label(name: string, kind: "tag" | "category" = "tag") {
  const r = await executeOrganizationOperation(db, {
    operationId: op(),
    action: kind === "tag" ? "tag.create" : "category.create",
    name,
  });
  expect(r.status).toBe("completed");
  expect(r.results[0]).toMatchObject({ entityType: kind, label: name });
  return r.entityId!;
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmai-organization-"));
  db = createClient({ url: `file:${join(dir, "test.db")}` });
  await ensureSchema(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
describe("organization persistence and conflicts", () => {
  it("seeds legacy reading state once and replays migrations safely", async () => {
    const legacy = createClient({ url: `file:${join(dir, "legacy.db")}` });
    try {
      await runMigrations(
        legacy,
        TENANT_MIGRATIONS.filter((m) => m.version < 15),
      );
      await legacy.execute(
        "INSERT INTO bookmarks(id,url,domain,title,saved_at,saved_day,created_at,tags_json) VALUES('old','https://old.invalid','old.invalid','old','2026-10-01','2026-10-01','2026-10-01','[\"reading\",\"keep\"]')",
      );
      await ensureSchema(legacy);
      expect((await getBookmark(legacy, "old"))?.readingState).toBe("unread");
      await editBookmark(legacy, "old", {
        operationId: op(),
        changes: { readingState: "not_on_list" },
      });
      await ensureSchema(legacy);
      expect((await getBookmark(legacy, "old"))?.readingState).toBe("not_on_list");
      expect((await getBookmark(legacy, "old"))?.tags).toEqual(["reading", "keep"]);
    } finally {
      legacy.close();
    }
  });
  it("preserves manual title/category and removed generated tags through enrichment and resave", async () => {
    await seed("a", ["generated", "keep"]);
    const cat = await label("My category", "category");
    await label("Manual");
    await editBookmark(db, "a", {
      operationId: op(),
      changes: { title: "Mine", categoryId: cat, tags: ["keep", "Manual"] },
    });
    await updateBookmarkContent(db, "a", {
      title: "AI title",
      description: "new",
      og: {},
      category: "AI category",
      tags: ["generated", "other"],
    });
    expect(await getBookmark(db, "a")).toMatchObject({
      title: "Mine",
      category: "My category",
      tags: ["other", "keep", "Manual"],
    });
    await seed("a", ["generated"]);
    expect(await getBookmark(db, "a")).toMatchObject({
      title: "Mine",
      category: "My category",
      tags: ["keep", "Manual"],
    });
  });
  it("single edit validation is atomic; expected fields reject stale edits only", async () => {
    await seed("a");
    const original = (await getBookmark(db, "a"))!;
    await editBookmark(db, "a", { operationId: op(), changes: { readingState: "read" } });
    const good = await editBookmark(db, "a", {
      operationId: op(),
      expected: original.fieldVersions,
      changes: { title: "changed" },
    });
    expect(good.status).toBe("completed");
    const stale = await editBookmark(db, "a", {
      operationId: op(),
      expected: original.fieldVersions,
      changes: { title: "stale" },
    });
    expect(stale.results[0]?.status).toBe("conflict");
    const failed = await editBookmark(db, "a", {
      operationId: op(),
      changes: { title: "should not write", folderId: "missing" },
    });
    expect(failed.status).toBe("failed");
    expect((await getBookmark(db, "a"))?.title).toBe("changed");
  });
  it("replays exact operation IDs and rejects changed payloads", async () => {
    await seed("a");
    const input = { operationId: op(), changes: { title: "Edit" } };
    const first = await editBookmark(db, "a", input);
    expect(await editBookmark(db, "a", input)).toEqual(first);
    await expect(
      editBookmark(db, "a", { ...input, changes: { title: "Other" } }),
    ).rejects.toMatchObject({ code: "operation-id-reused" });
  });
  it("save receipts recover same bookmark and prevent repeat enrichment", async () => {
    const input = {
      operationId: op(),
      url: "https://save.invalid",
      browser: "other" as const,
      device: "other" as const,
    };
    const first = await saveBookmarkWithOperation(db, input);
    const second = await saveBookmarkWithOperation(db, input);
    expect(first.bookmark.id).toBe(second.bookmark.id);
    expect(second.replayed).toBe(true);
    expect(first.operation?.results[0]).toMatchObject({
      entityType: "bookmark",
      label: first.bookmark.title,
    });
    expect((await listBookmarks(db, { limit: 100, offset: 0 })).total).toBe(1);
  });
  it("validates folder cycles/siblings, removes only folder membership, and undoes", async () => {
    const p = await folder("Parent"),
      c = await folder("Child", p),
      dest = await folder("Destination");
    await seed("a");
    await editBookmark(db, "a", { operationId: op(), changes: { folderId: p } });
    expect(
      (
        await executeOrganizationOperation(db, {
          operationId: op(),
          action: "folder.update",
          id: p,
          parentId: c,
        })
      ).status,
    ).toBe("failed");
    const remove = await executeOrganizationOperation(db, {
      operationId: op(),
      action: "folder.remove",
      id: p,
      destinationId: dest,
      children: "destination",
    });
    expect(remove.status).toBe("completed");
    expect((await getBookmark(db, "a"))?.folderId).toBe(dest);
    expect((await getOrganization(db)).folders.find((f) => f.id === c)?.parentId).toBe(dest);
    expect((await undoOrganizationOperation(db, remove.id, op())).status).toBe("completed");
    expect((await getBookmark(db, "a"))?.folderId).toBe(p);
    expect((await getOrganization(db)).folders.find((f) => f.id === c)?.parentId).toBe(p);
  });
  it("folder removal collision leaves all content intact", async () => {
    const p = await folder("P"),
      d = await folder("D");
    await folder("Same", p);
    await folder("same", d);
    const r = await executeOrganizationOperation(db, {
      operationId: op(),
      action: "folder.remove",
      id: p,
      destinationId: d,
      children: "destination",
    });
    expect(r.status).toBe("failed");
    expect((await getOrganization(db)).folders.some((f) => f.id === p)).toBe(true);
  });
  it("renames and merges tags globally with reversible deduplication", async () => {
    await seed("a", ["left", "right"]);
    await seed("b", ["left"]);
    const info = await getOrganization(db);
    const left = info.tags.find((x) => x.name === "left")!,
      right = info.tags.find((x) => x.name === "right")!;
    const merged = await executeOrganizationOperation(db, {
      operationId: op(),
      action: "tag.merge",
      sourceId: left.id,
      targetId: right.id,
    });
    expect((await getBookmark(db, "a"))?.tags).toEqual(["right"]);
    expect(merged.results.find((r) => r.id === "a")).toMatchObject({
      entityType: "bookmark",
      label: "a",
    });
    expect(merged.results.find((r) => r.id === left.id)).toMatchObject({
      entityType: "tag",
      label: "left",
    });
    expect((await undoOrganizationOperation(db, merged.id, op())).status).toBe("completed");
    expect((await getBookmark(db, "a"))?.tags).toEqual(["left", "right"]);
    const renamed = await executeOrganizationOperation(db, {
      operationId: op(),
      action: "tag.rename",
      id: left.id,
      name: "Left new",
    });
    await updateBookmarkContent(db, "b", {
      title: "b",
      description: null,
      og: {},
      category: "Research",
      tags: ["left"],
    });
    expect((await getBookmark(db, "b"))?.tags).toEqual(["Left new"]);
    expect(renamed.status).toBe("completed");
  });
  it("bulk partial results freeze IDs, retry only failed, enforce tag limit without truncation", async () => {
    await seed("a");
    await seed(
      "b",
      Array.from({ length: 11 }, (_, i) => `tag${i}`),
    );
    await label("new");
    const selection = await createOrganizationSelection(db, { query: { limit: 100, offset: 0 } });
    await seed("later");
    const r = await executeOrganizationOperation(db, {
      operationId: op(),
      action: "bookmarks.update",
      selectionId: selection.id,
      changes: { addTags: ["new"] },
    });
    expect(r.status).toBe("partial");
    expect(r.succeededCount).toBe(1);
    expect((await getBookmark(db, "later"))?.tags).toEqual([]);
    expect((await getBookmark(db, "b"))?.tags).toHaveLength(11);
    await editBookmark(db, "b", { operationId: op(), changes: { tags: ["tag0"] } });
    const retry = await retryOrganizationOperation(db, r.id, op());
    expect(retry.requestedCount).toBe(1);
    expect(retry.status).toBe("completed");
    expect((await getBookmark(db, "b"))?.tags).toEqual(["tag0", "new"]);
  });
  it("Undo preserves unrelated later fields and reports same-field/ABA conflicts", async () => {
    await seed("a");
    await seed("b");
    const change = await executeOrganizationOperation(db, {
      operationId: op(),
      action: "bookmarks.update",
      bookmarkIds: ["a", "b"],
      changes: { readingState: "read" },
    });
    await editBookmark(db, "a", { operationId: op(), changes: { title: "Later title" } });
    await editBookmark(db, "b", { operationId: op(), changes: { readingState: "unread" } });
    await editBookmark(db, "b", { operationId: op(), changes: { readingState: "read" } });
    const undo = await undoOrganizationOperation(db, change.id, op());
    expect(undo.status).toBe("partial");
    expect(await getBookmark(db, "a")).toMatchObject({
      title: "Later title",
      readingState: "not_on_list",
    });
    expect((await getBookmark(db, "b"))?.readingState).toBe("read");
    expect((await getOrganizationOperation(db, change.id))?.undoStatus).toBe("partial");
  });
  it("rejects expired Undo and preserves newly assigned folder on creation Undo", async () => {
    const created = await executeOrganizationOperation(db, {
      operationId: op(),
      action: "folder.create",
      name: "New",
    });
    await seed("a");
    await editBookmark(db, "a", { operationId: op(), changes: { folderId: created.entityId! } });
    expect((await undoOrganizationOperation(db, created.id, op())).status).toBe("failed");
    await expect(
      undoOrganizationOperation(db, created.id, op(), new Date(Date.now() + 8 * 86400000)),
    ).rejects.toMatchObject({ code: "undo-expired" });
  });
  it("account-bound handoffs claim idempotently without sending and expire honestly", async () => {
    const request = {
      operationId: op(),
      draft: {
        text: "question",
        context: { type: "page" as const, url: "https://page.invalid", title: "Frozen" },
      },
    };
    const handoff = await createComposerHandoff(db, "account-a", request);
    expect(await createComposerHandoff(db, "account-a", request)).toEqual(handoff);
    await expect(claimComposerHandoff(db, "account-b", handoff.id)).rejects.toMatchObject({
      code: "handoff-not-found",
    });
    const first = await claimComposerHandoff(db, "account-a", handoff.id);
    expect(
      await claimComposerHandoff(db, "account-a", handoff.id, new Date(Date.now() + 86400000)),
    ).toEqual(first);
    const expired = await createComposerHandoff(
      db,
      "account-a",
      { ...request, operationId: op() },
      new Date(0),
    );
    await expect(claimComposerHandoff(db, "account-a", expired.id)).rejects.toMatchObject({
      code: "handoff-expired",
    });
  });
  it("resolves only selected context and reports missing sources", async () => {
    await seed("a");
    await seed("b");
    const resolved = await resolveChatContext(db, {
      type: "bookmarks",
      bookmarkIds: ["a", "missing"],
    });
    expect(resolved.bookmarkIds).toEqual(["a"]);
    expect(resolved.sources.map((s) => s.id)).toEqual(["a"]);
    expect(resolved.unavailable[0]?.id).toBe("missing");
  });
  it("round trips nested folders, categories, tags, reading, and manual provenance in v6", async () => {
    await seed("a", ["generated"]);
    const parent = await folder("Root"),
      child = await folder("Child", parent),
      cat = await label("Own", "category");
    await editBookmark(db, "a", {
      operationId: op(),
      changes: {
        folderId: child,
        title: "Manual",
        categoryId: cat,
        tags: [],
        readingState: "read",
      },
    });
    const bundle = await exportUserData(db, new Date().toISOString());
    expect(bundle.schemaVersion).toBe(6);
    const dest = createClient({ url: `file:${join(dir, "roundtrip.db")}` });
    try {
      await ensureSchema(dest);
      await importUserData(dest, bundle);
      const imported = (await listBookmarks(dest, { limit: 10, offset: 0 })).bookmarks[0]!;
      expect(imported).toMatchObject({
        title: "Manual",
        category: "Own",
        tags: [],
        readingState: "read",
      });
      expect(
        (await getOrganization(dest)).folders.find((f) => f.id === imported.folderId)?.path,
      ).toBe("Root / Child");
      await updateBookmarkContent(dest, imported.id, {
        title: "AI",
        description: null,
        og: {},
        category: "AI",
        tags: ["generated"],
      });
      expect(await getBookmark(dest, imported.id)).toMatchObject({
        title: "Manual",
        category: "Own",
        tags: [],
      });
    } finally {
      dest.close();
    }
  });
});

describe("organization fault boundaries and scale", () => {
  it("rolls back the bookmark if writing its organization state fails", async () => {
    await seed("atomic");
    const before = await getBookmark(db, "atomic");
    const operationId = op();
    const original = db.transaction.bind(db);
    db.transaction = async (mode?: "write" | "read" | "deferred") => {
      const tx = await original(mode);
      const execute = tx.execute.bind(tx);
      tx.execute = ((statement: any, args?: any) => {
        const sql = typeof statement === "string" ? statement : statement.sql;
        if (sql.startsWith("INSERT INTO bookmark_organization"))
          throw new Error("injected second write failure");
        return execute(typeof statement === "string" ? { sql: statement, args } : statement);
      }) as typeof tx.execute;
      return tx;
    };
    await expect(
      editBookmark(db, "atomic", {
        operationId,
        changes: { title: "must roll back", readingState: "read" },
      }),
    ).rejects.toThrow("injected");
    db.transaction = original;
    expect(await getBookmark(db, "atomic")).toEqual(before);
    expect(await getOrganizationOperation(db, operationId)).toBeNull();
  });
  it("rolls back earlier chunks when a later batch fails, then safely retries the same operation", async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `chunk-${i}`);
    await db.batch(
      ids.map((id) => ({
        sql: "INSERT INTO bookmarks(id,url,domain,title,saved_at,saved_day,created_at) VALUES(?,?,?,?,?,?,?)",
        args: [
          id,
          `https://chunk.invalid/${id}`,
          "chunk.invalid",
          id,
          "2026-10-01",
          "2026-10-01",
          "2026-10-01",
        ],
      })),
    );
    const input = {
      operationId: op(),
      action: "bookmarks.update" as const,
      bookmarkIds: ids,
      changes: { readingState: "unread" as const },
    };
    const original = db.transaction.bind(db);
    db.transaction = async (mode?: "write" | "read" | "deferred") => {
      const tx = await original(mode);
      const batch = tx.batch.bind(tx);
      let calls = 0;
      tx.batch = async (statements) => {
        if (++calls === 2) throw new Error("injected late batch failure");
        return batch(statements);
      };
      return tx;
    };
    try {
      await expect(executeOrganizationOperation(db, input)).rejects.toThrow("injected late batch");
    } finally {
      db.transaction = original;
    }
    expect(await getOrganizationOperation(db, input.operationId)).toBeNull();
    expect(
      (
        await db.execute(
          "SELECT COUNT(*) AS n FROM bookmark_organization WHERE reading_state='unread'",
        )
      ).rows[0]?.n,
    ).toBe(0);
    expect((await executeOrganizationOperation(db, input)).succeededCount).toBe(300);
  });
  it("reports field restoration when another field on the same item conflicts", async () => {
    await seed("mixed");
    const original = await editBookmark(db, "mixed", {
      operationId: op(),
      changes: { title: "first", readingState: "read" },
    });
    await editBookmark(db, "mixed", { operationId: op(), changes: { title: "newer" } });
    const undo = await undoOrganizationOperation(db, original.id, op());
    expect(undo).toMatchObject({ status: "partial", succeededFieldCount: 1, failedFieldCount: 1 });
    expect(undo.results[0]).toMatchObject({
      status: "conflict",
      entityType: "bookmark",
      label: "first",
      changedFields: ["readingState"],
      error: { fields: ["title"] },
    });
    expect(await getBookmark(db, "mixed")).toMatchObject({
      title: "newer",
      readingState: "not_on_list",
    });
  });
  it("blocks cross-tenant reads/edits even with another tenant's valid IDs", async () => {
    await seed("tenant-a");
    const other = createClient({ url: `file:${join(dir, "tenant-b.db")}` });
    try {
      await ensureSchema(other);
      const result = await editBookmark(other, "tenant-a", {
        operationId: op(),
        changes: { title: "attack" },
      });
      expect(result.status).toBe("failed");
      expect(
        (await resolveChatContext(other, { type: "bookmarks", bookmarkIds: ["tenant-a"] })).sources,
      ).toEqual([]);
      expect((await getBookmark(db, "tenant-a"))?.title).toBe("tenant-a");
    } finally {
      other.close();
    }
  });
  it("bounds bulk work and records representative local transaction timings", async () => {
    await db.batch(
      Array.from({ length: 501 }, (_, i) => ({
        sql: "INSERT INTO bookmarks(id,url,domain,title,saved_at,saved_day,created_at) VALUES(?,?,?,?,?,?,?)",
        args: [
          `bulk-${i}`,
          `https://bulk.invalid/${i}`,
          "bulk.invalid",
          `bulk ${i}`,
          "2026-10-01",
          "2026-10-01",
          "2026-10-01",
        ],
      })),
    );
    const timings: Record<string, number> = {};
    for (const n of [1, 50, 500]) {
      const started = performance.now();
      const r = await executeOrganizationOperation(db, {
        operationId: op(),
        action: "bookmarks.update",
        bookmarkIds: Array.from({ length: n }, (_, i) => `bulk-${i}`),
        changes: { readingState: n === 50 ? "read" : "unread" },
      });
      timings[String(n)] = Math.round(performance.now() - started);
      expect(r.succeededCount).toBe(n);
    }
    console.info("organization local bulk timings ms", timings);
    await expect(
      executeOrganizationOperation(db, {
        operationId: op(),
        action: "bookmarks.update",
        bookmarkIds: Array.from({ length: 501 }, (_, i) => `bulk-${i}`),
        changes: { readingState: "read" },
      }),
    ).rejects.toMatchObject({ code: "selection-too-large" });
    expect((await getBookmark(db, "bulk-500"))?.readingState).toBe("not_on_list");
  });
  it("folder filtering and search enforce descendant choice and frozen IDs", async () => {
    const { performSearch } = await import("@bookmark-ai/engine");
    const p = await folder("Research"),
      c = await folder("Child", p);
    await seed("alpha");
    await seed("beta");
    await editBookmark(db, "alpha", {
      operationId: op(),
      changes: { folderId: c, title: "common alpha" },
    });
    await editBookmark(db, "beta", { operationId: op(), changes: { title: "common beta" } });
    expect(
      (await listBookmarks(db, { folderId: p, limit: 100, offset: 0 })).bookmarks.map((b) => b.id),
    ).toEqual(["alpha"]);
    expect(
      (await listBookmarks(db, { folderId: p, includeSubfolders: false, limit: 100, offset: 0 }))
        .bookmarks,
    ).toEqual([]);
    expect(
      (
        await performSearch(db, null, {
          q: "common",
          mode: "text",
          limit: 20,
          bookmarkIds: ["alpha"],
        })
      ).results.map((r) => r.bookmark.id),
    ).toEqual(["alpha"]);
    expect(
      (await performSearch(db, null, { q: "common", mode: "text", limit: 20, bookmarkIds: [] }))
        .results,
    ).toEqual([]);
  });
  it("renaming a tag preserves prior manual suppression of that generated label", async () => {
    await seed("suppressed", ["generated"]);
    await editBookmark(db, "suppressed", { operationId: op(), changes: { tags: [] } });
    const tag = (await getOrganization(db)).tags.find((t) => t.name === "generated")!;
    await executeOrganizationOperation(db, {
      operationId: op(),
      action: "tag.rename",
      id: tag.id,
      name: "Renamed",
    });
    await updateBookmarkContent(db, "suppressed", {
      title: "suppressed",
      description: null,
      og: {},
      category: "Research",
      tags: ["Renamed", "generated"],
    });
    expect((await getBookmark(db, "suppressed"))?.tags).toEqual([]);
  });
  it("keeps a submitted context through reload/export/import and isolates unsent drafts from AI SQL", async () => {
    await seed("context-bookmark");
    const conversation = await createConversationRecord(db, "Context test");
    const turn = await appendChatMessage(db, conversation.id, {
      id: "context-turn",
      role: "user",
      parts: [{ type: "text", text: "Summarize this" }],
    });
    const resolved = await resolveChatContext(db, {
      type: "bookmarks",
      bookmarkIds: ["context-bookmark", "missing"],
    });
    await persistTurnContext(db, conversation.id, turn.id, resolved);
    await persistTurnContext(
      db,
      conversation.id,
      turn.id,
      await resolveChatContext(db, { type: "library" }),
    );
    const loaded = await loadConversationRecord(db, conversation.id);
    expect(loaded?.messages[0]).toMatchObject({
      context: { type: "bookmarks" },
      contextBookmarkIds: ["context-bookmark"],
      contextSources: [{ id: "context-bookmark" }],
      unavailableContext: [{ id: "missing" }],
    });
    const bundle = await exportUserData(db, new Date().toISOString());
    const other = createClient({ url: `file:${join(dir, "context-import.db")}` });
    try {
      await ensureSchema(other);
      await importUserData(other, bundle);
      expect((await loadConversationRecord(other, conversation.id))?.messages).toEqual(
        loaded?.messages,
      );
    } finally {
      other.close();
    }
    for (const table of [
      "composer_handoffs",
      "chat_turn_contexts",
      "organization_operations",
      "organization_selections",
      "bookmark_import_batches",
    ]) {
      await expect(runReadOnlySql(db, `SELECT * FROM ${table}`)).rejects.toThrow();
    }
    expect(await deleteConversationRecord(db, conversation.id)).toBe(true);
    expect((await db.execute("SELECT * FROM chat_turn_contexts")).rows).toHaveLength(0);
  });
  it("uses bounded round trips for structural changes and Undo across 5,000 bookmarks", async () => {
    const folderId = await folder("Imported folder");
    const tagId = await label("OriginalTag"),
      targetId = await label("SurvivorTag");
    const categoryId = await label("Research", "category");
    const count = 5000;
    for (let offset = 0; offset < count; offset += 500) {
      await db.batch(
        Array.from({ length: 500 }, (_, i) => ({
          sql: "INSERT INTO bookmarks(id,url,domain,title,saved_at,saved_day,created_at,category,tags_json) VALUES(?,?,?,?,?,?,?,?,?)",
          args: [
            `large-${offset + i}`,
            `https://large.invalid/${offset + i}`,
            "large.invalid",
            `large ${offset + i}`,
            "2026-10-01",
            "2026-10-01",
            "2026-10-01",
            "Research",
            '["OriginalTag"]',
          ],
        })),
      );
      await db.batch(
        Array.from({ length: 500 }, (_, i) => ({
          sql: "INSERT INTO bookmark_organization(bookmark_id,folder_id) VALUES(?,?)",
          args: [`large-${offset + i}`, folderId],
        })),
      );
    }
    const counts = { execute: 0, batch: 0, commit: 0 };
    const original = db.transaction.bind(db);
    db.transaction = async (mode?: "write" | "read" | "deferred") => {
      const tx = await original(mode);
      for (const method of ["execute", "batch", "commit"] as const) {
        const fn = tx[method].bind(tx);
        (tx as any)[method] = (...args: any[]) => {
          counts[method]++;
          return (fn as any)(...args);
        };
      }
      return tx;
    };
    const metrics: Record<string, { milliseconds: number; roundTrips: number; batches: number }> =
      {};
    const actions = [
      { action: "tag.rename" as const, id: tagId, name: "RenamedTag" },
      { action: "tag.merge" as const, sourceId: tagId, targetId },
      { action: "category.remove" as const, id: categoryId, replacementId: null },
      {
        action: "folder.remove" as const,
        id: folderId,
        destinationId: null,
        children: "parent" as const,
      },
    ];
    try {
      for (const action of actions) {
        counts.execute = counts.batch = counts.commit = 0;
        let started = performance.now();
        const applied = await executeOrganizationOperation(db, { operationId: op(), ...action });
        metrics[action.action] = {
          milliseconds: Math.round(performance.now() - started),
          roundTrips: counts.execute + counts.batch + counts.commit,
          batches: counts.batch,
        };
        expect(applied.status).toBe("completed");
        expect(
          applied.results.filter((r) => r.id.startsWith("large-") && r.status === "succeeded"),
        ).toHaveLength(count);
        expect(metrics[action.action]!.roundTrips).toBeLessThanOrEqual(35);
        expect(counts.batch).toBeGreaterThanOrEqual(20);
        counts.execute = counts.batch = counts.commit = 0;
        started = performance.now();
        const undone = await undoOrganizationOperation(db, applied.id, op());
        metrics[`${action.action}.undo`] = {
          milliseconds: Math.round(performance.now() - started),
          roundTrips: counts.execute + counts.batch + counts.commit,
          batches: counts.batch,
        };
        expect(undone.status).toBe("completed");
        expect(undone.succeededFieldCount).toBeGreaterThanOrEqual(count);
        expect(metrics[`${action.action}.undo`]!.roundTrips).toBeLessThanOrEqual(35);
        expect(await getBookmark(db, "large-4999")).toMatchObject({
          folderId,
          category: "Research",
          tags: ["OriginalTag"],
        });
      }
    } finally {
      db.transaction = original;
    }
    console.info("organization structural 5000 local ms / SQL transport calls", metrics);
  }, 90000);
});
