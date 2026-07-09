import type { Bookmark, ListBookmarksQuery, MetaResponse, OpenGraph, Source } from "@bookmark-ai/types";
import type { Db } from "../client";
import { BOOKMARK_COLUMNS, rowToBookmark } from "../rows";

export interface InsertBookmark {
  id: string;
  url: string;
  domain: string;
  title: string;
  description: string | null;
  og: OpenGraph;
  source: Source;
  category: string;
  tags: string[];
  createdAt: string;
}

/** Insert a bookmark. Re-saving the same URL updates it in place (upsert). */
export async function insertBookmark(db: Db, b: InsertBookmark): Promise<Bookmark> {
  const savedDay = b.source.savedAt.slice(0, 10);
  await db.execute({
    sql: `
      INSERT INTO bookmarks
        (id, url, domain, title, description, og_json,
         browser, device, device_name, os, saved_at, saved_day,
         category, tags_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (url) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        og_json = excluded.og_json,
        browser = excluded.browser,
        device = excluded.device,
        device_name = excluded.device_name,
        os = excluded.os,
        saved_at = excluded.saved_at,
        saved_day = excluded.saved_day,
        category = excluded.category,
        tags_json = excluded.tags_json,
        embedding = NULL
    `,
    args: [
      b.id,
      b.url,
      b.domain,
      b.title,
      b.description,
      JSON.stringify(b.og),
      b.source.browser,
      b.source.device,
      b.source.deviceName ?? null,
      b.source.os ?? null,
      b.source.savedAt,
      savedDay,
      b.category,
      JSON.stringify(b.tags),
      b.createdAt,
    ],
  });
  const saved = await getBookmarkByUrl(db, b.url);
  if (!saved) throw new Error("insertBookmark: row not found after upsert");
  return saved;
}

export async function getBookmark(db: Db, id: string): Promise<Bookmark | null> {
  const rs = await db.execute({
    sql: `SELECT ${BOOKMARK_COLUMNS} FROM bookmarks WHERE id = ?`,
    args: [id],
  });
  const row = rs.rows[0];
  return row ? rowToBookmark(row) : null;
}

export async function getBookmarkByUrl(db: Db, url: string): Promise<Bookmark | null> {
  const rs = await db.execute({
    sql: `SELECT ${BOOKMARK_COLUMNS} FROM bookmarks WHERE url = ?`,
    args: [url],
  });
  const row = rs.rows[0];
  return row ? rowToBookmark(row) : null;
}

export async function deleteBookmark(db: Db, id: string): Promise<boolean> {
  const rs = await db.execute({ sql: "DELETE FROM bookmarks WHERE id = ?", args: [id] });
  return rs.rowsAffected > 0;
}

export async function listBookmarks(
  db: Db,
  q: ListBookmarksQuery,
): Promise<{ bookmarks: Bookmark[]; total: number }> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q.category) {
    where.push("category = ?");
    args.push(q.category);
  }
  if (q.browser) {
    where.push("browser = ?");
    args.push(q.browser);
  }
  if (q.device) {
    where.push("device = ?");
    args.push(q.device);
  }
  if (q.day) {
    where.push("saved_day = ?");
    args.push(q.day);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [rows, count] = await Promise.all([
    db.execute({
      sql: `SELECT ${BOOKMARK_COLUMNS} FROM bookmarks ${whereSql}
            ORDER BY saved_at DESC LIMIT ? OFFSET ?`,
      args: [...args, q.limit, q.offset],
    }),
    db.execute({
      sql: `SELECT count(*) AS n FROM bookmarks ${whereSql}`,
      args,
    }),
  ]);

  return {
    bookmarks: rows.rows.map(rowToBookmark),
    total: Number(count.rows[0]?.n ?? 0),
  };
}

/** Facet counts that drive every client's sidebar. */
export async function getMeta(db: Db): Promise<MetaResponse> {
  const [categories, browsers, devices, days, total] = await Promise.all([
    db.execute("SELECT category AS name, count(*) AS count FROM bookmarks GROUP BY category ORDER BY count DESC, name"),
    db.execute("SELECT browser AS name, count(*) AS count FROM bookmarks GROUP BY browser ORDER BY count DESC"),
    db.execute("SELECT device AS name, count(*) AS count FROM bookmarks GROUP BY device ORDER BY count DESC"),
    db.execute("SELECT saved_day AS day, count(*) AS count FROM bookmarks GROUP BY saved_day ORDER BY day DESC LIMIT 30"),
    db.execute("SELECT count(*) AS n FROM bookmarks"),
  ]);
  return {
    categories: categories.rows.map((r) => ({ name: String(r.name), count: Number(r.count) })),
    browsers: browsers.rows.map((r) => ({ name: r.name as any, count: Number(r.count) })),
    devices: devices.rows.map((r) => ({ name: r.name as any, count: Number(r.count) })),
    days: days.rows.map((r) => ({ day: String(r.day), count: Number(r.count) })),
    total: Number(total.rows[0]?.n ?? 0),
  };
}
