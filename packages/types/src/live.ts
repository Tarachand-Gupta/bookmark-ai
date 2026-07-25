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
  /**
   * User-set display name for this window, overlaid onto list/stream responses
   * from a server-side per-device store (keyed by windowId). Absent/null = fall
   * back to the default "Window N" label. Never pushed by devices — it's a
   * viewer-side override, so the capture path leaves it undefined.
   */
  name: z.string().nullish(),
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
  /**
   * This device's "new windows join live sessions by default" policy. ABSENT =
   * true (the fail-safe default — an unconfigured/new device auto-shares new
   * windows). Only present-and-false means the user opted the device out, so its
   * windows created after that are not shared unless individually turned on in the
   * extension popup. Set from the web app (PATCH /live/:deviceId/settings) and
   * mirrored into the extension from the push response.
   */
  newWindowsShared: z.boolean().optional(),
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

/**
 * PATCH /live/:deviceId/settings body — the per-device "new windows join live
 * sessions by default" policy. Off means windows opened on that device after the
 * change are NOT shared unless individually turned on in the extension popup.
 */
export const updateLiveDeviceSettingsSchema = z.object({
  newWindowsShared: z.boolean(),
});
export type UpdateLiveDeviceSettingsInput = z.infer<typeof updateLiveDeviceSettingsSchema>;

/**
 * POST /live 200 response. `enabled` echoes the account flag; `newWindowsShared`
 * is this device's new-window policy (absent = the default "true"), returned on
 * every push so the extension mirrors the policy with no extra request.
 */
export const pushLiveResponseSchema = z.object({
  ok: z.literal(true),
  enabled: z.literal(true),
  newWindowsShared: z.boolean().optional(),
});
export type PushLiveResponse = z.infer<typeof pushLiveResponseSchema>;

/**
 * PATCH /live/:deviceId/windows/:windowId body — rename one live window. An empty
 * string (after trim) CLEARS the override, restoring the default "Window N" label.
 */
export const renameLiveWindowSchema = z.object({
  name: z.string().trim().max(80),
});
export type RenameLiveWindowInput = z.infer<typeof renameLiveWindowSchema>;
