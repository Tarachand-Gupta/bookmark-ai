import { createHash, randomUUID } from "node:crypto";
import {
  ORGANIZATION_CAPABILITIES,
  MAX_ORGANIZATION_SELECTION,
  type BookmarkChanges,
  type BulkBookmarkChanges,
  type OrganizationOperationInput,
  type OrganizationOperation,
  type OrganizationItemResult,
  type OrganizationResponse,
  type OrganizationSelection,
  type UpdateBookmarkInput,
  type ListBookmarksQuery,
  type Bookmark,
} from "@bookmark-ai/types";
import {
  BOOKMARK_COLUMNS,
  rowToBookmark,
  getBookmarkByUrl,
  getBookmark,
  getBookmarkOrganization,
  putBookmarkOrganization,
  bookmarkOrganizationStatement,
  folderStatement,
  labelStatement,
  organizationFolders,
  organizationLabels,
  putFolder,
  putLabel,
  canonicalLabel,
  descendantFolderIds,
  normalizeOrganizationName as norm,
  listBookmarks,
  json,
  type Db,
  type SqlExecutor,
  type BookmarkOrganization,
  type FolderRecord,
  type LabelRecord,
} from "@bookmark-ai/db";

export class OrganizationError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
const DAY = 86_400_000;
export const requestHash = (input: unknown): string =>
  createHash("sha256").update(stableJson(input)).digest("hex");
