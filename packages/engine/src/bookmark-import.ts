import { createHash, randomUUID } from "node:crypto";
import {
  bookmarkOrganizationStatement,
  folderStatement,
  insertBookmarkStatement,
  labelStatement,
  normalizeOrganizationName,
  organizationFolders,
  organizationLabels,
  type Db,
  type FolderRecord,
  type LabelRecord,
} from "@bookmark-ai/db";
import {
  bookmarkImportApplyRequestSchema,
  parseBookmarkImportText,
  type BookmarkImportApplyRequest,
  type BookmarkImportPreview,
  type BookmarkImportPreviewRequest,
  type BookmarkImportResult,
} from "@bookmark-ai/types";
import { heuristicCategorize } from "./categorize";

export class BookmarkImportConflictError extends Error {
  constructor() {
    super("This import request was already used with different links. Review the import again.");
  }
}

export async function previewBookmarkImport(
  db: Db,
  input: BookmarkImportPreviewRequest,
): Promise<BookmarkImportPreview> {
  const preview = parseBookmarkImportText(input);
  // Keep parameter counts bounded for both local SQLite and hosted libSQL.
  for (let offset = 0; offset < preview.items.length; offset += 100) {
    const group = preview.items.slice(offset, offset + 100);
    const rows = await db.execute({
      sql: `SELECT url FROM bookmarks WHERE url IN (${group.map(() => "?").join(",")})`,
      args: group.map((item) => item.url),
    });
    const existing = new Set(rows.rows.map((row) => String(row.url)));
    for (const item of group)
      if (existing.has(item.url)) {
        item.status = "existing";
        preview.existingCount++;
      }
  }
  return preview;
}

export async function getBookmarkImportReceipt(
  db: Db,
  requestId: string,
): Promise<BookmarkImportResult | null> {
  const rows = await db.execute({
    sql: "SELECT result_json FROM bookmark_import_batches WHERE request_id = ?",
    args: [requestId],
  });
  return rows.rows[0]
    ? (JSON.parse(String(rows.rows[0].result_json)) as BookmarkImportResult)
    : null;
}

