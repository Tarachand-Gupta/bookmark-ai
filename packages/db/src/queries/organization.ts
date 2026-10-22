import { randomUUID } from "node:crypto";
import type { Db } from "../client";
import type { Bookmark, OrganizationFilters, ReadingState } from "@bookmark-ai/types";
export type SqlExecutor = Pick<Db, "execute">;
export interface ManualOverrides {
  title?: boolean;
  category?: boolean;
  addedTags?: string[];
  removedTags?: string[];
}
export interface BookmarkOrganization {
  folderId: string | null;
  readingState: ReadingState;
  overrides: ManualOverrides;
  versions: Record<string, string>;
}
export interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  deleted: boolean;
  versions: Record<string, string>;
}
export interface LabelRecord {
  id: string;
  kind: "category" | "tag";
  name: string;
  deleted: boolean;
  aliasTo: string | null;
  versions: Record<string, string>;
}
export const normalizeOrganizationName = (name: string) =>
  name.trim().normalize("NFKC").toLocaleLowerCase("en-US");
export function json<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}
export async function getBookmarkOrganization(
  db: SqlExecutor,
  id: string,
): Promise<BookmarkOrganization> {
  const r = (
    await db.execute({ sql: "SELECT * FROM bookmark_organization WHERE bookmark_id=?", args: [id] })
  ).rows[0];
  return {
    folderId: r?.folder_id == null ? null : String(r.folder_id),
    readingState: (r?.reading_state as ReadingState) ?? "not_on_list",
    overrides: json(r?.overrides_json, {}),
    versions: json(r?.versions_json, {}),
  };
}
export function bookmarkOrganizationStatement(id: string, s: BookmarkOrganization) {
  return {
    sql: `INSERT INTO bookmark_organization(bookmark_id,folder_id,reading_state,overrides_json,versions_json) VALUES(?,?,?,?,?) ON CONFLICT(bookmark_id) DO UPDATE SET folder_id=excluded.folder_id,reading_state=excluded.reading_state,overrides_json=excluded.overrides_json,versions_json=excluded.versions_json`,
    args: [id, s.folderId, s.readingState, JSON.stringify(s.overrides), JSON.stringify(s.versions)],
  };
}
export async function putBookmarkOrganization(
  db: SqlExecutor,
  id: string,
  s: BookmarkOrganization,
) {
  await db.execute(bookmarkOrganizationStatement(id, s));
}
export async function organizationFolders(db: SqlExecutor, all = false): Promise<FolderRecord[]> {
  return (
    await db.execute(
      `SELECT * FROM organization_folders ${all ? "" : "WHERE deleted=0"} ORDER BY normalized_name,id`,
    )
  ).rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    parentId: r.parent_id == null ? null : String(r.parent_id),
    deleted: !!r.deleted,
    versions: json(r.versions_json, {}),
  }));
}
export function folderStatement(f: FolderRecord) {
  return {
    sql: `INSERT INTO organization_folders(id,name,normalized_name,parent_id,deleted,versions_json) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,normalized_name=excluded.normalized_name,parent_id=excluded.parent_id,deleted=excluded.deleted,versions_json=excluded.versions_json`,
    args: [
      f.id,
      f.name,
      normalizeOrganizationName(f.name),
      f.parentId,
      Number(f.deleted),
      JSON.stringify(f.versions),
    ],
  };
}
export async function putFolder(db: SqlExecutor, f: FolderRecord) {
  await db.execute(folderStatement(f));
}
export async function organizationLabels(db: SqlExecutor, all = false): Promise<LabelRecord[]> {
  return (
    await db.execute(
      `SELECT * FROM organization_labels ${all ? "" : "WHERE deleted=0"} ORDER BY normalized_name,id`,
    )
  ).rows.map((r) => ({
    id: String(r.id),
    kind: r.kind as LabelRecord["kind"],
    name: String(r.name),
    deleted: !!r.deleted,
    aliasTo: r.alias_to == null ? null : String(r.alias_to),
    versions: json(r.versions_json, {}),
  }));
}
export function labelStatement(l: LabelRecord) {
  return {
    sql: `INSERT INTO organization_labels(id,kind,name,normalized_name,deleted,alias_to,versions_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,normalized_name=excluded.normalized_name,deleted=excluded.deleted,alias_to=excluded.alias_to,versions_json=excluded.versions_json`,
    args: [
      l.id,
      l.kind,
      l.name,
      normalizeOrganizationName(l.name),
      Number(l.deleted),
      l.aliasTo,
      JSON.stringify(l.versions),
    ],
  };
}
export async function putLabel(db: SqlExecutor, l: LabelRecord) {
  await db.execute(labelStatement(l));
}
/** Resolve tombstones too: late enrichment cannot resurrect a globally removed/merged label. */
export async function canonicalLabel(
  db: SqlExecutor,
  kind: LabelRecord["kind"],
  name: string,
  create = true,
): Promise<LabelRecord | null> {
  const norm = normalizeOrganizationName(name);
  if (!norm || (kind === "category" && norm === "uncategorized")) return null;
  const rows = await organizationLabels(db, true);
  let l =
    rows.find((l) => l.kind === kind && normalizeOrganizationName(l.name) === norm && !l.deleted) ??
    rows.find((l) => l.kind === kind && normalizeOrganizationName(l.name) === norm);
  if (l) {
    const seen = new Set<string>();
    while (l.deleted && l.aliasTo && !seen.has(l.id)) {
      seen.add(l.id);
      l = rows.find((x) => x.id === l!.aliasTo);
      if (!l) return null;
    }
    return l.deleted ? null : l;
  }
  if (!create) return null;
  l = {
    id: randomUUID(),
    kind,
    name: name.trim(),
    deleted: false,
    aliasTo: null,
    versions: { exists: randomUUID() },
  };
  await putLabel(db, l);
  return l;
}
export async function canonicalContent(
  db: SqlExecutor,
  category: string,
  tags: string[],
): Promise<{ category: string; tags: string[] }> {
  const c = await canonicalLabel(db, "category", category);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of tags) {
    const t = await canonicalLabel(db, "tag", name);
    if (t && !seen.has(t.id)) {
      seen.add(t.id);
      result.push(t.name);
    }
  }
  return { category: c?.name ?? "Uncategorized", tags: result };
}
export function descendantFolderIds(folders: FolderRecord[], id: string): string[] {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of folders)
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        changed = true;
      }
  }
  return [...ids];
}
/** Parameterized predicate shared by list, search, selection, and contextual retrieval. */
export function organizationFilterSql(
  q: OrganizationFilters,
  bookmarkIds?: string[],
): { clauses: string[]; args: (string | number)[] } {
  const clauses: string[] = [];
  const args: (string | number)[] = [];
  if (bookmarkIds) {
    clauses.push("bookmarks.id IN (SELECT value FROM json_each(?))");
    args.push(JSON.stringify(bookmarkIds));
  }
  if (q.folderId !== undefined) {
    if (q.folderId === "unsorted")
      clauses.push(
        "NOT EXISTS(SELECT 1 FROM bookmark_organization bo WHERE bo.bookmark_id=bookmarks.id AND bo.folder_id IS NOT NULL)",
      );
    else if (q.includeSubfolders !== false) {
      clauses.push(
        `bookmarks.id IN(SELECT bookmark_id FROM bookmark_organization WHERE folder_id IN(WITH RECURSIVE descendants(id) AS(SELECT id FROM organization_folders WHERE id=? AND deleted=0 UNION SELECT f.id FROM organization_folders f JOIN descendants d ON f.parent_id=d.id WHERE f.deleted=0) SELECT id FROM descendants))`,
      );
      args.push(q.folderId);
    } else {
      clauses.push(
        "bookmarks.id IN(SELECT bookmark_id FROM bookmark_organization WHERE folder_id=?)",
      );
      args.push(q.folderId);
    }
  }
  if (q.categoryId) {
    if (q.categoryId === "uncategorized")
      clauses.push("lower(trim(bookmarks.category))='uncategorized'");
    else {
      clauses.push(
        "EXISTS(SELECT 1 FROM organization_labels l WHERE l.id=? AND l.kind='category' AND l.deleted=0 AND lower(trim(l.name))=lower(trim(bookmarks.category)))",
      );
      args.push(q.categoryId);
    }
  }
  if (q.tagId) {
    clauses.push(
      "EXISTS(SELECT 1 FROM organization_labels l,json_each(bookmarks.tags_json) t WHERE l.id=? AND l.kind='tag' AND l.deleted=0 AND lower(trim(l.name))=lower(trim(t.value)))",
    );
    args.push(q.tagId);
  }
  if (q.readingState) {
    if (q.readingState === "not_on_list")
      clauses.push(
        "COALESCE((SELECT reading_state FROM bookmark_organization WHERE bookmark_id=bookmarks.id),'not_on_list')='not_on_list'",
      );
    else {
      clauses.push(
        `bookmarks.id IN(SELECT bookmark_id FROM bookmark_organization WHERE reading_state ${q.readingState === "on_list" ? "IN('unread','read')" : "=?"})`,
      );
      if (q.readingState !== "on_list") args.push(q.readingState);
    }
  }
  return { clauses, args };
}
export async function ensureImportFolderPath(
  db: SqlExecutor,
  path: string[],
): Promise<string | null> {
  let parentId: string | null = null;
  const folders = await organizationFolders(db);
  for (const part of path) {
    const name = part.trim();
    if (!name) continue;
    if (name.length > 80) throw new Error("Folder name exceeds 80 characters");
    let folder = folders.find(
      (f) =>
        f.parentId === parentId &&
        normalizeOrganizationName(f.name) === normalizeOrganizationName(name),
    );
    if (!folder) {
      folder = {
        id: randomUUID(),
        name,
        parentId,
        deleted: false,
        versions: { exists: randomUUID(), name: randomUUID(), parentId: randomUUID() },
      };
      await putFolder(db, folder);
      folders.push(folder);
    }
    parentId = folder.id;
  }
  return parentId;
}
export async function setImportedBookmarkOrganization(
  db: SqlExecutor,
  id: string,
  input: { folderId: string | null; titleOverride?: boolean },
) {
  const state = await getBookmarkOrganization(db, id);
  state.folderId = input.folderId;
  state.versions.folderId = randomUUID();
  if (input.titleOverride) {
    state.overrides.title = true;
    state.versions.title = randomUUID();
  }
  await putBookmarkOrganization(db, id, state);
}
