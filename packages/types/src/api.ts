import { z } from "zod";
import { bookmarkSchema, browserSchema, deviceTypeSchema, httpUrlSchema } from "./bookmark";

/** POST /api/bookmarks — save a URL. OG scraping + categorization happen server-side. */
export const createBookmarkSchema = z.object({
  url: httpUrlSchema,
  /** Page title as seen by the client (fallback if OG scrape fails). */
  title: z.string().nullish(),
  browser: browserSchema.default("other"),
  device: deviceTypeSchema.default("other"),
  deviceName: z.string().nullish(),
  os: z.string().nullish(),
  savedAt: z.string().datetime({ offset: true }).optional(),
  /** Caller-supplied tags merged into the heuristic/AI tags (lowercased here so
   * they match the stored/FTS vocabulary; capped — tags are a search aid, not a
   * payload). Used by the native-sync extension paths (e.g. reading-list saves
   * get "reading" + "article" so they're findable later). */
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(10).optional(),
});
export type CreateBookmarkInput = z.infer<typeof createBookmarkSchema>;

/** A YYYY-MM-DD calendar day. */
const dayOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const isoDatetimeSchema = z.string().datetime({ offset: true });

/**
 * One end of a saved-at range: either a calendar day (whole-day bound) or a full
 * ISO datetime, so sub-day windows ("the last hour") are expressible. A union
 * would report two errors for one bad value; refine keeps the message single and
 * readable, and reuses the same `.datetime({ offset: true })` validation the
 * write paths use rather than a hand-rolled regex.
 *
 * Exported so non-REST callers that build the same query by hand (the MCP
 * `list_bookmarks` tool declares its own arg parser) validate a bound with THIS
 * schema instead of a second, drifting copy of the rule.
 */
export const savedAtBoundSchema = z
  .string()
  .refine(
    (v) => dayOnlySchema.safeParse(v).success || isoDatetimeSchema.safeParse(v).success,
    "Expected YYYY-MM-DD or an ISO 8601 datetime (e.g. 2026-08-11T15:00:00Z)",
  );

/** GET /api/bookmarks query params. */
export const listBookmarksQuerySchema = z.object({
  category: z.string().optional(),
  browser: browserSchema.optional(),
  device: deviceTypeSchema.optional(),
  /** Exact tag match (tags are stored lowercased). */
  tag: z.string().optional(),
  /** Exact URL match — the native-sync delete path resolves a bookmark id from
   * the URL the browser just removed. */
  url: httpUrlSchema.optional(),
  /** YYYY-MM-DD — bookmarks saved on this day. */
  day: dayOnlySchema.optional(),
  /** INCLUSIVE saved-at range bounds, either end optional. A date-only
   * YYYY-MM-DD is a WHOLE-day bound (`from` = that day's first instant, `to` =
   * its last), so the pre-datetime behaviour is unchanged; a full ISO datetime
   * expresses a sub-day window ("saved in the last hour"). The DB widens both
   * into a half-open `saved_at` interval — see packages/db/src/date-bounds.ts. */
  from: savedAtBoundSchema.optional(),
  to: savedAtBoundSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListBookmarksQuery = z.infer<typeof listBookmarksQuerySchema>;

// ── Sessions (saved snapshots of open browser tabs) ─────────────────────────
// Defined before search so session results can appear in search responses.

/** One tab within a saved session. */
export const sessionTabSchema = z.object({
  // A saved session snapshots EVERY open tab, which legitimately includes
  // browser-internal pages (chrome://, about:blank, moz-extension://…). Keep
  // this permissive — XSS from a hostile tab URL is handled at the render layer
  // (only http/https are emitted as clickable links; everything else is text).
  url: z.string(),
  title: z.string().default(""),
  favIconUrl: z.string().nullish(),
  /** Source window grouping, so a restore can rebuild the window layout. */
  windowId: z.number().int().optional(),
});
export type SessionTab = z.infer<typeof sessionTabSchema>;

/** POST /api/sessions — save a snapshot of the currently open tabs. */
export const createSessionSchema = z.object({
  name: z.string().max(200).optional(),
  // Cap tabs per session — generous (a real snapshot is far smaller) but bounds
  // an abusive payload. Mirrored on the export bundle's session tabs.
  tabs: z.array(sessionTabSchema).min(1).max(500),
  browser: browserSchema.default("other"),
  device: deviceTypeSchema.default("other"),
  // Free-form OS string as the client reports it ("macOS", "Windows", "iOS", …);
  // rendered as an identifier badge. Capped like the live-push OS field.
  os: z.string().max(40).nullish(),
  savedAt: z.string().datetime({ offset: true }).optional(),
});
export type CreateSessionInput = z.infer<typeof createSessionSchema>;

/** PATCH /api/sessions/:id — rename a saved session. */
export const updateSessionSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
});
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;

