import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { getUserSettings, type Db } from "@bookmark-ai/db";
import type { GeminiClient } from "@bookmark-ai/engine";

/** The chat model to run, plus a short human label for logging/telemetry. */
export interface ResolvedChatModel {
  model: LanguageModel;
  label: string;
}

interface ResolveArgs {
  db: Db;
  /** Clerk user id, or null in open/self-host mode. */
  userId: string | null;
  /** The shared env Gemini client — non-null iff GEMINI_API_KEY is configured. */
  gemini: GeminiClient | null;
}

/**
 * `userId` → settings-row key. Mirrors `settingsKey` in app/api/settings/route.ts:
 * open/self-host mode has no Clerk user, so it collapses to the `"local"`
 * sentinel and a single-user install still gets one persistent settings row.
 */
function settingsKey(userId: string | null): string {
  return userId ?? "local";
}

const hasText = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "";

/**
 * Resolve which language model the chat agent should run for this request.
 *
 * Precedence:
 *  1. The user's configured provider (Settings) — when provider, API key and
 *     model are all present (plus a base URL for the `custom` provider). Each
 *     provider is built from its AI SDK factory.
 *  2. Otherwise the env Gemini model the route has always used
 *     (`gemini-2.5-flash` via GEMINI_API_KEY).
 *  3. Otherwise `null` — no key anywhere; the caller surfaces the existing
 *     "AI unavailable" response.
 *
 * The caller must `await ready` before invoking this (it reads the settings row).
 */
export async function resolveChatModel({
  db,
  userId,
  gemini,
}: ResolveArgs): Promise<ResolvedChatModel | null> {
  const settings = await getUserSettings(db, settingsKey(userId)).catch(() => null);

  if (settings && hasText(settings.aiProvider) && hasText(settings.aiApiKey) && hasText(settings.aiModel)) {
    const apiKey = settings.aiApiKey;
    const model = settings.aiModel;
    switch (settings.aiProvider) {
      case "google":
        return { model: createGoogleGenerativeAI({ apiKey })(model), label: `google:${model}` };
      case "openai":
        return { model: createOpenAI({ apiKey })(model), label: `openai:${model}` };
      case "anthropic":
        return { model: createAnthropic({ apiKey })(model), label: `anthropic:${model}` };
      case "custom":
        // A custom OpenAI-compatible endpoint also needs a base URL; without one
        // the config is incomplete, so fall through to the env fallback.
        if (hasText(settings.aiBaseUrl)) {
          return {
            model: createOpenAICompatible({
              name: "custom",
              baseURL: settings.aiBaseUrl,
              apiKey,
            })(model),
            label: `custom:${model}`,
          };
        }
        break;
    }
  }

  // Fallback: the env Gemini model. `gemini` being non-null mirrors
  // GEMINI_API_KEY being set; we still read the raw key to build the AI SDK model.
  const envKey = process.env.GEMINI_API_KEY;
  if (gemini && hasText(envKey)) {
    return {
      model: createGoogleGenerativeAI({ apiKey: envKey })("gemini-2.5-flash"),
      label: "google:gemini-2.5-flash (env)",
    };
  }

  return null;
}
