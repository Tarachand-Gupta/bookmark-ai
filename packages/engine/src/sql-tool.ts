import type { Db } from "@bookmark-ai/db";

/**
 * Read-only SQL runner for the chat agent's `queryDatabase` tool. The agent
 * writes arbitrary SQL to answer counting/aggregate/filter questions; these
 * rails keep that strictly read-only and bounded:
 *
 *  1. Comments and quoted spans are stripped first, then the "code" is checked
 *     so a `;`, keyword, or `--` hidden inside a string literal can't smuggle
 *     anything past the guards (nor trip a false positive on a quoted identifier).
 *  2. Exactly one statement — any interior `;` is rejected.
 *  3. The first meaningful token must be SELECT or WITH.
 *  4. A word-boundary blocklist rejects every mutating / side-effecting keyword
 *     anywhere in the query (word-boundary so `created_at`, `tags_json`, … pass).
 *  5. The query always runs wrapped in `SELECT * FROM ( … ) LIMIT n`, so even a
 *     pathological SELECT can't return an unbounded result set.
 *  6. A Promise.race timeout bounds wall-clock time. NOTE: libSQL has no
 *     per-query cancellation, so a slow query keeps running server-side after
 *     the race rejects — the timeout protects the request, not the DB.
 *  7. Blob/binary cells (e.g. the `embedding` vector) become "<blob>" and long
 *     strings are clipped, so a tool result can never dump a raw vector or an
 *     unbounded document into the model context.
 */

/** Result of {@link runReadOnlySql}. `rows` are positional, aligned to `columns`. */
export interface ReadOnlySqlResult {
  columns: string[];
  rows: unknown[][];
  /** Rows in THIS page (`rows.length`). */
  rowCount: number;
  /** True when the output was reduced: a string cell was clipped, or the row cap was hit. */
  truncated: boolean;
  /** Rows skipped before this page (the `offset` that produced it). */
  offset: number;
  /** The page size that produced it. */
  limit: number;
  /** Total rows the query matches, when `countTotal` was asked for. */
  total?: number;
  /** True when more rows follow this page. */
  hasMore: boolean;
  /** The `offset` that fetches the next page, or null at the end. */
  nextOffset: number | null;
}

export interface RunReadOnlySqlOptions {
  /** Hard row cap applied by the wrapping SELECT (default 200). */
  limit?: number;
  /** Rows to skip — the paging offset applied by the wrapping SELECT (default 0). */
  offset?: number;
  /**
   * Also run `SELECT COUNT(*) FROM (<query>)` so the caller can show "rows
   * 51–100 of N" and decide whether to page. Off by default: it doubles the
   * work, and only the paged chat surface needs it.
   */
  countTotal?: boolean;
  /** Wall-clock timeout in ms before the race rejects (default 10_000). */
  timeoutMs?: number;
  /** Max characters kept per string cell before clipping (default 400). */
  maxCellChars?: number;
}

const DEFAULT_LIMIT = 200;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CELL_CHARS = 400;

/**
 * Mutating / side-effecting keywords rejected anywhere in the query. Matched
 * with `\b…\b`, so a column or alias that merely *contains* one of these as a
 * substring (`created_at`, `updated_at`, `is_deleted`) is unaffected — only the
 * standalone keyword is blocked. `REPLACE` is blocked too (it doubles as a
 * scalar function, but `REPLACE INTO` is a write path — the conservative call).
 */
const BLOCKED_KEYWORDS = [
  "PRAGMA",
  "ATTACH",
  "DETACH",
  "VACUUM",
  "REINDEX",
  "ANALYZE",
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "REPLACE",
  "TRANSACTION",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  // SECURITY (finding #10): a `WITH RECURSIVE` CTE escapes the outer
  // `SELECT * FROM (…) LIMIT n` wrapper and can loop unbounded server-side, past
  // the client-side timeout race. Block the keyword — unlikely as a real identifier.
  "RECURSIVE",
];