/** The receipt and every successful row commit together. No provider/network calls. */
export async function applyBookmarkImportBatch(
  db: Db,
  raw: BookmarkImportApplyRequest,
): Promise<BookmarkImportResult> {
  const input = bookmarkImportApplyRequestSchema.parse(raw);
  if (new Set(input.items.map((item) => item.key)).size !== input.items.length)
    throw new Error("Import row identifiers must be unique.");
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        items: input.items,
        browser: input.browser,
        device: input.device,
        preserveFolders: input.preserveFolders,
      }),
    )
    .digest("hex");
  const tx = await db.transaction("write");
  try {
    const previous = await tx.execute({
      sql: "SELECT input_hash, result_json FROM bookmark_import_batches WHERE request_id = ?",
      args: [input.requestId],
    });
    if (previous.rows[0]) {
      if (String(previous.rows[0].input_hash) !== hash) throw new BookmarkImportConflictError();
      await tx.rollback();
      return JSON.parse(String(previous.rows[0].result_json)) as BookmarkImportResult;
    }
    const result: BookmarkImportResult = {
      requestId: input.requestId,
      items: [],
      imported: 0,
      existing: 0,
      failed: 0,
    };
    const now = new Date().toISOString();
    // Bound the normal path by network round trips, not one request per field/row.
    // All preflight reads occur under this write transaction, so another import
    // cannot insert one of these URLs or rename a folder between planning and commit.
    const existingRows = await tx.execute({
      sql: `SELECT id,url FROM bookmarks WHERE url IN (${input.items.map(() => "?").join(",")})`,
      args: input.items.map((item) => item.url),
    });
    let knownUrls = new Map(existingRows.rows.map((row) => [String(row.url), String(row.id)]));
    let knownFolders = await organizationFolders(tx);
    let knownLabels = await organizationLabels(tx, true);
    const deadline = Date.now() + 30_000;
    type Statement = Parameters<typeof tx.batch>[0][number];
    type Item = BookmarkImportApplyRequest["items"][number];
    type Outcome = BookmarkImportResult["items"][number];

    const stage = (items: Item[]) => {
      const statements: Statement[] = [];
      const urls = new Map(knownUrls);
      const folders = [...knownFolders];
      const labels = [...knownLabels];
      const outcomes: Outcome[] = [];
      const folderKeys = new Map(
        folders.map((folder) => [
          JSON.stringify([folder.parentId, normalizeOrganizationName(folder.name)]),
          folder.id,
        ]),
      );
      const ensureFolder = (path: string[]) => {
        let parentId: string | null = null;
        for (const name of path) {
          const key = JSON.stringify([parentId, normalizeOrganizationName(name)]);
          let id = folderKeys.get(key);
          if (!id) {
            id = randomUUID();
            const folder: FolderRecord = {
              id,
              name: name.trim(),
              parentId,
              deleted: false,
              versions: { exists: randomUUID(), name: randomUUID(), parentId: randomUUID() },
            };
            statements.push(folderStatement(folder));
            folderKeys.set(key, id);
            folders.push(folder);
          }
          parentId = id;
        }
        return parentId;
      };
      // Honor label tombstones/merge aliases exactly like canonicalLabel. Import
      // must not resurrect globally removed names through heuristic enrichment.
      const canonical = (kind: LabelRecord["kind"], name: string): LabelRecord | null => {
        const normalized = normalizeOrganizationName(name);
        if (!normalized || (kind === "category" && normalized === "uncategorized")) return null;
        let label =
          labels.find(
            (entry) =>
              entry.kind === kind &&
              normalizeOrganizationName(entry.name) === normalized &&
              !entry.deleted,
          ) ??
          labels.find(
            (entry) => entry.kind === kind && normalizeOrganizationName(entry.name) === normalized,
          );
        if (label) {
          const seen = new Set<string>();
          while (label.deleted && label.aliasTo && !seen.has(label.id)) {
            seen.add(label.id);
            label = labels.find((entry) => entry.id === label!.aliasTo);
            if (!label) return null;
          }
          return label.deleted ? null : label;
        }
        label = {
          id: randomUUID(),
          kind,
          name: name.trim(),
          deleted: false,
          aliasTo: null,
          versions: { exists: randomUUID() },
        };
        labels.push(label);
        statements.push(labelStatement(label));
        return label;
      };
      for (const item of items) {
        const existingId = urls.get(item.url);
        if (existingId) {
          outcomes.push({
            key: item.key,
            url: item.url,
            status: "existing",
            bookmarkId: existingId,
          });
          continue;
        }
        const domain = new URL(item.url).hostname.replace(/^www\./, "");
        const inferred = heuristicCategorize({
          url: item.url,
          domain,
          title: item.title,
          description: null,
          og: {},
        });
        const category = canonical("category", inferred.category)?.name ?? "Uncategorized";
        const tags = [
          ...new Map(
            inferred.tags
              .map((tag) => canonical("tag", tag))
              .filter((tag): tag is LabelRecord => tag !== null)
              .map((tag) => [tag.id, tag.name]),
          ).values(),
        ];
        const folderId = input.preserveFolders ? ensureFolder(item.folderPath) : null;
        const id = randomUUID();
        statements.push(
          insertBookmarkStatement({
            id,
            url: item.url,
            domain,
            title: item.title,
            description: null,
            og: {},
            source: { browser: input.browser, device: input.device, savedAt: item.savedAt ?? now },
            category,
            tags,
            createdAt: now,
          }),
        );
        statements.push(
          bookmarkOrganizationStatement(id, {
            folderId,
            readingState: "not_on_list",
            overrides: { title: true },
            versions: {
              title: randomUUID(),
              folderId: randomUUID(),
              categoryId: randomUUID(),
              tags: randomUUID(),
            },
          }),
        );
        urls.set(item.url, id);
        outcomes.push({ key: item.key, url: item.url, status: "imported", bookmarkId: id });
      }
      return { statements, urls, folders, labels, outcomes };
    };
    const fail = (items: Item[], message: string) => {
      for (const item of items)
        result.items.push({ key: item.key, url: item.url, status: "failed", error: message });
    };
    const applyGroup = async (items: Item[]): Promise<void> => {
      if (Date.now() > deadline) {
        fail(items, "These links need another attempt. Retry failed links to continue the import.");
        return;
      }
      const plan = stage(items);
      if (plan.statements.length === 0) {
        result.items.push(...plan.outcomes);
        return;
      }
      await tx.execute("SAVEPOINT import_group");
      try {
        for (let offset = 0; offset < plan.statements.length; offset += 250) {
          await tx.batch(plan.statements.slice(offset, offset + 250));
        }
        await tx.execute("RELEASE SAVEPOINT import_group");
        knownUrls = plan.urls;
        knownFolders = plan.folders;
        knownLabels = plan.labels;
        result.items.push(...plan.outcomes);
      } catch {
        // A failed batch may have written earlier statements. Roll ALL staged
        // folders, labels, bookmarks and overrides back before splitting it.
        await tx.execute("ROLLBACK TO SAVEPOINT import_group");
        await tx.execute("RELEASE SAVEPOINT import_group");
        if (items.length === 1) {
          fail(
            items,
            "This link could not be saved. Retry it; if it keeps failing, choose another source or folder.",
          );
        } else {
          const middle = Math.ceil(items.length / 2);
          await applyGroup(items.slice(0, middle));
          await applyGroup(items.slice(middle));
        }
      }
    };
    await applyGroup(input.items);
    for (const item of result.items) result[item.status]++;
    await tx.execute({
      sql: "INSERT INTO bookmark_import_batches (request_id, input_hash, result_json, created_at) VALUES (?, ?, ?, ?)",
      args: [input.requestId, hash, JSON.stringify(result), now],
    });
    await tx.commit();
    return result;
  } catch (error) {
    if (!tx.closed) await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}
