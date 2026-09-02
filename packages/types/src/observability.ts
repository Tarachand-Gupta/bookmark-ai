import { z } from "zod";

/**
 * Admin observability (Langfuse tracing) config — one boolean per traced AI
 * surface. Stored as JSON in the master control-plane DB (`platform_config`
 * key "observability_config") and adjusted via PATCH /api/admin/observability,
 * mirroring the free-tier AI limit's storage/admin pattern.
 */
export const observabilitySurfacesSchema = z.object({
  /** The /api/chat agent (AI SDK streamText + its tool calls). */
  askAi: z.boolean(),
  /** Saved-session title/description generation. */
  sessionSummary: z.boolean(),
  /** Bookmark categorization. */
  categorize: z.boolean(),
  /** Bookmark/session embedding (post-save hooks, import sweep, cron). */
  embed: z.boolean(),
  /** Library search (hybrid/ai query embedding + retrieval). */
  search: z.boolean(),
});
export type ObservabilitySurfaces = z.infer<typeof observabilitySurfacesSchema>;

/** PATCH /api/admin/observability body: any subset of the surface flags. */
export const updateObservabilitySchema = observabilitySurfacesSchema
  .partial()
  .refine((o) => Object.keys(o).length > 0, "At least one surface flag is required");
export type UpdateObservabilityInput = z.infer<typeof updateObservabilitySchema>;

/** GET/PATCH /api/admin/observability response. */
export const observabilityResponseSchema = z.object({
  /** True when the server has Langfuse keys configured (tracing can happen). */
  configured: z.boolean(),
  /** Host of the Langfuse instance traces go to (no credentials), or null. */
  baseUrl: z.string().nullable(),
  surfaces: observabilitySurfacesSchema,
});
export type ObservabilityResponse = z.infer<typeof observabilityResponseSchema>;
