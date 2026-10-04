import type { AiProvider, UpdateUserSettingsInput } from "@bookmark-ai/types";
import { providerNeedsModel } from "./ai-mode";
/** Construct an explicit activation request only for a complete provider draft. */
export function ownProviderRequest(draft: {
  provider: AiProvider;
  loadedProvider: AiProvider;
  apiKey: string;
  apiKeySet: boolean;
  keyVerified?: boolean;
  keyRejected?: boolean;
  baseUrl: string;
  model: string;
}): UpdateUserSettingsInput | null {
  const key = draft.apiKey.trim();
  const sameProvider = draft.provider === draft.loadedProvider;
  if (draft.keyRejected) return null;
  // Custom OpenAI-compatible endpoints may omit /models; a manual model is supported.
  if (key && draft.provider !== "custom" && !draft.keyVerified) return null;
  if (!key && !(draft.apiKeySet && sameProvider)) return null;
  if (draft.provider === "custom" && !draft.baseUrl.trim()) return null;
  if (providerNeedsModel(draft.provider) && !draft.model.trim()) return null;
  return {
    aiMode: "own",
    provider: draft.provider,
    apiKey: key || undefined,
    baseUrl: draft.provider === "custom" ? draft.baseUrl.trim() : undefined,
    model: draft.model.trim() || (!sameProvider ? "" : undefined),
  };
}
