import { z } from "zod";

/**
 * An http(s)-only URL string. Rejects `javascript:`, `data:`, `file:`, and any
 * other scheme — validation-layer XSS defense-in-depth for URLs that later get
 * rendered as clickable links (a render-layer guard is applied separately). All
 * real bookmarks and saved tabs are http/https, so this rejects no valid data.
 */
export const httpUrlSchema = z
  .string()
  .url()
  .refine((v) => /^https?:\/\//i.test(v), { message: "URL must be http(s)" });

/** Browsers we detect. `other` covers anything unrecognized. */
export const browserSchema = z.enum(["chrome", "firefox", "safari", "edge", "arc", "other"]);
export type Browser = z.infer<typeof browserSchema>;

/** Device classes we detect from the saving client. */
export const deviceTypeSchema = z.enum(["desktop", "laptop", "mobile", "tablet", "other"]);
export type DeviceType = z.infer<typeof deviceTypeSchema>;

/** Open Graph metadata scraped from the bookmarked page. */
export const openGraphSchema = z.object({
  title: z.string().nullish(),
  description: z.string().nullish(),
  image: z.string().url().nullish(),
  siteName: z.string().nullish(),
  type: z.string().nullish(),
  url: z.string().url().nullish(),
  favicon: z.string().nullish(),
});
export type OpenGraph = z.infer<typeof openGraphSchema>;

/** Where/when a bookmark was captured. */
export const sourceSchema = z.object({
  browser: browserSchema,
  device: deviceTypeSchema,
  deviceName: z.string().nullish(),
  os: z.string().nullish(),
  /** ISO 8601 — when the user saved it (client clock). */
  savedAt: z.string().datetime({ offset: true }),
});
export type Source = z.infer<typeof sourceSchema>;

/** A fully persisted bookmark as returned by the API. */
export const bookmarkSchema = z.object({
  id: z.string(),
  url: httpUrlSchema,
  domain: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  og: openGraphSchema,
  source: sourceSchema,
  category: z.string(),
  tags: z.array(z.string()),
  /** ISO 8601 — server-side persistence time. */
  createdAt: z.string(),
  /** True once an embedding vector has been stored for this bookmark. */
  embedded: z.boolean(),
});
export type Bookmark = z.infer<typeof bookmarkSchema>;
