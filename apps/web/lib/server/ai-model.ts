import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { getUserSettings, type Db } from "@bookmark-ai/db";
import { assertSafeUrl, type GeminiClient } from "@bookmark-ai/engine";
import { decryptApiKey } from "@/lib/server/ai-key-crypto";

/** The chat model to run, plus a short human label for logging/telemetry. */
export interface ResolvedChatModel {
  model: LanguageModel;
  label: string;
  /**
   * True when this request runs on the SERVER's fallback AI key (env Gemini)
   * rather than a key the user configured — i.e. it counts against the free-tier
   * token meter. False for a user's own configured provider (never metered).
   */
  usesServerKey: boolean;
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

  // The stored key is encrypted at rest (AES-256-GCM, `enc:v1:` envelope) or
  // legacy plaintext; decrypt before use. A missing/wrong secret → null →
  // treated as "no key configured" and we fall through to the env fallback.
  const decryptedKey = decryptApiKey(settings?.aiApiKey ?? null);

  if (settings && hasText(settings.aiProvider) && hasText(decryptedKey) && hasText(settings.aiModel)) {
    const apiKey = decryptedKey;
    const model = settings.aiModel;
    switch (settings.aiProvider) {
      case "google":
        return { model: createGoogleGenerativeAI({ apiKey })(model), label: `google:${model}`, usesServerKey: false };
      case "openai":
        return { model: createOpenAI({ apiKey })(model), label: `openai:${model}`, usesServerKey: false };
      case "anthropic":
        return { model: createAnthropic({ apiKey })(model), label: `anthropic:${model}`, usesServerKey: false };
      case "custom":
        // A custom OpenAI-compatible endpoint also needs a base URL; without one
        // the config is incomplete, so fall through to the env fallback.
        if (hasText(settings.aiBaseUrl)) {
          // SECURITY (SSRF defense-in-depth): the base URL is validated at write
          // time (app/api/settings/route.ts) against the same net-guard policy,
          // but re-check it here right before building the outbound provider so a
          // row written by an older build or another path can't point the chat
          // agent at a loopback/private/link-local/metadata host. `assertSafeUrl`
          // rejects non-web schemes/ports and DNS-resolves the host, throwing if
          // any address is private/reserved. A throw → treat this as unconfigured
          // and fall through to the env fallback (the same null/503 surface the
          // caller already shows for "AI unavailable").
          //
          // NOTE: this is a pre-flight host check, not full TOCTOU parity — the AI
          // SDK's completion call POSTs a body, which the guard's `followRedirects`
          // (GET-only, no per-request body/method) can't proxy, so we don't wire a
          // guarded fetch/dispatcher into createOpenAICompatible. Write-time
          // validation + this pre-flight check is the SSRF surface we protect.
          try {
            await assertSafeUrl(settings.aiBaseUrl);
          } catch {
            break;
          }
          return {
            model: createOpenAICompatible({
              name: "custom",
              baseURL: settings.aiBaseUrl,
              apiKey,
            })(model),
            label: `custom:${model}`,
            usesServerKey: false,
          };
        }
        break;
    }
  }

  // Fallback: the env Gemini model. `gemini` being non-null mirrors
  // GEMINI_API_KEY being set; we still read the raw key to build the AI SDK model.
  // This path uses the SERVER's key → metered against the free-tier budget.
  const envKey = process.env.GEMINI_API_KEY;
  if (gemini && hasText(envKey)) {
    return {
      model: createGoogleGenerativeAI({ apiKey: envKey })("gemini-2.5-flash"),
      label: "google:gemini-2.5-flash (env)",
      usesServerKey: true,
    };
  }

  return null;
}
