import { z } from "zod";
import { mcpToolNameSchema } from "./mcp";

/**
 * AI providers the Settings UI can configure. `custom` is any OpenAI-compatible
 * endpoint and therefore also needs a base URL.
 */
export const aiProviderSchema = z.enum(["google", "openai", "anthropic", "custom"]);
export type AiProvider = z.infer<typeof aiProviderSchema>;

/**
 * Which key Ask AI runs on — an EXPLICIT, persisted choice (tenant migration v14,
 * `user_settings.ai_mode`), no longer derived from whether a key happens to be
 * stored. `included` = the shared server Gemini key, metered against the weekly
 * free credits (and, when those run out and a key IS stored, chat silently falls
 * back to the user's key — `X-Ai-Source: own-fallback`). `own` = the user's own
 * provider key, never metered. Switching modes NEVER touches the stored key;
 * only an explicit `apiKey: ""` removes it. A NULL column reads back as the
 * legacy derivation: key stored → `own`, else `included`.
 */
export const aiModeSchema = z.enum(["included", "own"]);
export type AiMode = z.infer<typeof aiModeSchema>;

/**
 * The caller's free-tier AI meter, as the UI needs it. Raw TOKENS on the wire
 * (that's what the server meters and what the 402 wall reports); the client
 * normalizes them to "credits" for display — see apps/web/lib/ai-credits.ts.
 *
 * Metering is WEEKLY: usage lives under a Monday-00:00-UTC week key, so
 * `resetsAt` is always the next Monday 00:00 UTC as an ISO timestamp. Any copy
 * built from this MUST say weekly / "resets Monday" — never "monthly".
 */
export const aiUsageSchema = z.object({
  /** Tokens consumed on the SERVER's shared key this week (own-key requests are
   * never metered, so this stays flat once a user brings their own key). */
  usedTokens: z.number(),
  /** The current global free-tier weekly budget (admin-adjustable). */
  limitTokens: z.number(),
  /** ISO timestamp of the next Monday 00:00 UTC, when the counter resets. */
  resetsAt: z.string(),
});
export type AiUsage = z.infer<typeof aiUsageSchema>;

/**
 * GET/PUT /api/settings response — the client-facing view of a user's settings.
 * The API NEVER returns the stored API key: only whether one is set and its
 * last 4 chars, enough to render a "Saved (••••1234)" hint.
 */
