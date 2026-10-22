import { randomUUID } from "node:crypto";
import type { Db } from "../client";
import type { OrganizationFilters } from "@bookmark-ai/types";
export type SqlExecutor = Pick<Db, "execute">;
export interface ManualOverrides {
  title?: boolean;
  category?: boolean;
  addedTags?: string[];
  removedTags?: string[];
}
export interface BookmarkOrganization {
  overrides: ManualOverrides;
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
    overrides: json(r?.overrides_json, {}),
    versions: json(r?.versions_json, {}),
  };
}
export function bookmarkOrganizationStatement(id: string, s: BookmarkOrganization) {
  return {
    sql: `INSERT INTO bookmark_organization(bookmark_id,overrides_json,versions_json) VALUES(?,?,?) ON CONFLICT(bookmark_id) DO UPDATE SET overrides_json=excluded.overrides_json,versions_json=excluded.versions_json`,
    args: [id, JSON.stringify(s.overrides), JSON.stringify(s.versions)],
  };
}
export async function putBookmarkOrganization(
  db: SqlExecutor,
  id: string,
  s: BookmarkOrganization,
) {
  await db.execute(bookmarkOrganizationStatement(id, s));
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
  return { clauses, args };
}
