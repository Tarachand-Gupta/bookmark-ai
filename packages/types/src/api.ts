import { z } from "zod";
import { bookmarkSchema, browserSchema, deviceTypeSchema } from "./bookmark";

/** POST /api/bookmarks — save a URL. OG scraping + categorization happen server-side. */
export const createBookmarkSchema = z.object({
  url: z.string().url(),
  /** Page title as seen by the client (fallback if OG scrape fails). */
  title: z.string().nullish(),
  browser: browserSchema.default("other"),
  device: deviceTypeSchema.default("other"),
  deviceName: z.string().nullish(),
  os: z.string().nullish(),
  savedAt: z.string().datetime({ offset: true }).optional(),
});
export type CreateBookmarkInput = z.infer<typeof createBookmarkSchema>;

/** GET /api/bookmarks query params. */
export const listBookmarksQuerySchema = z.object({
  category: z.string().optional(),
  browser: browserSchema.optional(),
  device: deviceTypeSchema.optional(),
  /** Exact tag match (tags are stored lowercased). */
  tag: z.string().optional(),
  /** YYYY-MM-DD — bookmarks saved on this day. */
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** YYYY-MM-DD inclusive bounds — a saved-day range filter (either end optional). */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListBookmarksQuery = z.infer<typeof listBookmarksQuerySchema>;

// ── Sessions (saved snapshots of open browser tabs) ─────────────────────────
// Defined before search so session results can appear in search responses.

/** One tab within a saved session. */
export const sessionTabSchema = z.object({
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
  tabs: z.array(sessionTabSchema).min(1),
  browser: browserSchema.default("other"),
  device: deviceTypeSchema.default("other"),
  savedAt: z.string().datetime({ offset: true }).optional(),
});
export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const sessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  tabs: z.array(sessionTabSchema),
  tabCount: z.number(),
  browser: browserSchema,
  device: deviceTypeSchema,
  savedAt: z.string(),
  createdAt: z.string(),
});
export type Session = z.infer<typeof sessionSchema>;

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