export const userSettingsSchema = z.object({
  provider: aiProviderSchema,
  baseUrl: z.string().nullable(),
  model: z.string().nullable(),
  apiKeySet: z.boolean(),
  apiKeyLast4: z.string().nullable(),
  /** ALWAYS present: the stored mode, or the legacy derivation (key stored →
   * `own`, else `included`) when the column is NULL. Independent of `apiKeySet`
   * — `included` with a saved key is the "fall back to my key when the free
   * credits run out" state. */
  aiMode: aiModeSchema,
  /** True when the own-key config is COMPLETE enough to run: provider + stored
   * key, plus a model for openai/anthropic/custom (and a base URL for custom).
   * Google needs no model — a NULL model runs `gemini-3.8-flash`. `apiKeySet`
   * with `ownKeyReady: false` = "you saved a key but still need to pick a
   * model"; chat then answers on the included AI with `X-Ai-Note: own-key-incomplete`. */
  ownKeyReady: z.boolean(),
  /** Per-user override for the dedicated live server's base URL. Null = use the
   * app's `NEXT_PUBLIC_LIVE_API_URL` default (or, if that's empty too, live off). */
  liveServerUrl: z.string().nullable(),
  /** ISO timestamp of when the account finished/dismissed the first-run tour, or
   * null if it hasn't yet — the per-account gate for showing the onboarding tour. */
  onboardedAt: z.string().nullable(),
  /** Extension → Bookmark AI mirroring of native browser bookmarks (Chrome
   * reading list included). Add-sync on by default; full sync (deletes
   * propagate) off by default — removing a native bookmark keeps the saved copy
   * unless the user opts into full sync. */
  nativeSyncEnabled: z.boolean(),
  nativeSyncFull: z.boolean(),
  /** MCP tools this account exposes to `POST /api/mcp`. null = the user has
   * never configured it, which means ALL tools are enabled (default-on); an
   * explicit (possibly empty) array is an allowlist. */
  mcpTools: z.array(mcpToolNameSchema).nullable(),
  /** The free-tier weekly AI meter for this account, or null when it can't be
   * read (a meter blip must never fail the settings call). Still returned when
   * the user has their OWN key configured — the UI just de-emphasizes it, since
   * own-key requests don't consume it. */
  aiUsage: aiUsageSchema.nullable(),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

export const userSettingsResponseSchema = z.object({ settings: userSettingsSchema });
export type UserSettingsResponse = z.infer<typeof userSettingsResponseSchema>;

/**
 * PUT /api/settings body. `apiKey` semantics: absent/undefined = KEEP the
 * existing key, "" (empty string) = CLEAR it (and set `aiMode` to `included`),
 * any other string = set it (and, unless `aiMode` is sent too, set `aiMode` to
 * `own`). `baseUrl` must be a http(s) URL and is required only when provider =
 * custom. `model`: absent = keep, "" = clear, else set — changing `provider`
 * alone never clears the model.
 *
 * `aiMode`: absent = keep; `included`/`own` = set the mode WITHOUT touching the
 * stored key, provider or model. `own` is refused (400) when no key is stored
 * and none arrives in the same request.
 *
 * `provider` is optional so a caller can PATCH a single unrelated field (e.g.
 * `{ onboarded: true }`) WITHOUT resubmitting — and thereby overwriting — the AI
 * config. The Settings form always sends it; the mark-onboarded path never does.
 */
export const updateUserSettingsSchema = z
  .object({
    provider: aiProviderSchema.optional(),
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional(),
    model: z.string().optional(),
    aiMode: aiModeSchema.optional(),
    // Live server base URL. Same keep/clear semantics as apiKey: absent = keep,
    // "" or null = clear (fall back to the env default). A set value must be a
    // http(s) URL, capped at 200 chars.
    liveServerUrl: z
      .union([z.literal(""), z.string().max(200).url().regex(/^https?:\/\//i)])
      .nullable()
      .optional(),
    // Mark the first-run tour as seen. Client sends `onboarded: true` on
    // dismiss/Get started; the server stamps `onboarded_at` to now. Absent =
    // leave the marker untouched (there's no need to ever un-set it).
    onboarded: z.boolean().optional(),
    // Native-sync toggles. Same absent = keep semantics as everything above —
    // the Sync section PATCHes exactly one of these at a time.
    nativeSyncEnabled: z.boolean().optional(),
    nativeSyncFull: z.boolean().optional(),
    // MCP tool allowlist. Same absent = keep semantics; null resets to the
    // default (all tools), an array (including []) sets the allowlist exactly.
    // Unknown tool names are rejected by the enum rather than persisted.
    mcpTools: z.array(mcpToolNameSchema).nullable().optional(),
  })
  .refine((v) => v.provider !== "custom" || (!!v.baseUrl && /^https?:\/\//i.test(v.baseUrl)), {
    message: "A http(s) Base URL is required for a custom provider",
    path: ["baseUrl"],
  });
export type UpdateUserSettingsInput = z.infer<typeof updateUserSettingsSchema>;

/**
 * POST /api/settings/ai/models body — validate a key by listing a provider's
 * models. `apiKey` may be omitted to reuse the stored one; `baseUrl` is required
 * for a custom provider.
 */
export const listModelsInputSchema = z
  .object({
    provider: aiProviderSchema,
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional(),
  })
  .refine((v) => v.provider !== "custom" || (!!v.baseUrl && /^https?:\/\//i.test(v.baseUrl)), {
    message: "A http(s) Base URL is required for a custom provider",
    path: ["baseUrl"],
  });
export type ListModelsInput = z.infer<typeof listModelsInputSchema>;

/** One selectable model, normalized across providers. */
export const aiModelSchema = z.object({ id: z.string(), label: z.string() });
export type AiModel = z.infer<typeof aiModelSchema>;

export const listModelsResponseSchema = z.object({ models: z.array(aiModelSchema) });
export type ListModelsResponse = z.infer<typeof listModelsResponseSchema>;
