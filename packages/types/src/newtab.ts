import { z } from "zod";

/**
 * New Tab Canvas ("your tab") — the api contract for the extension's new-tab
 * page: chat-designed HTML templates rendered in a sandboxed iframe against
 * the user's real data. The agent's HTML runs with NO origin and NO network;
 * the only way it gets data is `parent.postMessage` with one of the fixed
 * message types below (bridgeRequestSchema), which the parent page translates
 * into authed /api/* calls. See docs/features/newtab-canvas.md (§4.5 security
 * core) before widening the vocabulary — adding a type is a security review.
 */

/** Named preset thumbnails the parent renders as static SVGs (§5.5). */
export const presetThumbnailNames = [
  "favorites",
  "recent",
  "continue",
  "working-on",
  "most-used",
  "time-spent",
] as const;
export type PresetThumbnailName = (typeof presetThumbnailNames)[number];

/** Stable ids of the six seeded presets (INSERT OR IGNORE keys — §4.6). */
export const NEWTAB_PRESET_IDS = presetThumbnailNames.map((n) => `preset:${n}`);

export const newTabTemplateConfigSchema = z.object({
  launcherPosition: z.enum(["bottom-left", "bottom-right"]).default("bottom-right"),
  // A named preset OR an inline SVG/PNG data URL (data URLs are sanitized by
  // the parent before rendering — §5.5).
  thumbnail: z
    .union([z.enum(presetThumbnailNames), z.string().max(17_000)])
    .default("favorites"),
  // Agent-chosen CSS custom props passed along for the template's own use.
  themeTokens: z.record(z.string(), z.string()).optional(),
});
export type NewTabTemplateConfig = z.infer<typeof newTabTemplateConfigSchema>;

/** A stored template row. `id` is NOT uuid-constrained: presets use stable
 *  `preset:<name>` ids (seeding is INSERT OR IGNORE keyed on them), customs
 *  use randomUUID(). */
export const newTabTemplateSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  // The agent's HTML — capped to bound the row, the agent turn, and the iframe
  // parse cost (§5.4). Enforced here (REST) and on the tool input (agent).
  html: z.string().min(1).max(200_000),
  config: newTabTemplateConfigSchema,
  isPreset: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type NewTabTemplate = z.infer<typeof newTabTemplateSchema>;

export const createNewTabTemplateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  html: z.string().min(1).max(200_000),
  config: newTabTemplateConfigSchema.default({}),
  activate: z.boolean().default(true),
});
export type CreateNewTabTemplateInput = z.infer<typeof createNewTabTemplateSchema>;

export const updateNewTabTemplateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  html: z.string().min(1).max(200_000).optional(),
  config: newTabTemplateConfigSchema.partial().optional(),
});
export type UpdateNewTabTemplateInput = z.infer<typeof updateNewTabTemplateSchema>;

/** The `newtab_settings` row. `activeTemplateId` is a denormalized mirror of
 * the table's is_active flag (the table is the source of truth); it is also
 * the "seen the wizard" marker — the wizard renders while there is no row. */
export const newTabSettingsSchema = z.object({
  activeTemplateId: z.string().nullable(),
  launcherPosition: z.enum(["bottom-left", "bottom-right"]),
  sidebarCollapsed: z.boolean(),
  updatedAt: z.string(),
});
export type NewTabSettings = z.infer<typeof newTabSettingsSchema>;

export const updateNewTabSettingsSchema = z.object({
  launcherPosition: z.enum(["bottom-left", "bottom-right"]).optional(),
  sidebarCollapsed: z.boolean().optional(),
});
export type UpdateNewTabSettingsInput = z.infer<typeof updateNewTabSettingsSchema>;

/* ── The bridge vocabulary (§4.5) ──────────────────────────────────────────
 * The ENTIRE attack surface of agent-generated HTML. Reads only, except
 * `openUrl` (the parent validates http(s): and opens the tab in ITS chrome).
 * No write message types — a template can never save/delete anything (§5.2). */
const bridgeBase = { id: z.string().min(1).max(64) };