/**
 * SECURITY (finding #8): identifiers the agent's generated SQL must never touch.
 * The DB also holds secrets (`user_settings.ai_api_key`) and internal catalogs;
 * a prompt-injected query could `SELECT ai_api_key FROM user_settings` to
 * exfiltrate the key, or read the schema via the sqlite_* catalogs. Matched with
 * `\b…\b`, case-insensitive, on the comment/string-stripped "code" so comments
 * can't evade it. A denylist (vs a full parser) is robust against CTE-alias
 * false-rejects and is intentionally not over-engineered.
 */
const BLOCKED_IDENTIFIERS = [
  "user_settings", // holds the (encrypted-at-rest) ai_api_key secret + provider config
  "live_devices", // per-device open-tab checkpoints — sensitive, never agent-readable (§5.5)
  "live_settings", // the live-sessions opt-in flag
  "chat_conversations", // persisted AI chat — conversation content, never agent-readable
  "chat_messages", // persisted AI chat message parts (incl. tool results)
  "ai_usage", // free-tier token meter bookkeeping
  "schema_migrations", // internal migration bookkeeping
  "sqlite_master", // catalog: full schema of every object
  "sqlite_schema", // alias of sqlite_master
  "sqlite_temp_master", // temp-object catalog
  "sqlite_temp_schema", // alias of sqlite_temp_master
];

/**
 * Strip line/block comments and quoted spans (single, double, backtick, and
 * `[bracket]` identifiers), replacing each with a single space. A single-pass
 * scanner is used rather than sequential regexes so the classic ordering bugs
 * (a `--` inside a string, a `'` inside a comment) can't misfire. The result is
 * "code only" — safe to scan for `;` and keywords.
 */
