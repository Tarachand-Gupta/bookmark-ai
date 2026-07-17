import { z } from "zod";
import { browserSchema, deviceTypeSchema } from "./bookmark";

// ── Live Sessions ("open tabs") ─────────────────────────────────────────────
// An ephemeral, per-device checkpoint of the tabs a browser has open. Kept in a
// separate table from saved sessions (never exported, TTL-reaped), so a live
// window can never be mistaken for a saved one. See docs/features/live-sessions.md.

/** One open tab within a live window. */
export const liveTabSchema = z.object({
  // Permissive like sessionTabSchema — XSS is defended at the render layer. Unlike
  // sessions, these URLs are ALSO sanitized at capture time in the extension
  // (§5.3), because render-layer defense does nothing against exfiltration.
  url: z.string(),
  title: z.string().max(300).default(""),
  favIconUrl: z.string().nullish(),
  active: z.boolean().optional(),
  /** URL reduced to its origin because the path/query looked credential-bearing (§5.3). */
  redacted: z.boolean().optional(),
});
export type LiveTab = z.infer<typeof liveTabSchema>;

/** One open browser window. `windowId` is display grouping only — never a key (§4.2.2). */
export const liveWindowSchema = z.object({
  windowId: z.number().int(),
  focused: z.boolean().optional(),
  tabs: z.array(liveTabSchema).max(100),
});
export type LiveWindow = z.infer<typeof liveWindowSchema>;

/**
 * POST /api/live body — a checkpoint push from one device. `capturedAt` is
 * client-clock DISPLAY METADATA only: never freshness, never ordering (§4.4).
 * `windows` absent = heartbeat (leave the mirror alone); `windows: []` = every
 * window is closed (do write the empty array). The two are different (§4.3).
 */
export const pushLiveStateSchema = z.object({
  deviceId: z.string().uuid(),
  label: z.string().max(80).optional(),
  browser: browserSchema.default("other"),
  device: deviceTypeSchema.default("other"),
  os: z.string().max(40).nullish(),
  capturedAt: z.string().datetime(),
  hiddenTabCount: z.number().int().min(0).default(0),
  windows: z.array(liveWindowSchema).max(12).optional(),
});
export type PushLiveStateInput = z.infer<typeof pushLiveStateSchema>;

/** One device in the GET /api/live response. `lastSeenAgeSeconds` is server-computed (§4.4). */
export const liveDeviceSchema = z.object({
  deviceId: z.string(),
  label: z.string(),
  browser: browserSchema,
  device: deviceTypeSchema,
  os: z.string().nullable(),
  windows: z.array(liveWindowSchema),
  tabCount: z.number().int(),
  hiddenTabCount: z.number().int(),
  lastSeenAt: z.string().datetime(),
  lastSeenAgeSeconds: z.number().int(),
});
export type LiveDevice = z.infer<typeof liveDeviceSchema>;

/** GET /api/live response. `enabled` lets a reader tell "off" from "no devices" (§4.5). */
export const listLiveResponseSchema = z.object({
  devices: z.array(liveDeviceSchema),
  enabled: z.boolean(),
  ttlHours: z.number().int(),
});
export type ListLiveResponse = z.infer<typeof listLiveResponseSchema>;

/** POST /api/live/settings body — the account-wide opt-in flag. Off purges (§5.7). */
export const updateLiveSettingsSchema = z.object({
  enabled: z.boolean(),
});
export type UpdateLiveSettingsInput = z.infer<typeof updateLiveSettingsSchema>;
