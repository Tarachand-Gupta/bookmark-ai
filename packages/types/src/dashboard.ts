import { z } from "zod";
import { bookmarkSchema, browserSchema, deviceTypeSchema } from "./bookmark";

/**
 * GET /api/dashboard — the aggregated landing-page payload (docs/features/dashboard.md).
 *
 * THE FIELD NAMES HERE ARE FROZEN: web and mobile are built against this shape in
 * parallel, so add fields rather than renaming them. Everything is computed from
 * existing columns (no schema change) in a single round-trip of cheap parallel
 * queries — see `getDashboard` in packages/engine/src/dashboard.ts.
 *
 * Deliberately NOT in here: live-device state. The live server is a separate
 * origin with its own auth, so this endpoint can't forward the caller's
 * credentials to it — clients compose "live now" client-side from the existing
 * live SSE hook and blend it into the "continue" ranking themselves.
 */

/** A saved session without its tab payload — enough to render a shelf row. */
export const sessionSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  tabCount: z.number().int(),
  /** AI's read of the session (see `sessionSchema.description`) — the shelf
   * renders it as one quiet truncated line. Null until enrichment lands. */
  description: z.string().nullable(),
  browser: browserSchema,
  device: deviceTypeSchema,
  os: z.string().nullable(),
  savedAt: z.string(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

/** One openable tab of the newest saved session (for the hero's "Open all"). */
export const dashboardSessionTabSchema = z.object({
  // Permissive like sessionTabSchema — a snapshot legitimately contains
  // chrome://, about:blank and friends. Guarded at the render/open layer.
  url: z.string(),
  title: z.string().optional(),
  favIconUrl: z.string().nullish(),
});
export type DashboardSessionTab = z.infer<typeof dashboardSessionTabSchema>;

/** Newest saved session's first tabs — the "Open all in new window" payload. */
export const dashboardLastSessionSchema = z.object({
  id: z.string(),
  tabs: z.array(dashboardSessionTabSchema),
});
export type DashboardLastSession = z.infer<typeof dashboardLastSessionSchema>;

/** A `{name, count}` facet pair (categories, browsers). */
export const dashboardFacetSchema = z.object({ name: z.string(), count: z.number().int() });
export type DashboardFacet = z.infer<typeof dashboardFacetSchema>;

/**
 * The three facts the Activity card shows. `null` on the whole object when the
 * account has too few bookmarks for a chart to mean anything (see
 * ACTIVITY_MIN_BOOKMARKS) — clients hide the card entirely rather than draw a
 * flat line.
 *
 * `days` is always exactly 14 entries, ascending, zero-filled, keyed by the
 * STORED `saved_day` (UTC). Turning those keys into local-date labels is the
 * client's business; the sparkline only needs the shape.
 */
export const dashboardActivitySchema = z.object({
  days: z.array(z.object({ day: z.string(), count: z.number().int() })),
  /** Top 3, "Uncategorized" excluded. */
  topCategories: z.array(dashboardFacetSchema),
  /** Every browser that ever saved, descending. */
  browserSplit: z.array(dashboardFacetSchema),
});
export type DashboardActivity = z.infer<typeof dashboardActivitySchema>;

export const dashboardResponseSchema = z.object({
  /** Newest 8 saves. */
  recentBookmarks: z.array(bookmarkSchema),
  /** Everything tagged `reading` or `article`: full count + the newest 5. */
  readingQueue: z.object({ total: z.number().int(), items: z.array(bookmarkSchema) }),
  /** Newest 4 saved sessions. */
  recentSessions: z.array(sessionSummarySchema),
  /** The newest session's first 12 tabs, or null when there are no sessions. */
  lastSessionTabs: dashboardLastSessionSchema.nullable(),
  /** Up to 3 newest saves from a device OTHER than `?device=`; [] when the param
   * is absent (the server has no way to guess what "this device" is). */
  otherDeviceBookmarks: z.array(bookmarkSchema),
  activity: dashboardActivitySchema.nullable(),
  totalBookmarks: z.number().int(),
  totalSessions: z.number().int(),
});
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;

/** GET /api/dashboard query params. `device` is the caller's own device class
 * ("laptop", "mobile", …) and only feeds `otherDeviceBookmarks`. */
export const dashboardQuerySchema = z.object({
  device: z.string().min(1).max(40).optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