function stripToCode(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql.charAt(i);
    const next = sql.charAt(i + 1);

    if (c === "-" && next === "-") {
      i += 2;
      while (i < n && sql.charAt(i) !== "\n") i++;
      out += " ";
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(sql.charAt(i) === "*" && sql.charAt(i + 1) === "/")) i++;
      i += 2; // consume the closing */
      out += " ";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      i++;
      while (i < n) {
        if (sql.charAt(i) === quote) {
          if (sql.charAt(i + 1) === quote) {
            i += 2; // doubled quote is an escaped literal quote — stay inside
            continue;
          }
          i++; // consume the closing quote
          break;
        }
        i++;
      }
      out += " ";
      continue;
    }
    if (c === "[") {
      i++;
      while (i < n && sql.charAt(i) !== "]") i++;
      i++; // consume ]
      out += " ";
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

/** Validate the query is a single read-only statement; throw a clear error otherwise. */
function assertReadOnly(query: string): void {
  const raw = query.trim();
  if (!raw) throw new Error("Empty SQL query");

  const code = stripToCode(query);

  // One statement only: strip a trailing `;` (+ whitespace), then any remaining
  // `;` means a second statement was appended.
  const withoutTrailing = code.replace(/[\s;]+$/, "");
  if (withoutTrailing.includes(";")) {
    throw new Error("Only a single SQL statement is allowed (no `;`-separated statements)");
  }

  if (!/^\s*(select|with)\b/i.test(code)) {
    throw new Error("Only read-only SELECT / WITH queries are allowed");
  }

  for (const kw of BLOCKED_KEYWORDS) {
    if (new RegExp(`\\b${kw}\\b`, "i").test(code)) {
      throw new Error(`Blocked keyword in query: ${kw}`);
    }
  }

  // SECURITY (finding #9): the `\bPRAGMA\b` rule misses the table-valued function
  // forms — `pragma_table_info(...)` (the `_` is a word char, so there's no
  // boundary) and `pragma(...)`. Block both call shapes explicitly.
  if (/\bpragma_\w+\s*\(/i.test(code) || /\bpragma\s*\(/i.test(code)) {
    throw new Error("Blocked PRAGMA function in query");
  }

  // SECURITY (finding #8): reject any reference to secret-bearing or internal
  // catalog tables so a prompt-injected query can't exfiltrate them.
  for (const id of BLOCKED_IDENTIFIERS) {
    if (new RegExp(`\\b${id}\\b`, "i").test(code)) {
      throw new Error(`Blocked table/identifier in query: ${id}`);
    }
  }
}

/** Normalize one cell for the model: blobs → "<blob>", clip long strings, JSON-safe bigints. */
function normalizeCell(
  value: unknown,
  maxChars: number,
): { value: unknown; truncated: boolean } {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return { value: "<blob>", truncated: false };
  }
  if (typeof value === "bigint") {
    // JSON can't serialize bigint — keep it a number when safe, else a string.
    const asNum = Number(value);
    return { value: Number.isSafeInteger(asNum) ? asNum : value.toString(), truncated: false };
  }
  if (typeof value === "string" && value.length > maxChars) {
    return { value: `${value.slice(0, maxChars)}…`, truncated: true };
  }
  return { value, truncated: false };
}

/**
 * Execute a read-only SQL query against `db` and return a compact, bounded
 * result. Throws on any guard violation (see the module header) or DB error;
 * callers should surface the message so the agent can correct its SQL.
 */
export async function runReadOnlySql(
  db: Db,
  query: string,
  opts: RunReadOnlySqlOptions = {},
): Promise<ReadOnlySqlResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxCellChars = opts.maxCellChars ?? DEFAULT_MAX_CELL_CHARS;

  assertReadOnly(query);

  // Strip the query's own trailing `;`/whitespace, then wrap so the row cap and
  // the paging offset always apply. The wrapper's `)` and LIMIT sit on their own
  // lines so a trailing line comment inside the query can't comment them out.
  // One row MORE than the page is fetched: its presence is `hasMore` without a
  // second query, and it is dropped before the result is returned.
  const inner = query.replace(/[\s;]+$/, "");
  const wrapped = `SELECT * FROM (\n${inner}\n) LIMIT ${limit + 1} OFFSET ${offset}`;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Query exceeded the ${timeoutMs}ms time limit`)),
      timeoutMs,
    );
  });

  try {
    const rs = await Promise.race([db.execute(wrapped), timeout]);
    const columns = rs.columns.slice();
    let truncated = false;
    const all: unknown[][] = rs.rows.map((row) =>
      columns.map((_, idx) => {
        const cell = normalizeCell(row[idx], maxCellChars);
        if (cell.truncated) truncated = true;
        return cell.value;
      }),
    );
    const hasMore = all.length > limit;
    const rows = hasMore ? all.slice(0, limit) : all;
    // Callers page instead of being silently cut off, so a full page is no
    // longer "truncated" — only a clipped CELL is.
    const total = opts.countTotal ? await countReadOnlySql(db, query, { timeoutMs }) : undefined;
    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated,
      offset,
      limit,
      ...(total === undefined ? {} : { total }),
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * How many rows the query matches in total, for the paging UI's "rows 51–100 of
 * N". Runs the SAME read-only guards, wrapping the caller's SELECT in a COUNT so
 * no rows travel. Returns 0 on an empty/odd result rather than throwing on the
 * shape.
 */
export async function countReadOnlySql(
  db: Db,
  query: string,
  opts: { timeoutMs?: number } = {},
): Promise<number> {
  assertReadOnly(query);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const inner = query.replace(/[\s;]+$/, "");
  const wrapped = `SELECT COUNT(*) AS n FROM (\n${inner}\n)`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Query exceeded the ${timeoutMs}ms time limit`)), timeoutMs);
  });
  try {
    const rs = await Promise.race([db.execute(wrapped), timeout]);
    const n = rs.rows[0]?.[0];
    return typeof n === "bigint" ? Number(n) : typeof n === "number" ? n : Number(n ?? 0) || 0;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
