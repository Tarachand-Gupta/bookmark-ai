import { z } from "zod";

/**
 * AI providers the Settings UI can configure. `custom` is any OpenAI-compatible
 * endpoint and therefore also needs a base URL.
 */
export const aiProviderSchema = z.enum(["google", "openai", "anthropic", "custom"]);
export type AiProvider = z.infer<typeof aiProviderSchema>;

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
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

export const userSettingsResponseSchema = z.object({ settings: userSettingsSchema });
export type UserSettingsResponse = z.infer<typeof userSettingsResponseSchema>;

/**
 * PUT /api/settings body. `apiKey` semantics: absent/undefined = KEEP the
 * existing key, "" (empty string) = CLEAR it, any other string = set it.
 * `baseUrl` must be a http(s) URL and is required only when provider = custom.
 */
export const updateUserSettingsSchema = z
  .object({
    provider: aiProviderSchema,
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional(),
    model: z.string().optional(),
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
