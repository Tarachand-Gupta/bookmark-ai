import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { ensureSchema } from "@bookmark-ai/db";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyBookmarkImportBatch,
  getBookmarkImportReceipt,
  previewBookmarkImport,
} from "../../../packages/engine/src/bookmark-import";
import type { BookmarkImportApplyRequest } from "@bookmark-ai/types";

const databases: ReturnType<typeof createClient>[] = [];
const directories: string[] = [];
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bmk-import-test-"));
  directories.push(directory);
  const db = createClient({ url: `file:${join(directory, "fixture.db")}` });
  databases.push(db);
  await ensureSchema(db);
  return db;
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
const batch = (
  overrides: Partial<BookmarkImportApplyRequest> = {},
): BookmarkImportApplyRequest => ({
  action: "apply",
  requestId: randomUUID(),
  browser: "chrome",
  device: "desktop",
  preserveFolders: true,
  items: [
    {
      key: "a",
      url: "https://example.com/docs",
      title: "Original title",
      folderPath: ["Work", "Research"],
      savedAt: "2024-01-01T00:00:00.000Z",
    },
  ],
  ...overrides,
});

describe("bookmark import transactions", () => {
  it("previews without writes, preserves hierarchy and original timestamps", async () => {
    const db = await fixture();
    const input = batch();
    const preview = await previewBookmarkImport(db, {
      action: "preview",
      source: "browser",
      items: input.items,
    });
    expect(preview.existingCount).toBe(0);
    expect((await db.execute("SELECT COUNT(*) AS n FROM bookmarks")).rows[0].n).toBe(0);
    const result = await applyBookmarkImportBatch(db, input);
    expect(result.imported).toBe(1);
    expect((await db.execute("SELECT title, saved_at FROM bookmarks")).rows[0]).toMatchObject({
      title: "Original title",
      saved_at: "2024-01-01T00:00:00.000Z",
    });
    const folders = await db.execute(
      "SELECT name, parent_id FROM organization_folders ORDER BY rowid",
    );
    expect(folders.rows.map((row) => row.name)).toEqual(["Work", "Research"]);
    expect(folders.rows[1].parent_id).not.toBeNull();
    expect(
      (await db.execute("SELECT folder_id FROM bookmark_organization")).rows[0].folder_id,
    ).not.toBeNull();
  });
  it("replays exact receipts and rejects changed payloads under the same request ID", async () => {
    const db = await fixture();
    const input = batch();
    const first = await applyBookmarkImportBatch(db, input);
    expect(await applyBookmarkImportBatch(db, input)).toEqual(first);
    expect(await getBookmarkImportReceipt(db, input.requestId)).toEqual(first);
    await expect(
      applyBookmarkImportBatch(db, { ...input, preserveFolders: false }),
    ).rejects.toThrow("different links");
    expect((await db.execute("SELECT COUNT(*) AS n FROM bookmarks")).rows[0].n).toBe(1);
  });
  it("leaves all existing bookmark content and organization untouched", async () => {
    const db = await fixture();
    const input = batch();
    await applyBookmarkImportBatch(db, input);
    const before = await db.execute("SELECT * FROM bookmarks");
    const organization = await db.execute("SELECT * FROM bookmark_organization");
    const result = await applyBookmarkImportBatch(
      db,
      batch({
        items: [
          {
            ...input.items[0],
            title: "Replacement title",
            folderPath: ["Different"],
            savedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    expect(result.existing).toBe(1);
    expect(result.imported).toBe(0);
    expect((await db.execute("SELECT * FROM bookmarks")).rows).toEqual(before.rows);
    expect((await db.execute("SELECT * FROM bookmark_organization")).rows).toEqual(
      organization.rows,
    );
    expect((await db.execute("SELECT COUNT(*) AS n FROM organization_folders")).rows[0].n).toBe(2);
  });
  it("rolls back one failed row and its folders, then retries only that row", async () => {
    const db = await fixture();
    await db.execute(
      "CREATE TRIGGER reject_fixture BEFORE INSERT ON bookmarks WHEN NEW.url = 'https://fail.test/' BEGIN SELECT RAISE(ABORT, 'fixture rejection'); END",
    );
    const input = batch();
    input.items.push({
      key: "b",
      url: "https://fail.test/",
      title: "Failure",
      folderPath: ["Must not exist"],
    });
    const result = await applyBookmarkImportBatch(db, input);
    expect(result).toMatchObject({ imported: 1, failed: 1 });
    expect(
      (
        await db.execute(
          "SELECT COUNT(*) AS n FROM organization_folders WHERE name = 'Must not exist'",
        )
      ).rows[0].n,
    ).toBe(0);
    await db.execute("DROP TRIGGER reject_fixture");
    const retry = await applyBookmarkImportBatch(db, batch({ items: [input.items[1]] }));
    expect(retry.imported).toBe(1);
  });
  it("isolates receipts and duplicates by tenant", async () => {
    const one = await fixture();
    const two = await fixture();
    const input = batch();
    await applyBookmarkImportBatch(one, input);
    expect(await getBookmarkImportReceipt(two, input.requestId)).toBeNull();
    expect((await applyBookmarkImportBatch(two, input)).imported).toBe(1);
  });
});

function measureDatabase(db: Awaited<ReturnType<typeof fixture>>) {
  let calls = 0;
  const measured = new Proxy(db, {
    get(target, key) {
      if (key === "transaction")
        return async (...args: Parameters<typeof db.transaction>) => {
          calls++;
          const tx = await target.transaction(...args);
          return new Proxy(tx, {
            get(transaction, operation) {
              const value = Reflect.get(transaction, operation);
              if (["execute", "batch", "commit", "rollback"].includes(String(operation)))
                return (...input: unknown[]) => {
                  calls++;
                  return value.apply(transaction, input);
                };
              return typeof value === "function" ? value.bind(transaction) : value;
            },
          });
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: measured, calls: () => calls };
}

describe("hosted import request budget", () => {
  it("counts database round trips for 100 links sharing a source folder", async () => {
    const db = await fixture();
    const measurement = measureDatabase(db);
    const measured = measurement.db;
    const started = performance.now();
    const result = await applyBookmarkImportBatch(
      measured,
      batch({
        items: Array.from({ length: 100 }, (_, index) => ({
          key: String(index),
          url: `https://fixture.test/${index}`,
          title: `Fixture ${index}`,
          folderPath: ["Work", "Research"],
        })),
      }),
    );
    expect(result.imported).toBe(100);
    console.info("100-row import measured", {
      databaseCalls: measurement.calls(),
      localMilliseconds: Math.round(performance.now() - started),
    });
    expect(measurement.calls()).toBeLessThanOrEqual(15);
  });
  it("bisects a failed row without leaking its folders, labels or overrides", async () => {
    const db = await fixture();
    await db.execute(
      "CREATE TRIGGER reject_budget BEFORE INSERT ON bookmarks WHEN NEW.url = 'https://github.com/rejected' BEGIN SELECT RAISE(ABORT, 'fixture rejection'); END",
    );
    const measurement = measureDatabase(db);
    const input = batch({
      items: Array.from({ length: 100 }, (_, index) => ({
        key: String(index),
        url: index === 43 ? "https://github.com/rejected" : `https://fixture.test/${index}`,
        title: index === 43 ? "typescript" : `Fixture ${index}`,
        folderPath: index === 43 ? ["Failed only"] : ["Work", "Research"],
      })),
    });
    const result = await applyBookmarkImportBatch(measurement.db, input);
    expect(result).toMatchObject({ imported: 99, failed: 1 });
    expect(result.items[43].status).toBe("failed");
    expect(
      (await db.execute("SELECT COUNT(*) AS n FROM organization_folders WHERE name='Failed only'"))
        .rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.execute(
          "SELECT COUNT(*) AS n FROM organization_labels WHERE name IN ('Development','typescript','github')",
        )
      ).rows[0].n,
    ).toBe(0);
    expect((await db.execute("SELECT COUNT(*) AS n FROM bookmark_organization")).rows[0].n).toBe(
      99,
    );
    expect(
      (await db.execute("SELECT COUNT(*) AS n FROM bookmarks WHERE title LIKE 'Fixture%'")).rows[0]
        .n,
    ).toBe(99);
    expect(
      (
        await db.execute(
          "SELECT COUNT(*) AS n FROM bookmark_organization WHERE json_extract(overrides_json,'$.title')=1",
        )
      ).rows[0].n,
    ).toBe(99);
    console.info("100-row import with one rejected row", { databaseCalls: measurement.calls() });
    expect(measurement.calls()).toBeLessThanOrEqual(70);
    await db.execute("DROP TRIGGER reject_budget");
    const retry = await applyBookmarkImportBatch(db, batch({ items: [input.items[43]] }));
    expect(retry.imported).toBe(1);
  });

  it("records retryable definitive failures when the work budget is spent", async () => {
    const db = await fixture();
    const input = batch();
    const clock = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(31_000);
    let result;
    try {
      result = await applyBookmarkImportBatch(db, input);
    } finally {
      clock.mockRestore();
    }
    expect(result).toMatchObject({ imported: 0, failed: 1 });
    expect(await getBookmarkImportReceipt(db, input.requestId)).toEqual(result);
    expect((await db.execute("SELECT COUNT(*) AS n FROM organization_folders")).rows[0].n).toBe(0);
    expect((await applyBookmarkImportBatch(db, batch({ items: input.items }))).imported).toBe(1);
  });
});