function stableJson(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  return `{${Object.entries(v)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, x]) => `${JSON.stringify(k)}:${stableJson(x)}`)
    .join(",")}}`;
}
const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
type Entity = "bookmark" | "folder" | "label";
interface Delta {
  entity: Entity;
  id: string;
  field: string;
  before: unknown;
  after: unknown;
  version: string;
  beforeVersion: string;
  undone?: boolean;
}
interface Journal {
  deltas: Delta[];
  token: string;
}
interface OperationRow {
  receipt: OrganizationOperation;
  deltas: Delta[];
  hash: string;
  request?: any;
}
const fail = (
  code: string,
  message: string,
  status = 400,
  details?: Record<string, unknown>,
): never => {
  throw new OrganizationError(code, message, status, details);
};
async function storedOperation(db: SqlExecutor, id: string): Promise<OperationRow | null> {
  const r = (
    await db.execute({ sql: "SELECT * FROM organization_operations WHERE id=?", args: [id] })
  ).rows[0];
  return r
    ? {
        receipt: json(r.receipt_json, {} as OrganizationOperation),
        deltas: json(r.deltas_json, []),
        hash: String(r.request_hash),
        request: json(r.request_json, null),
      }
    : null;
}
export async function getOrganizationOperation(
  db: SqlExecutor,
  id: string,
  now = new Date(),
): Promise<OrganizationOperation | null> {
  const row = await storedOperation(db, id);
  if (!row) return null;
  return decorateReceipt(row.receipt, now);
}
function decorateReceipt(r: OrganizationOperation, now: Date): OrganizationOperation {
  return {
    ...r,
    undoStatus:
      r.undoStatus !== "undone" &&
      r.undoStatus !== "unavailable" &&
      r.undoExpiresAt <= now.toISOString()
        ? "expired"
        : r.undoStatus,
  };
}
export async function listOrganizationOperations(
  db: SqlExecutor,
  limit = 50,
  offset = 0,
  now = new Date(),
): Promise<OrganizationOperation[]> {
  const rows = await db.execute({
    sql: "SELECT receipt_json FROM organization_operations ORDER BY created_at DESC,id LIMIT ? OFFSET ?",
    args: [Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)],
  });
  return rows.rows.map((r) =>
    decorateReceipt(json(r.receipt_json, {} as OrganizationOperation), now),
  );
}
async function persistReceipt(
  db: SqlExecutor,
  hash: string,
  receipt: OrganizationOperation,
  deltas: Delta[],
  request?: unknown,
) {
  await db.execute({
    sql: "INSERT INTO organization_operations(id,request_hash,request_json,receipt_json,deltas_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",
    args: [
      receipt.id,
      hash,
      request ? JSON.stringify(request) : null,
      JSON.stringify(receipt),
      JSON.stringify(deltas),
      receipt.createdAt,
      receipt.undoExpiresAt,
    ],
  });
}
function receipt(
  id: string,
  action: string,
  results: OrganizationItemResult[],
  deltas: Delta[],
  now: Date,
  entityId?: string,
): OrganizationOperation {
  const succeeded = results.filter(
    (r) => r.status === "succeeded" || r.status === "unchanged",
  ).length;
  const failed = results.length - succeeded;
  return {
    id,
    action,
    description: description(action),
    createdAt: now.toISOString(),
    undoExpiresAt: new Date(now.getTime() + 7 * DAY).toISOString(),
    status: failed ? (succeeded ? "partial" : "failed") : "completed",
    requestedCount: results.length,
    succeededCount: succeeded,
    failedCount: failed,
    results,
    undoStatus: deltas.length ? "available" : "unavailable",
    ...(entityId ? { entityId } : {}),
  };
}
function description(action: string): string {
  return (
    (
      {
        "bookmarks.update": "Update bookmarks",
        "bookmark.update": "Edit bookmark",
        "folder.create": "Create folder",
        "folder.update": "Edit folder",
        "folder.remove": "Remove folder",
        "category.create": "Create category",
        "category.rename": "Rename category",
        "category.remove": "Remove category",
        "tag.create": "Create tag",
        "tag.rename": "Rename tag",
        "tag.remove": "Delete tag everywhere",
        "tag.merge": "Merge tags",
        undo: "Undo changes",
        "bookmark.save": "Save bookmark",
      } as Record<string, string>
    )[action] ?? action
  );
}
function resultError(
  id: string,
  error: unknown,
  entityType: OrganizationItemResult["entityType"] = "bookmark",
  label?: string,
): OrganizationItemResult {
  if (!(error instanceof OrganizationError)) throw error;
  return {
    id,
    entityType,
    ...(label ? { label } : {}),
    status: error.code === "conflict" ? "conflict" : "failed",
    error: { code: error.code, message: error.message, ...error.details },
  };
}
function delta(
  j: Journal,
  entity: Entity,
  id: string,
  field: string,
  before: unknown,
  after: unknown,
  versions: Record<string, string>,
) {
  if (same(before, after)) return;
  const version = randomUUID();
  j.deltas.push({
    entity,
    id,
    field,
    before,
    after,
    version,
    beforeVersion: versions[field] ?? "0",
  });
  versions[field] = version;
}
function requireFolder(folders: FolderRecord[], id: string | null): FolderRecord | null {
  if (id === null) return null;
  return (
    folders.find((f) => f.id === id && !f.deleted) ??
    fail("folder-not-found", "Folder no longer exists. Choose a new destination.", 404)
  );
}
function requireLabel(labels: LabelRecord[], id: string, kind: LabelRecord["kind"]): LabelRecord {
  return (
    labels.find((l) => l.id === id && l.kind === kind && !l.deleted) ??
    fail("label-not-found", "Label no longer exists. Choose a new label.", 404)
  );
}
function expectedFields(
  versions: Record<string, string>,
  expected: Record<string, string> | undefined,
  fields: string[],
  current: Record<string, unknown>,
) {
  const conflicts = fields.filter(
    (f) => expected?.[f] !== undefined && expected[f] !== (versions[f] ?? "0"),
  );
  if (conflicts.length)
    fail("conflict", "These fields changed on another device. Review their current values.", 409, {
      fields: conflicts,
      current,
    });
}
type WriteStatement = { sql: string; args: (string | number | null)[] };
type BatchExecutor = SqlExecutor & Pick<Db, "batch">;
interface BookmarkSnapshot {
  bookmarks: Map<string, Bookmark>;
  states: Map<string, BookmarkOrganization>;
}
function emptyBookmarkState(): BookmarkOrganization {
  return { folderId: null, readingState: "not_on_list", overrides: {}, versions: {} };
}
/** Two reads, regardless of library size; called inside the owning write transaction. */
async function loadBookmarkSnapshot(db: SqlExecutor, ids?: string[]): Promise<BookmarkSnapshot> {
  const predicate = ids ? " WHERE bookmarks.id IN(SELECT value FROM json_each(?))" : "";
  const args = ids ? [JSON.stringify(ids)] : [];
  const raw = await db.execute({
    sql: `SELECT ${BOOKMARK_COLUMNS} FROM bookmarks${predicate}`,
    args,
  });
  const bookmarks = new Map(
    raw.rows.map((r) => {
      const b = rowToBookmark(r);
      return [b.id, b] as const;
    }),
  );
  const rows = await db.execute({
    sql: `SELECT * FROM bookmark_organization${ids ? " WHERE bookmark_id IN(SELECT value FROM json_each(?))" : ""}`,
    args,
  });
  const states = new Map<string, BookmarkOrganization>(
    rows.rows.map((r) => [
      String(r.bookmark_id),
      {
        folderId: r.folder_id == null ? null : String(r.folder_id),
        readingState: r.reading_state as BookmarkOrganization["readingState"],
        overrides: json(r.overrides_json, {}),
        versions: json(r.versions_json, {}),
      },
    ]),
  );
  for (const id of bookmarks.keys()) if (!states.has(id)) states.set(id, emptyBookmarkState());
  return { bookmarks, states };
}
function bookmarkFieldValue(b: Bookmark, s: BookmarkOrganization, field: string): unknown {
  if (field === "title") return { value: b.title, manual: !!s.overrides.title };
  if (field === "categoryId") return { value: b.category, manual: !!s.overrides.category };
  if (field === "tags")
    return {
      value: b.tags,
      added: s.overrides.addedTags ?? [],
      removed: s.overrides.removedTags ?? [],
    };
  return field === "folderId" ? s.folderId : s.readingState;
}
function stageBookmarkField(
  b: Bookmark,
  s: BookmarkOrganization,
  field: string,
  value: any,
  version: string,
) {
  if (field === "title") {
    b.title = value.value;
    s.overrides.title = value.manual;
  } else if (field === "categoryId") {
    b.category = value.value;
    s.overrides.category = value.manual;
  } else if (field === "tags") {
    b.tags = value.value;
    s.overrides.addedTags = value.added;
    s.overrides.removedTags = value.removed;
  } else if (field === "folderId") s.folderId = value;
  else s.readingState = value;
  s.versions[field] = version;
}
function bookmarkWriteStatements(b: Bookmark, s: BookmarkOrganization): WriteStatement[] {
  const tags = JSON.stringify(b.tags);
  return [
    {
      sql: "UPDATE bookmarks SET title=?,category=?,tags_json=?,embedding=NULL WHERE id=? AND (title<>? OR category<>? OR tags_json<>?)",
      args: [b.title, b.category, tags, b.id, b.title, b.category, tags],
    },
    bookmarkOrganizationStatement(b.id, s),
  ];
}
/** Bounded payloads, one atomic outer transaction. Never commit an intermediate chunk. */
async function flushStatements(db: BatchExecutor, statements: WriteStatement[]) {
  for (let offset = 0; offset < statements.length; offset += 500)
    await db.batch(statements.slice(offset, offset + 500));
}
interface PreparedBookmarkEdit {
  bookmark: Bookmark | null;
  state: BookmarkOrganization;
  folders: FolderRecord[];
  labels: LabelRecord[];
  statements: { sql: string; args: (string | number | null)[] }[];
}
async function applyBookmark(
  db: SqlExecutor,
  id: string,
  changes: BookmarkChanges | BulkBookmarkChanges,
  expected: Record<string, string> | undefined,
  j: Journal,
  manual = true,
  prepared?: PreparedBookmarkEdit,
): Promise<OrganizationItemResult> {
  const b = prepared ? prepared.bookmark : await getBookmark(db, id);
  if (!b) fail("bookmark-not-found", "Bookmark is no longer available.", 404);
  const state = prepared?.state ?? (await getBookmarkOrganization(db, id));
  const fields = Object.keys(changes).map((f) =>
    f === "addTags" || f === "removeTags" ? "tags" : f,
  );
  expectedFields(
    state.versions,
    expected,
    [...new Set(fields)],
    b! as unknown as Record<string, unknown>,
  );
  const c = changes as BookmarkChanges & BulkBookmarkChanges;
  const proposed: Record<string, unknown> = {};
  if (c.folderId !== undefined) {
    requireFolder(prepared?.folders ?? (await organizationFolders(db)), c.folderId);
    proposed.folderId = c.folderId;
  }
  if (c.categoryId !== undefined) {
    const label =
      c.categoryId === null
        ? null
        : requireLabel(
            prepared?.labels ?? (await organizationLabels(db)),
            c.categoryId,
            "category",
          );
    proposed.categoryId = {
      value: label?.name ?? "Uncategorized",
      manual: manual || !!state.overrides.category,
    };
  }
  if (c.title !== undefined)
    proposed.title = { value: c.title, manual: manual || !!state.overrides.title };
  if (c.readingState !== undefined) proposed.readingState = c.readingState;
  if (c.tags !== undefined || c.addTags !== undefined || c.removeTags !== undefined) {
    const labels = prepared?.labels ?? (await organizationLabels(db));
    const requested = c.tags ?? [...b!.tags, ...(c.addTags ?? [])];
    const remove = new Set((c.removeTags ?? []).map(norm));
    const seen = new Set<string>();
    const next: string[] = [];
    for (const raw of requested) {
      const n = norm(raw);
      if (remove.has(n) || seen.has(n)) continue;
      const existing = b!.tags.find((t) => norm(t) === n);
      const label = labels.find((t) => t.kind === "tag" && norm(t.name) === n);
      if (!label && !existing)
        fail("label-not-found", `Create the tag “${raw}” before assigning it.`, 404);
      seen.add(n);
      next.push(label?.name ?? existing!);
    }
    if (next.length > 10 && next.length >= b!.tags.length)
      fail("tag-limit", "This bookmark exceeds ten tags. Remove tags before adding more.", 422);
    const removed = new Set(state.overrides.removedTags ?? []);
    const added = new Map((state.overrides.addedTags ?? []).map((t) => [norm(t), t]));
    if (manual) {
      for (const t of b!.tags)
        if (!seen.has(norm(t))) {
          removed.add(norm(t));
          added.delete(norm(t));
        }
      for (const t of next) {
        removed.delete(norm(t));
        if (
          !b!.tags.some((old) => norm(old) === norm(t)) ||
          c.tags !== undefined ||
          c.addTags?.some((x) => norm(x) === norm(t))
        )
          added.set(norm(t), t);
      }
    }
    proposed.tags = { value: next, added: [...added.values()], removed: [...removed] };
  }
  const start = j.deltas.length;
  const current: Record<string, unknown> = {
    title: { value: b!.title, manual: !!state.overrides.title },
    categoryId: { value: b!.category, manual: !!state.overrides.category },
    tags: {
      value: b!.tags,
      added: state.overrides.addedTags ?? [],
      removed: state.overrides.removedTags ?? [],
    },
    folderId: state.folderId,
    readingState: state.readingState,
  };
  for (const [field, value] of Object.entries(proposed))
    delta(j, "bookmark", id, field, current[field], value, state.versions);
  if (j.deltas.length > start) {
    const next = { ...current, ...proposed } as any;
    state.folderId = next.folderId;
    state.readingState = next.readingState;
    state.overrides = {
      ...state.overrides,
      title: next.title.manual,
      category: next.categoryId.manual,
      addedTags: next.tags.added,
      removedTags: next.tags.removed,
    };
    const statements = bookmarkWriteStatements(
      { ...b!, title: next.title.value, category: next.categoryId.value, tags: next.tags.value },
      state,
    );
    if (prepared) prepared.statements.push(...statements);
    else for (const statement of statements) await db.execute(statement);
  }
  return {
    id,
    entityType: "bookmark",
    label: c.title ?? b!.title,
    status: j.deltas.length > start ? "succeeded" : "unchanged",
    changedFields: j.deltas.slice(start).map((d) => d.field),
  };
}
async function writeFolderChanges(
  db: SqlExecutor,
  f: FolderRecord,
  changes: Partial<FolderRecord>,
  j: Journal,
  statements?: WriteStatement[],
) {
  f.versions.exists = randomUUID();
  for (const field of Object.keys(changes)) {
    if (field === "versions" || field === "id") continue;
    delta(j, "folder", f.id, field, (f as any)[field], (changes as any)[field], f.versions);
    (f as any)[field] = (changes as any)[field];
  }
  if (statements) statements.push(folderStatement(f));
  else await putFolder(db, f);
}
async function writeLabelChanges(
  db: SqlExecutor,
  l: LabelRecord,
  changes: Partial<LabelRecord>,
  j: Journal,
  statements?: WriteStatement[],
) {
  l.versions.exists = randomUUID();
  for (const field of Object.keys(changes)) {
    if (field === "versions" || field === "id") continue;
    delta(j, "label", l.id, field, (l as any)[field], (changes as any)[field], l.versions);
    (l as any)[field] = (changes as any)[field];
  }
  if (statements) statements.push(labelStatement(l));
  else await putLabel(db, l);
}
function siblingAvailable(
  folders: FolderRecord[],
  name: string,
  parentId: string | null,
  except?: string,
) {
  const existing = folders.find(
    (f) => !f.deleted && f.id !== except && f.parentId === parentId && norm(f.name) === norm(name),
  );
  if (existing)
    fail("name-exists", "A folder with this name already exists here.", 409, {
      existingId: existing.id,
    });
}
async function applyManagement(
  db: BatchExecutor,
  input: Exclude<OrganizationOperationInput, { action: "bookmarks.update" }>,
  j: Journal,
): Promise<{ results: OrganizationItemResult[]; entityId?: string }> {
  const folders = await organizationFolders(db);
  const labels = await organizationLabels(db);
  const start = j.deltas.length;
  const statements: WriteStatement[] = [];
  const display = new Map<string, Pick<OrganizationItemResult, "entityType" | "label">>([
    ...folders.map((f) => [f.id, { entityType: "folder" as const, label: f.name }] as const),
    ...labels.map((l) => [l.id, { entityType: l.kind, label: l.name }] as const),
  ]);
  let entityId: string | undefined;
  if (input.action === "folder.create") {
    const parentId = input.parentId ?? null;
    requireFolder(folders, parentId);
    siblingAvailable(folders, input.name, parentId);
    const f: FolderRecord = {
      id: randomUUID(),
      name: input.name,
      parentId,
      deleted: false,
      versions: {},
    };
    delta(j, "folder", f.id, "exists", null, { ...f, versions: {} }, f.versions);
    await putFolder(db, f);
    display.set(f.id, { entityType: "folder", label: f.name });
    entityId = f.id;
  } else if (input.action === "folder.update") {
    const f = requireFolder(folders, input.id)!;
    const name = input.name ?? f.name;
    const parentId = input.parentId === undefined ? f.parentId : input.parentId;
    expectedFields(
      f.versions,
      input.expected,
      Object.keys(input).filter((k) => k === "name" || k === "parentId"),
      f as unknown as Record<string, unknown>,
    );
    requireFolder(folders, parentId);
    if (parentId && descendantFolderIds(folders, f.id).includes(parentId))
      fail("folder-cycle", "A folder cannot be moved into itself or a descendant.");
    siblingAvailable(folders, name, parentId, f.id);
    await writeFolderChanges(db, f, { name, parentId }, j);
    display.set(f.id, { entityType: "folder", label: f.name });
  } else if (input.action === "folder.remove") {
    const f = requireFolder(folders, input.id)!;
    requireFolder(folders, input.destinationId);
    if (input.destinationId && descendantFolderIds(folders, f.id).includes(input.destinationId))
      fail("folder-cycle", "Choose a destination outside the removed subtree.");
    const childParent = input.children === "parent" ? f.parentId : input.destinationId;
    const children = folders.filter((x) => x.parentId === f.id);
    for (const child of children) siblingAvailable(folders, child.name, childParent, child.id);
    // Validate collisions between moved children and the destination before changing anything.
    for (const child of children)
      await writeFolderChanges(db, child, { parentId: childParent }, j, statements);
    const ids = (
      await db.execute({
        sql: "SELECT bookmark_id FROM bookmark_organization WHERE folder_id=?",
        args: [f.id],
      })
    ).rows.map((r) => String(r.bookmark_id));
    const snapshot = await loadBookmarkSnapshot(db, ids);
    for (const id of ids) {
      const bookmark = snapshot.bookmarks.get(id);
      if (bookmark) display.set(id, { entityType: "bookmark", label: bookmark.title });
      if (bookmark)
        await applyBookmark(db, id, { folderId: input.destinationId }, undefined, j, true, {
          bookmark,
          state: snapshot.states.get(id)!,
          folders,
          labels,
          statements,
        });
    }
    await writeFolderChanges(db, f, { deleted: true }, j, statements);
  } else if (input.action.endsWith(".create")) {
    const i = input as Extract<
      OrganizationOperationInput,
      { action: "category.create" | "tag.create" }
    >;
    const kind = input.action.startsWith("category") ? "category" : "tag";
    if (kind === "category" && norm(i.name) === "uncategorized")
      fail("reserved-name", "Uncategorized is the built-in empty category.", 409);
    const existing = labels.find((l) => l.kind === kind && norm(l.name) === norm(i.name));
    if (existing)
      fail("name-exists", "This label already exists.", 409, { existingId: existing.id });
    const l: LabelRecord = {
      id: randomUUID(),
      kind,
      name: i.name,
      deleted: false,
      aliasTo: null,
      versions: {},
    };
    delta(j, "label", l.id, "exists", null, { ...l, versions: {} }, l.versions);
    await putLabel(db, l);
    display.set(l.id, { entityType: l.kind, label: l.name });
    entityId = l.id;
  } else {
    const i = input as Extract<
      OrganizationOperationInput,
      { action: "category.rename" | "category.remove" | "tag.rename" | "tag.remove" | "tag.merge" }
    >;
    const kind = i.action.startsWith("category") ? "category" : "tag";
    const source = requireLabel(labels, "sourceId" in i ? i.sourceId : i.id, kind);
    let target: LabelRecord | null = null;
    let newName: string | null = null;
    if (i.action === "tag.merge") {
      target = requireLabel(labels, i.targetId, "tag");
      if (target.id === source.id) fail("invalid-merge", "Choose a different surviving tag.");
      newName = target.name;
    }
    if (i.action === "category.remove") {
      target = i.replacementId ? requireLabel(labels, i.replacementId, "category") : null;
      if (target?.id === source.id)
        fail("invalid-replacement", "Choose a different replacement category.");
      newName = target?.name ?? "Uncategorized";
    }
    if ("name" in i) {
      newName = i.name;
      if (kind === "category" && norm(newName) === "uncategorized")
        fail("reserved-name", "Use Remove category and choose Uncategorized.");
      const existing = labels.find(
        (l) => l.kind === kind && l.id !== source.id && norm(l.name) === norm(newName!),
      );
      if (existing)
        fail(
          kind === "tag" ? "merge-required" : "name-exists",
          kind === "tag"
            ? "That tag exists. Use Merge to combine them."
            : "That category already exists.",
          409,
          { existingId: existing.id },
        );
    }
    const snapshot = await loadBookmarkSnapshot(db);
    for (const [id, b] of snapshot.bookmarks) {
      const state = snapshot.states.get(id)!;
      const field = kind === "category" ? "categoryId" : "tags";
      let after: unknown;
      if (kind === "category" && norm(b.category) === norm(source.name)) {
        after = { value: newName ?? "Uncategorized", manual: true };
      }
      if (
        kind === "tag" &&
        (b.tags.some((t) => norm(t) === norm(source.name)) ||
          state.overrides.addedTags?.some((t) => norm(t) === norm(source.name)) ||
          state.overrides.removedTags?.includes(norm(source.name)))
      ) {
        const replace = (tags: string[]) => [
          ...new Map(
            tags
              .flatMap((t) => (norm(t) === norm(source.name) ? (newName ? [newName] : []) : [t]))
              .map((t) => [norm(t), t]),
          ).values(),
        ];
        const removed = new Set(state.overrides.removedTags ?? []);
        if (!newName) removed.add(norm(source.name));
        if (removed.has(norm(source.name)) && newName) removed.add(norm(newName));
        after = {
          value: replace(b.tags),
          added: replace([
            ...(state.overrides.addedTags ?? []),
            ...(newName && b.tags.some((t) => norm(t) === norm(source.name)) ? [source.name] : []),
          ]),
          removed: [...removed],
        };
      }
      if (after !== undefined) {
        display.set(id, { entityType: "bookmark", label: b.title });
        const before = bookmarkFieldValue(b, state, field);
        delta(j, "bookmark", id, field, before, after, state.versions);
        if (!same(before, after)) {
          stageBookmarkField(b, state, field, after, state.versions[field]!);
          statements.push(...bookmarkWriteStatements(b, state));
        }
      }
    }
    if ("name" in i) {
      await writeLabelChanges(db, source, { name: i.name }, j);
      display.set(source.id, { entityType: source.kind, label: source.name });
      // Tombstone of the old spelling routes a late enrichment to the renamed identity.
      if (
        norm(source.name) !==
        norm(
          (j.deltas.find((d) => d.entity === "label" && d.id === source.id && d.field === "name")
            ?.before as string) ?? source.name,
        )
      ) {
        const previous = j.deltas.find(
          (d) => d.entity === "label" && d.id === source.id && d.field === "name",
        )!.before as string;
        const alias: LabelRecord = {
          id: randomUUID(),
          kind,
          name: previous,
          deleted: true,
          aliasTo: source.id,
          versions: {},
        };
        delta(j, "label", alias.id, "exists", null, { ...alias, versions: {} }, alias.versions);
        await putLabel(db, alias);
        display.set(alias.id, { entityType: alias.kind, label: alias.name });
      }
    } else await writeLabelChanges(db, source, { deleted: true, aliasTo: target?.id ?? null }, j);
  }
  await flushStatements(db, statements);
  const changes = j.deltas.slice(start);
  const grouped = new Map<string, string[]>();
  for (const d of changes) grouped.set(d.id, [...(grouped.get(d.id) ?? []), d.field]);
  return {
    results: [...grouped].map(([id, changedFields]) => ({
      id,
      ...display.get(id),
      status: "succeeded" as const,
      changedFields,
    })),
    entityId,
  };
}
export async function executeOrganizationOperation(
  db: Db,
  input: OrganizationOperationInput,
  now = new Date(),
): Promise<OrganizationOperation> {
  const tx = await db.transaction("write");
  try {
    const hash = requestHash(input);
    const prior = await storedOperation(tx, input.operationId);
    if (prior) {
      if (prior.hash !== hash)
        fail("operation-id-reused", "This operation ID belongs to a different request.", 409);
      await tx.commit();
      return decorateReceipt(prior.receipt, now);
    }
    const j: Journal = { deltas: [], token: input.operationId };
    let results: OrganizationItemResult[] = [];
    let entityId: string | undefined;
    let durableInput = input;
    if (input.action === "bookmarks.update") {
      if (!!input.bookmarkIds === !!input.selectionId)
        fail("invalid-selection", "Supply bookmark IDs or one selection snapshot.");
      let ids = input.bookmarkIds;
      let expected = input.expected;
      if (input.selectionId) {
        const s = (
          await tx.execute({
            sql: "SELECT selection_json,expires_at FROM organization_selections WHERE id=?",
            args: [input.selectionId],
          })
        ).rows[0];
        if (!s) fail("selection-not-found", "Selection no longer exists.", 404);
        if (String(s!.expires_at) <= now.toISOString())
          fail("selection-expired", "Selection expired. Select the items again.", 410);
        const snapshot = json<OrganizationSelection>(
          s!.selection_json,
          {} as OrganizationSelection,
        );
        ids = snapshot.bookmarkIds;
        expected = expected ?? snapshot.fieldVersions;
        durableInput = { ...input, expected };
      }
      if ((ids?.length ?? 0) > ORGANIZATION_CAPABILITIES.maxOperationItems)
        fail(
          "selection-too-large",
          "Apply at most 500 bookmarks per batch. Keep the frozen selection and continue with a new batch.",
          422,
        );
      results = await applyBookmarkBatch(tx, [...new Set(ids)], input.changes, expected, j);
    } else {
      try {
        ({ results, entityId } = await applyManagement(tx, input, j));
      } catch (error) {
        if (j.deltas.length) throw error;
        results = [
          resultError(
            "id" in input ? input.id : "sourceId" in input ? input.sourceId : input.operationId,
            error,
            input.action.startsWith("folder")
              ? "folder"
              : input.action.startsWith("category")
                ? "category"
                : "tag",
            "name" in input ? input.name : undefined,
          ),
        ];
      }
    }
    const out = receipt(input.operationId, input.action, results, j.deltas, now, entityId);
    await persistReceipt(tx, hash, out, j.deltas, { kind: "organization", input: durableInput });
    await tx.commit();
    return out;
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}
export async function editBookmark(
  db: Db,
  id: string,
  input: UpdateBookmarkInput,
  now = new Date(),
): Promise<OrganizationOperation> {
  const tx = await db.transaction("write");
  try {
    const hash = requestHash({ id, ...input });
    const prior = await storedOperation(tx, input.operationId);
    if (prior) {
      if (prior.hash !== hash)
        fail("operation-id-reused", "This operation ID belongs to a different request.", 409);
      await tx.commit();
      return decorateReceipt(prior.receipt, now);
    }
    const j: Journal = { deltas: [], token: input.operationId };
    let result: OrganizationItemResult;
    try {
      result = await applyBookmark(tx, id, input.changes, input.expected, j);
    } catch (error) {
      if (j.deltas.length) throw error;
      result = resultError(id, error);
    }
    const out = receipt(input.operationId, "bookmark.update", [result], j.deltas, now);
    await persistReceipt(tx, hash, out, j.deltas, { kind: "bookmark", id, input });
    await tx.commit();
    return out;
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}
export async function getOrganization(db: Db): Promise<OrganizationResponse> {
  // Discover vocabulary written by an older client without altering its content.
  await db.execute(
    "INSERT OR IGNORE INTO organization_labels(id,kind,name,normalized_name) SELECT 'legacy-category:'||lower(trim(category)),'category',MIN(trim(category)),lower(trim(category)) FROM bookmarks WHERE lower(trim(category)) NOT IN ('','uncategorized') AND NOT EXISTS(SELECT 1 FROM organization_labels l WHERE l.kind='category' AND l.normalized_name=lower(trim(bookmarks.category))) GROUP BY lower(trim(category))",
  );
  await db.execute(
    "INSERT OR IGNORE INTO organization_labels(id,kind,name,normalized_name) SELECT 'legacy-tag:'||lower(trim(value)),'tag',MIN(trim(value)),lower(trim(value)) FROM bookmarks,json_each(bookmarks.tags_json) WHERE trim(value)<>'' AND NOT EXISTS(SELECT 1 FROM organization_labels l WHERE l.kind='tag' AND l.normalized_name=lower(trim(value))) GROUP BY lower(trim(value))",
  );
  const folders = await organizationFolders(db);
  const labels = await organizationLabels(db);
  const rows = (
    await db.execute(
      "SELECT b.id,b.category,b.tags_json,o.folder_id FROM bookmarks b LEFT JOIN bookmark_organization o ON o.bookmark_id=b.id",
    )
  ).rows;
  const path = (f: FolderRecord): string => {
    const parts = [f.name];
    const seen = new Set([f.id]);
    let p = f.parentId;
    while (p && !seen.has(p)) {
      seen.add(p);
      const parent = folders.find((x) => x.id === p);
      if (!parent) break;
      parts.unshift(parent.name);
      p = parent.parentId;
    }
    return parts.join(" / ");
  };
  return {
    capabilities: ORGANIZATION_CAPABILITIES,
    folders: folders.map((f) => {
      const descendants = new Set(descendantFolderIds(folders, f.id));
      return {
        id: f.id,
        name: f.name,
        parentId: f.parentId,
        path: path(f),
        directCount: rows.filter((r) => r.folder_id === f.id).length,
        count: rows.filter((r) => descendants.has(String(r.folder_id))).length,
        fieldVersions: f.versions,
      };
    }),
    categories: labels
      .filter((l) => l.kind === "category")
      .map((l) => ({
        id: l.id,
        name: l.name,
        count: rows.filter((r) => norm(String(r.category)) === norm(l.name)).length,
      })),
    tags: labels
      .filter((l) => l.kind === "tag")
      .map((l) => ({
        id: l.id,
        name: l.name,
        count: rows.filter((r) =>
          json<string[]>(r.tags_json, []).some((t) => norm(t) === norm(l.name)),
        ).length,
      })),
  };
}
export async function createOrganizationSelection(
  db: Db,
  input: Parameters<typeof createSelectionInTransaction>[1],
  now = new Date(),
): Promise<OrganizationSelection> {
  const tx = await db.transaction("write");
  try {
    const result = await createSelectionInTransaction(tx as unknown as Db, input, now);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}
async function createSelectionInTransaction(
  db: Db,
  input: {
    bookmarkIds?: string[];
    query?: ListBookmarksQuery;
    rankedIds?: string[];
    rankingLimit?: number;
  },
  now = new Date(),
): Promise<OrganizationSelection> {
  let ids: string[];
  let scope: OrganizationSelection["scope"] = "explicit";
  if (input.rankedIds) {
    ids = input.rankedIds;
    scope = "ranked";
  } else if (input.bookmarkIds) {
    ids = [...new Set(input.bookmarkIds)];
  } else {
    scope = "all_matches";
    const q = input.query ?? { limit: 100, offset: 0 };
    const response = await listBookmarks(db, {
      ...q,
      limit: MAX_ORGANIZATION_SELECTION + 1,
      offset: 0,
    });
    ids = response.bookmarks.map((b) => b.id);
    if (response.total > MAX_ORGANIZATION_SELECTION)
      fail(
        "selection-too-large",
        `Narrow the selection to ${MAX_ORGANIZATION_SELECTION} bookmarks or fewer.`,
        422,
      );
  }
  if (ids.length > MAX_ORGANIZATION_SELECTION)
    fail("selection-too-large", "Selection is too large.", 422);
  const stateRows = await db.execute({
    sql: "SELECT bookmark_id,versions_json FROM bookmark_organization WHERE bookmark_id IN(SELECT value FROM json_each(?))",
    args: [JSON.stringify(ids)],
  });
  const versions = new Map(
    stateRows.rows.map((r) => [
      String(r.bookmark_id),
      json<Record<string, string>>(r.versions_json, {}),
    ]),
  );
  const fieldVersions = Object.fromEntries(
    ids.map((id) => [
      id,
      {
        title: "0",
        categoryId: "0",
        tags: "0",
        folderId: "0",
        readingState: "0",
        ...versions.get(id),
      },
    ]),
  );
  const selection: OrganizationSelection = {
    id: randomUUID(),
    bookmarkIds: ids,
    fieldVersions,
    count: ids.length,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DAY).toISOString(),
    scope,
    limited: scope === "ranked",
    ...(scope === "ranked" ? { limit: input.rankingLimit ?? 200 } : {}),
  };
  await db.execute({
    sql: "INSERT INTO organization_selections(id,selection_json,expires_at) VALUES(?,?,?)",
    args: [selection.id, JSON.stringify(selection), selection.expiresAt],
  });
  return selection;
}
interface UndoSnapshot extends BookmarkSnapshot {
  folders: FolderRecord[];
  labels: LabelRecord[];
}
function readDelta(snapshot: UndoSnapshot, d: Delta): { value: unknown; version: string } {
  if (d.entity === "bookmark") {
    const b = snapshot.bookmarks.get(d.id);
    if (!b) return { value: undefined, version: "missing" };
    const state = snapshot.states.get(d.id)!;
    return {
      value: bookmarkFieldValue(b, state, d.field),
      version: state.versions[d.field] ?? "0",
    };
  }
  const records = d.entity === "folder" ? snapshot.folders : snapshot.labels;
  const row = records.find((r) => r.id === d.id);
  if (!row) return { value: null, version: "0" };
  return {
    value: d.field === "exists" ? { ...row, versions: {} } : (row as any)[d.field],
    version: row.versions[d.field] ?? "0",
  };
}
function reverseDelta(snapshot: UndoSnapshot, d: Delta, statements: WriteStatement[]) {
  if (d.entity === "bookmark") {
    stageBookmarkField(
      snapshot.bookmarks.get(d.id)!,
      snapshot.states.get(d.id)!,
      d.field,
      d.before,
      d.beforeVersion,
    );
    return;
  }
  if (d.entity === "folder") {
    const f = snapshot.folders.find((f) => f.id === d.id)!;
    if (d.field === "exists") {
      f.deleted = true;
      f.versions.exists = randomUUID();
    } else {
      (f as any)[d.field] = d.before;
      f.versions[d.field] = d.beforeVersion;
    }
    statements.push(folderStatement(f));
  } else {
    const l = snapshot.labels.find((l) => l.id === d.id)!;
    if (d.field === "exists") {
      l.deleted = true;
      l.aliasTo = null;
      l.versions.exists = randomUUID();
    } else {
      (l as any)[d.field] = d.before;
      l.versions[d.field] = d.beforeVersion;
    }
    statements.push(labelStatement(l));
  }
}
function validateStructuralUndo(snapshot: UndoSnapshot, deltas: Delta[]): void {
  const folders = structuredClone(snapshot.folders),
    labels = structuredClone(snapshot.labels);
  for (const d of [...deltas].reverse())
    if (d.entity !== "bookmark") {
      const row = (d.entity === "folder" ? folders : labels).find((r) => r.id === d.id)!;
      if (d.field === "exists") row.deleted = true;
      else (row as any)[d.field] = d.before;
    }
  const activeFolders = folders.filter((f) => !f.deleted);
  const activeLabels = labels.filter((l) => !l.deleted);
  for (const f of activeFolders) {
    siblingAvailable(activeFolders, f.name, f.parentId, f.id);
    requireFolder(activeFolders, f.parentId);
    if (f.parentId && descendantFolderIds(activeFolders, f.id).includes(f.parentId))
      fail("undo-conflict", "The folder hierarchy has changed.", 409);
  }
  const names = new Set<string>();
  for (const l of activeLabels) {
    const key = l.kind + ":" + norm(l.name);
    if (names.has(key)) fail("undo-conflict", "A label now uses the name required by Undo.", 409);
    names.add(key);
  }
  const changedFields = new Map(
    deltas.filter((d) => d.entity === "bookmark").map((d) => [`${d.id}:${d.field}`, d]),
  );
  const activeFolderIds = new Set(activeFolders.map((f) => f.id));
  for (const [id, state] of snapshot.states) {
    const change = changedFields.get(`${id}:folderId`);
    const folder = change ? change.before : state.folderId;
    if (folder && !activeFolderIds.has(String(folder)))
      fail(
        "undo-conflict",
        "This folder now contains additional bookmarks. Move them before Undo.",
        409,
      );
  }
  // A newly created label cannot disappear while a later assignment still uses it.
  for (const d of deltas.filter((d) => d.entity === "label" && d.field === "exists")) {
    const label = d.after as LabelRecord;
    if (label.deleted) continue;
    for (const [id, b] of snapshot.bookmarks) {
      const field = label.kind === "category" ? "categoryId" : "tags";
      const before = changedFields.get(`${id}:${field}`)?.before as any;
      const used =
        label.kind === "category"
          ? norm(before?.value ?? b.category) === norm(label.name)
          : (before?.value ?? b.tags).some((t: string) => norm(t) === norm(label.name));
      if (used)
        fail(
          "undo-conflict",
          "This label now has bookmark assignments. Remove those before Undo.",
          409,
        );
    }
  }
}
export async function undoOrganizationOperation(
  db: Db,
  id: string,
  operationId: string,
  now = new Date(),
): Promise<OrganizationOperation> {
  const tx = await db.transaction("write");
  try {
    const hash = requestHash({ undo: id, operationId });
    const replay = await storedOperation(tx, operationId);
    if (replay) {
      if (replay.hash !== hash)
        fail("operation-id-reused", "This operation ID belongs to another request.", 409);
      await tx.commit();
      return replay.receipt;
    }
    const original = await storedOperation(tx, id);
    if (!original) fail("operation-not-found", "Operation not found.", 404);
    if (original!.receipt.undoExpiresAt <= now.toISOString())
      fail("undo-expired", "The seven-day Undo window has ended.", 410);
    const pending = original!.deltas.filter((d) => !d.undone);
    const structural = pending.some((d) => d.entity !== "bookmark");
    const snapshot: UndoSnapshot = {
      ...(await loadBookmarkSnapshot(
        tx,
        structural ? undefined : [...new Set(pending.map((d) => d.id))],
      )),
      folders: structural ? await organizationFolders(tx, true) : [],
      labels: structural ? await organizationLabels(tx, true) : [],
    };
    const safe: Delta[] = [];
    const conflicts: Delta[] = [];
    for (const d of pending) {
      const current = readDelta(snapshot, d);
      if (current.version === d.version && same(current.value, d.after)) safe.push(d);
      else conflicts.push(d);
    }
    let structuralError: OrganizationError | undefined;
    if (structural && !conflicts.length) {
      try {
        validateStructuralUndo(snapshot, safe);
      } catch (error) {
        if (!(error instanceof OrganizationError)) throw error;
        structuralError = error;
      }
    }
    if (structural && (conflicts.length || structuralError)) {
      conflicts.splice(0, conflicts.length, ...pending);
      safe.length = 0;
    }
    // Structural changes reverse together; bulk bookmark changes reverse field by field.
    const statements: WriteStatement[] = [];
    for (const d of [...safe].reverse()) {
      reverseDelta(snapshot, d, statements);
      d.undone = true;
    }
    for (const bookmarkId of new Set(safe.filter((d) => d.entity === "bookmark").map((d) => d.id)))
      statements.push(
        ...bookmarkWriteStatements(
          snapshot.bookmarks.get(bookmarkId)!,
          snapshot.states.get(bookmarkId)!,
        ),
      );
    await flushStatements(tx, statements);
    const ids = [...new Set(pending.map((d) => d.id))];
    const byId = (deltas: Delta[]) => {
      const groups = new Map<string, Delta[]>();
      for (const d of deltas) {
        const group = groups.get(d.id) ?? [];
        group.push(d);
        groups.set(d.id, group);
      }
      return groups;
    };
    const failedById = byId(conflicts),
      succeededById = byId(safe);
    const originalResults = new Map(original!.receipt.results.map((r) => [r.id, r]));
    const results: OrganizationItemResult[] = ids.map((itemId) => {
      const failed = failedById.get(itemId) ?? [];
      const succeeded = succeededById.get(itemId) ?? [];
      return {
        id: itemId,
        entityType: originalResults.get(itemId)?.entityType,
        label: originalResults.get(itemId)?.label,
        status: failed.length ? "conflict" : "succeeded",
        changedFields: succeeded.map((d) => d.field),
        ...(failed.length
          ? {
              error: {
                code: "undo-conflict",
                message:
                  structuralError?.message ??
                  "Newer changes were kept. These fields could not be restored.",
                fields: failed.map((d) => d.field),
              },
            }
          : {}),
      };
    });
    original!.receipt.undoStatus = original!.deltas.every((d) => d.undone)
      ? "undone"
      : safe.length
        ? "partial"
        : original!.receipt.undoStatus;
    await tx.execute({
      sql: "UPDATE organization_operations SET receipt_json=?,deltas_json=? WHERE id=?",
      args: [JSON.stringify(original!.receipt), JSON.stringify(original!.deltas), id],
    });
    const out = {
      ...receipt(operationId, "undo", results, [], now),
      undoOf: id,
      succeededFieldCount: safe.length,
      failedFieldCount: conflicts.length,
    };
    if (safe.length && conflicts.length) out.status = "partial";
    await persistReceipt(tx, hash, out, []);
    await tx.commit();
    return out;
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}
/** Durable receipt for quick-save, committed with the URL upsert. */
export async function saveBookmarkWithOperation(
  db: Db,
  input: import("@bookmark-ai/types").CreateBookmarkInput,
  now = new Date(),
): Promise<{
  bookmark: import("@bookmark-ai/types").Bookmark;
  operation?: OrganizationOperation;
  replayed: boolean;
  existing: boolean;
}> {
  const { saveBookmarkFastInTransaction } = await import("./ingest");
  const tx = await db.transaction("write");
  try {
    const hash = requestHash(input);
    if (input.operationId) {
      const prior = await storedOperation(tx, input.operationId);
      if (prior) {
        if (prior.hash !== hash)
          fail("operation-id-reused", "This operation ID belongs to a different request.", 409);
        const id = prior.receipt.entityId!;
        const bookmark = await getBookmark(tx, id);
        if (!bookmark)
          fail(
            "saved-bookmark-deleted",
            "The original save completed, but that bookmark was later deleted.",
            410,
          );
        await tx.commit();
        return {
          bookmark: bookmark!,
          operation: prior.receipt,
          replayed: true,
          existing: prior.receipt.existing ?? true,
        };
      }
    }
    const existing = !!(await getBookmarkByUrl(tx, input.url));
    const bookmark = await saveBookmarkFastInTransaction(tx, input);
    let operation: OrganizationOperation | undefined;
    if (input.readingState !== undefined) {
      const j: Journal = { deltas: [], token: input.operationId ?? randomUUID() };
      await applyBookmark(tx, bookmark.id, { readingState: input.readingState }, undefined, j);
    }
    if (input.operationId) {
      operation = receipt(
        input.operationId,
        "bookmark.save",
        [{ id: bookmark.id, status: "succeeded", entityType: "bookmark", label: bookmark.title }],
        [],
        now,
        bookmark.id,
      );
      operation.existing = existing;
      await persistReceipt(tx, hash, operation, []);
    }
    const saved = (await getBookmark(tx, bookmark.id))!;
    await tx.commit();
    return { bookmark: saved, operation, replayed: false, existing };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}
export async function retryOrganizationOperation(
  db: Db,
  id: string,
  operationId: string,
): Promise<OrganizationOperation> {
  const original = await storedOperation(db, id);
  if (!original?.request)
    throw new OrganizationError(
      "retry-unavailable",
      "This operation has no retryable request.",
      404,
    );
  const failed = original.receipt.results
    .filter((r) => r.status === "failed" || r.status === "conflict")
    .map((r) => r.id);
  if (!failed.length)
    throw new OrganizationError("nothing-to-retry", "All items already succeeded.", 409);
  const request = original.request;
  if (request.kind === "bookmark")
    return editBookmark(db, request.id, { ...request.input, operationId });
  const input: OrganizationOperationInput = { ...request.input, operationId };
  if (input.action === "bookmarks.update") {
    input.bookmarkIds = failed;
    delete input.selectionId;
    // A rejected Add/Remove tags operation is recalculated from current tags
    // after the user resolves its limit. Genuine concurrency conflicts retain
    // their original expected versions and still require review.
    if (input.expected) {
      input.expected = { ...input.expected };
      for (const item of original.receipt.results)
        if (item.error?.code === "tag-limit" && input.expected[item.id]) {
          const versions = { ...input.expected[item.id] };
          delete versions.tags;
          input.expected[item.id] = versions;
        }
    }
  }
  return executeOrganizationOperation(db, input);
}

async function applyBookmarkBatch(
  db: SqlExecutor & Pick<Db, "batch">,
  ids: string[],
  changes: BulkBookmarkChanges,
  expected: Record<string, Record<string, string>> | undefined,
  j: Journal,
): Promise<OrganizationItemResult[]> {
  const { bookmarks, states } = await loadBookmarkSnapshot(db, ids);
  const folders = await organizationFolders(db),
    labels = await organizationLabels(db);
  const statements: PreparedBookmarkEdit["statements"] = [];
  const results: OrganizationItemResult[] = [];
  for (const id of ids) {
    const state = states.get(id) ?? {
      folderId: null,
      readingState: "not_on_list" as const,
      overrides: {},
      versions: {},
    };
    try {
      results.push(
        await applyBookmark(db, id, changes, expected?.[id], j, true, {
          bookmark: bookmarks.get(id) ?? null,
          state,
          folders,
          labels,
          statements,
        }),
      );
    } catch (error) {
      results.push(resultError(id, error, "bookmark", bookmarks.get(id)?.title));
    }
  }
  await flushStatements(db, statements);
  return results;
}