export const bridgeRequestSchema = z.discriminatedUnion("type", [
  z.object({
    ...bridgeBase,
    type: z.literal("search"),
    q: z.string().min(1).max(200),
    mode: z.enum(["text", "ai", "hybrid"]).default("hybrid"),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  z.object({
    ...bridgeBase,
    type: z.literal("listBookmarks"),
    category: z.string().max(80).optional(),
    tag: z.string().max(80).optional(),
    day: z.string().max(10).optional(),
    limit: z.number().int().min(1).max(200).default(100),
    offset: z.number().int().min(0).default(0),
  }),
  z.object({ ...bridgeBase, type: z.literal("getMeta") }),
  z.object({
    ...bridgeBase,
    type: z.literal("listSessions"),
    query: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  z.object({ ...bridgeBase, type: z.literal("listLiveTabs") }),
  // The "wizard features" (§4.5.1) — read-only derivations served from the
  // parent's cached /api/newtab/wizard response.
  z.object({ ...bridgeBase, type: z.literal("getFavorites") }),
  z.object({ ...bridgeBase, type: z.literal("getMostUsed") }),
  z.object({ ...bridgeBase, type: z.literal("getTimeSpent") }),
  z.object({ ...bridgeBase, type: z.literal("continueWhereYouLeft") }),
  z.object({ ...bridgeBase, type: z.literal("getWizard") }),
  // The one action: open a URL. No response data; the parent opens the tab
  // after validating the scheme is http(s).
  z.object({ ...bridgeBase, type: z.literal("openUrl"), url: z.string().url().max(2000) }),
  // Boot handshake: the iframe posts this on load; the parent's reply proves
  // the bridge is alive before the template starts querying.
  z.object({ ...bridgeBase, type: z.literal("ready") }),
]);
export type BridgeRequest = z.infer<typeof bridgeRequestSchema>;
export type BridgeRequestType = BridgeRequest["type"];

/** A compact bookmark as handed to templates (no og JSON, no ids needed for
 * writes — templates can't write). */
export const wizardBookmarkSchema = z.object({
  url: z.string(),
  title: z.string(),
  domain: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  savedAt: z.string(),
});
export type WizardBookmark = z.infer<typeof wizardBookmarkSchema>;

/** GET /api/newtab/wizard — every "wizard feature" in ONE round trip (the new
 *  tab is a cold open; §4.5.1). The parent caches it and serves the per-feature
 *  bridge messages (getFavorites, …) from it. */
export interface NewTabWizardData {
  favorites: WizardBookmark[];
  recent: WizardBookmark[];
  continueWhereYouLeft:
    | { enabled: false }
    | { enabled: true; device: { label: string; browser: string; tabs: { title: string; url: string }[] } | null };
  workingOn:
    | { enabled: false }
    | { enabled: true; devices: { label: string; browser: string; tabs: { title: string; url: string }[] }[] };
  mostUsed: { domain: string; count: number }[];
  // We do not track time-on-page; honest empty state (§4.5.1).
  timeSpent: { available: false };
}

export interface ListNewTabTemplatesResponse {
  templates: NewTabTemplate[];
}

/* ── Chat agent tools (§4.3.2) ───────────────────────────────────────────── */

/** writeNewTabTemplate tool input (the one agent tool that writes). Same
 *  bounds as the REST route — both paths funnel through saveNewTabTemplate. */
export const writeNewTabTemplateInputSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  html: z.string().min(1).max(200_000),
  config: newTabTemplateConfigSchema.partial().optional(),
  templateId: z.string().min(1).max(64).optional(),
  activate: z.boolean().default(true),
});

/** The active-template context the newtab page threads into every chat
 *  request (the agent's "open file" — §4.7/§4.8). `type: "readActiveTemplate"`
 *  returns the active row plus this verbatim. */
export interface NewTabActiveContext {
  templateId: string;
  name: string;
  html: string;
  /** Serialized snapshot of the data the iframe last rendered (the parent's
   *  bridge-response cache, keyed by message type). Untrusted content — data,
   *  not instructions (§5.3). */
  renderedData?: Record<string, unknown>;
}
