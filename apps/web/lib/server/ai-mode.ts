import { aiModeSchema, type AiMode } from "@bookmark-ai/types";

/**
 * The ONE place the stored `user_settings.ai_mode` column becomes an `AiMode`.
 * NULL (rows written before tenant migration v14, or never switched) keeps the
 * legacy derivation the product had before the explicit mode existed: a stored
 * key meant "your own key", no key meant "included free AI". A corrupt value
 * degrades the same way rather than throwing. Shared by the settings GET (what
 * the UI shows) and the chat model resolver (what actually runs) so the two can
 * never disagree.
 */
export function deriveAiMode(stored: string | null | undefined, hasStoredKey: boolean): AiMode {
  const parsed = aiModeSchema.safeParse(stored);
  if (parsed.success) return parsed.data;
  return hasStoredKey ? "own" : "included";
}