export const sessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  tabs: z.array(sessionTabSchema),
  tabCount: z.number(),
  /** AI's read of the window: 1-2 sentences on what this group of tabs was
   * about. Written post-save (Next `after()`) and refreshed by the Summarize
   * affordance; null until then, or when no AI key is configured. */
  description: z.string().nullable(),
  browser: browserSchema,
  device: deviceTypeSchema,
  os: z.string().nullable(),
  savedAt: z.string(),
  createdAt: z.string(),
});
export type Session = z.infer<typeof sessionSchema>;

/**
 * POST /api/sessions/:id/ai-name — the AI summary of a saved session, APPLIED.
 * `name`/`description` are echoed at the top level (the pre-description shape
 * kept `name` there, so old clients keep working) alongside the full updated
 * session. `fallback: true` = heuristic name, no AI (no key or the call failed),
 * in which case `description` is null.
 */
export const summarizeSessionResponseSchema = z.object({
  session: sessionSchema,
  name: z.string(),
  description: z.string().nullable(),
  fallback: z.boolean().optional(),
});
export type SummarizeSessionResponse = z.infer<typeof summarizeSessionResponseSchema>;

export const listSessionsResponseSchema = z.object({
  sessions: z.array(sessionSchema),
});
export type ListSessionsResponse = z.infer<typeof listSessionsResponseSchema>;

/** `hybrid` blends full-text and semantic rankings (Reciprocal Rank Fusion). */
export const searchModeSchema = z.enum(["text", "ai", "hybrid"]);
export type SearchMode = z.infer<typeof searchModeSchema>;

/** GET /api/search query params. */
export const searchQuerySchema = z.object({
  q: z.string().min(1),
  mode: searchModeSchema.default("text"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchResultSchema = z.object({
  bookmark: bookmarkSchema,
  /** FTS rank or vector similarity, higher is better. */
  score: z.number(),
  /** Hybrid mode only: true when the keyword (full-text) list found this
   * result — clients section these as "matches" vs "related". */
  exact: z.boolean().optional(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const sessionSearchResultSchema = z.object({
  session: sessionSchema,
  score: z.number(),
});
export type SessionSearchResult = z.infer<typeof sessionSearchResultSchema>;

export const searchResponseSchema = z.object({
  mode: searchModeSchema,
  results: z.array(searchResultSchema),
  /** Matching saved sessions (name/tab text) — kept separate from bookmark
   * results so clients can present the two kinds distinctly. */
  sessionResults: z.array(sessionSearchResultSchema).optional(),
  /** Set when an AI search silently fell back to full-text (e.g. no API key). */
  fallback: z.boolean().optional(),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const listBookmarksResponseSchema = z.object({
  bookmarks: z.array(bookmarkSchema),
  total: z.number(),
});
export type ListBookmarksResponse = z.infer<typeof listBookmarksResponseSchema>;

/** GET /api/health — liveness plus whether AI (Gemini) is configured. */
export const healthResponseSchema = z.object({
  ok: z.boolean(),
  ai: z.boolean(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** GET /api/meta — sidebar facets + the tag rail. */
export const metaResponseSchema = z.object({
  categories: z.array(z.object({ name: z.string(), count: z.number() })),
  browsers: z.array(z.object({ name: browserSchema, count: z.number() })),
  devices: z.array(z.object({ name: deviceTypeSchema, count: z.number() })),
  days: z.array(z.object({ day: z.string(), count: z.number() })),
  /** Most-used tags (top 24) for the homepage chip rail. */
  tags: z.array(z.object({ name: z.string(), count: z.number() })),
  total: z.number(),
});
export type MetaResponse = z.infer<typeof metaResponseSchema>;

