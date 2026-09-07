import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import type { SharedV4ProviderOptions } from "@ai-sdk/provider";
import { getUserSettings, type Db, type UserSettingsRow } from "@bookmark-ai/db";
import { assertSafeUrl, type GeminiClient } from "@bookmark-ai/engine";
import type { AiMode, AiProvider, ChatAiNote, ChatAiSource } from "@bookmark-ai/types";
import { decryptApiKey } from "@/lib/server/ai-key-crypto";
import { deriveAiMode } from "@/lib/server/ai-mode";
import { withModelFallback } from "@/lib/server/ai-fallback-model";

/**
 * The INCLUDED (free tier) stack, in order:
 *  1. PRIMARY — GLM 5.3 Flash through OpenRouter (`OPENROUTER_API_KEY`), asked
 *     for LOW reasoning effort. Fast and cheap for the agent's tool loops.
 *  2. FALLBACK — Gemini 3.8 Flash on the server's `GEMINI_API_KEY` (medium
 *     thinking). Takes over automatically when OpenRouter has no key, errors,
 *     rate-limits or stalls (see ai-fallback-model.ts).
 * Neither id is ever shown in the UI; `X-Ai-Model-Tier` tells clients which one
 * answered.
 */
export const INCLUDED_PRIMARY_MODEL_ID = "z-ai/glm-5.3-flash";
export const INCLUDED_FALLBACK_MODEL_ID = "gemini-3.8-flash";

/**
 * The model a Google own-key user runs when they saved no model of their own.
 * Kept equal to the included FALLBACK id (both are Gemini on a Google key) so
 * the "Provider default" badge and the resolver can't disagree.
 */
export const INCLUDED_MODEL_ID = INCLUDED_FALLBACK_MODEL_ID;

/**
 * Reasoning settings for the included stack. GLM runs at LOW effort (the agent
 * loops a lot; low keeps it snappy) and Gemini at MEDIUM thinking. BOTH ask for
 * the reasoning tokens to be streamed, so the chat's "Thought for N s"
 * disclosure appears whichever half answers.
 *
 * NOTE the asymmetry: Gemini takes its thinking config as per-REQUEST
 * `providerOptions`, while @openrouter/ai-sdk-provider reads `reasoning` off the
 * MODEL SETTINGS at construction (`this.settings.reasoning` → the request body's
 * `reasoning` field) and ignores a `providerOptions.openrouter.reasoning`. So
 * GLM's setting lives in OPENROUTER_MODEL_SETTINGS below, not here.
 */
export const INCLUDED_PROVIDER_OPTIONS: SharedV4ProviderOptions = {
  google: { thinkingConfig: { includeThoughts: true, thinkingLevel: "medium" } },
};

/** GLM's reasoning setting — see the note above; applied at model construction. */
export const OPENROUTER_MODEL_SETTINGS = {
  reasoning: { enabled: true, effort: "low" as const },
};

/** A user's OWN Google key: same thinking config as the included fallback. */
export const GOOGLE_PROVIDER_OPTIONS: SharedV4ProviderOptions = {
  google: INCLUDED_PROVIDER_OPTIONS.google,
};

/** The chat model to run, plus a short human label for logging/telemetry. */
export interface ResolvedChatModel {
  model: LanguageModel;
  label: string;
  /**
   * True when this request runs on the SERVER's AI key (env Gemini) rather than
   * a key the user configured — i.e. it counts against the free-tier token
   * meter. False for a user's own provider (never metered), INCLUDING the
   * `own-fallback` case.
   */
  usesServerKey: boolean;
  /** Which key answered — echoed to clients as the `X-Ai-Source` header. */
  source: ChatAiSource;
  /** Provider family, so the route can attach provider-specific options (e.g.
   * Gemini `thinkingConfig`) without re-deriving it from the label. */
  providerId: AiProvider;
  modelId: string;
  /**
   * For the included tier: which half of the stack this request STARTED on.
   * `undefined` for a user's own key. The wrapper flips a request from
   * "primary" to "fallback" at runtime via `onIncludedFallback`, so the header
   * is written after the model is chosen, not before.
   */
  tier?: ChatModelTier;
  /**
   * The `providerOptions` this model needs, keyed by provider. Providers ignore
   * keys that aren't theirs, so the included tier ships BOTH blocks — the
   * OpenRouter one and the Google one — and a mid-request handoff to Gemini
   * still gets its thinking config without re-deriving anything.
   */
  providerOptions?: SharedV4ProviderOptions;
}

/** Which half of the included stack answered — echoed as `X-Ai-Model-Tier`. */
export type ChatModelTier = "primary" | "fallback";

interface ResolveArgs {
  db: Db;
  /** Notified when the included tier's primary (OpenRouter) hands off to Gemini. */
  onIncludedFallback?: (reason: string) => void;
  /** Notified once with the included tier that actually answered. */
  onIncludedTier?: (tier: ChatModelTier) => void;
  /** Clerk user id, or null in open/self-host mode. */
  userId: string | null;
  /** The shared env Gemini client — non-null iff GEMINI_API_KEY is configured. */
  gemini: GeminiClient | null;
}

/**
 * Everything one settings read can tell us: the user's mode, whether a key is
 * stored, and the two models that COULD run — their own provider (complete
 * config only) and the included server Gemini. `pickChatModel` turns this into
 * a decision once the weekly meter is known; splitting the two lets the route
 * read settings and the meter concurrently.
 */
export interface ChatModelCandidates {
  aiMode: AiMode;
  hasStoredKey: boolean;
  /** The user's own provider, or null when provider/key/model are incomplete
   * (or a custom base URL fails the SSRF guard). */
  own: ResolvedChatModel | null;
  /** The server's Gemini, or null without GEMINI_API_KEY. */
  included: ResolvedChatModel | null;
}

export type ChatModelPick =
  /** `note` is set when the user asked for their own key but its config is
   * incomplete, so the INCLUDED model answered instead — surfaced to clients as
   * the `X-Ai-Note` header so they can say "pick a model in Settings → AI"
   * rather than silently metering someone who believes they're on their key. */
  | { ok: true; resolved: ResolvedChatModel; note?: ChatAiNote }
  /** 402: on included AI, credits exhausted, and no own key to fall back to. */
  | { ok: false; status: 402 }
  /** 503: no key anywhere. */
  | { ok: false; status: 503 };

/**
 * `userId` → settings-row key. Mirrors `settingsKey` in app/api/settings/route.ts:
 * open/self-host mode has no Clerk user, so it collapses to the `"local"`
 * sentinel and a single-user install still gets one persistent settings row.
 */
function settingsKey(userId: string | null): string {
  return userId ?? "local";
}

const hasText = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "";

/** The settings columns the completeness rule reads. */
export type OwnKeyConfig = Pick<UserSettingsRow, "aiProvider" | "aiModel" | "aiBaseUrl">;

/**
 * Is the user's own-key config COMPLETE enough to run? Provider + a stored key,
 * plus a model for openai/anthropic/custom (and a base URL for custom). Google
 * is the one provider with a known-good default — `gemini-3.8-flash`, the same
 * model the included tier runs — so a NULL model there still counts as ready:
 * both the web card and the macOS "Provider default" option legitimately leave
 * `ai_model` empty. Pure; shared with GET /api/settings (`ownKeyReady`) so the
 * badge the user sees and the resolver that runs can't disagree.
 */
export function isOwnKeyReady(settings: OwnKeyConfig | null, hasKey: boolean): boolean {
  if (!settings || !hasKey || !hasText(settings.aiProvider)) return false;
  switch (settings.aiProvider) {
    case "google":
      return true;
    case "openai":
    case "anthropic":
      return hasText(settings.aiModel);
    case "custom":
      return hasText(settings.aiModel) && hasText(settings.aiBaseUrl);
    default:
      return false;
  }
}

/** The model id an own-key request runs: the stored one, or Google's default. */
export function ownModelId(settings: OwnKeyConfig): string | null {
  if (hasText(settings.aiModel)) return settings.aiModel;
  return settings.aiProvider === "google" ? INCLUDED_MODEL_ID : null;
}

/**
 * The user's own provider as an AI SDK model — only when the config is complete
 * per `isOwnKeyReady` (plus a safe base URL for `custom`); otherwise null.
 */
async function buildOwnModel(
  settings: UserSettingsRow | null,
  apiKey: string | null,
): Promise<ResolvedChatModel | null> {
  if (!settings || !hasText(apiKey) || !isOwnKeyReady(settings, true)) return null;
  const modelId = ownModelId(settings);
  if (!modelId) return null;
  const base = { usesServerKey: false as const, source: "own" as const, modelId };
  switch (settings.aiProvider) {
    case "google":
      return {
        ...base,
        providerId: "google",
        model: createGoogleGenerativeAI({ apiKey })(modelId),
        label: `google:${modelId}`,
        providerOptions: GOOGLE_PROVIDER_OPTIONS,
      };
    case "openai":
      return { ...base, providerId: "openai", model: createOpenAI({ apiKey })(modelId), label: `openai:${modelId}` };
    case "anthropic":
      return {
        ...base,
        providerId: "anthropic",
        model: createAnthropic({ apiKey })(modelId),
        label: `anthropic:${modelId}`,
      };
    case "custom": {
      // A custom OpenAI-compatible endpoint also needs a base URL (already
      // required by isOwnKeyReady; re-checked here to narrow the type).
      if (!hasText(settings.aiBaseUrl)) return null;
      // SECURITY (SSRF defense-in-depth): the base URL is validated at write
      // time (app/api/settings/route.ts) against the same net-guard policy, but
      // re-check it here right before building the outbound provider so a row
      // written by an older build or another path can't point the chat agent at
      // a loopback/private/link-local/metadata host. `assertSafeUrl` rejects
      // non-web schemes/ports and DNS-resolves the host, throwing if any address
      // is private/reserved. A throw → treat this as unconfigured.
      //
      // NOTE: this is a pre-flight host check, not full TOCTOU parity — the AI
      // SDK's completion call POSTs a body, which the guard's `followRedirects`
      // (GET-only, no per-request body/method) can't proxy, so we don't wire a
      // guarded fetch/dispatcher into createOpenAICompatible. Write-time
      // validation + this pre-flight check is the SSRF surface we protect.
      try {
        await assertSafeUrl(settings.aiBaseUrl);
      } catch {
        return null;
      }
      return {
        ...base,
        providerId: "custom",
        model: createOpenAICompatible({ name: "custom", baseURL: settings.aiBaseUrl, apiKey })(modelId),
        label: `custom:${modelId}`,
      };
    }
    default:
      return null;
  }
}

/** Google's Gemini on the SERVER key — the included tier's fallback half. */
function buildIncludedGemini(gemini: GeminiClient | null): LanguageModel | null {
  const envKey = process.env.GEMINI_API_KEY;
  // `gemini` being non-null mirrors the key being set; the raw key builds the
  // AI SDK model.
  if (!gemini || !hasText(envKey)) return null;
  return createGoogleGenerativeAI({ apiKey: envKey })(INCLUDED_FALLBACK_MODEL_ID);
}

/** GLM through OpenRouter — the included tier's primary half, or null with no key. */
function buildIncludedOpenRouter(): LanguageModel | null {
  const key = process.env.OPENROUTER_API_KEY;
  if (!hasText(key)) return null;
  // OPENROUTER_BASE_URL is an escape hatch for testing the Gemini fallback path
  // (point it at a dead port) and for an OpenRouter-compatible proxy.
  const baseURL = process.env.OPENROUTER_BASE_URL;
  return createOpenRouter({ apiKey: key, ...(hasText(baseURL) ? { baseURL } : {}) })(
    INCLUDED_PRIMARY_MODEL_ID,
    OPENROUTER_MODEL_SETTINGS,
  );
}

/**
 * The included model: GLM via OpenRouter wrapped so that any failure before the
 * first content chunk silently continues on Gemini. With only one of the two
 * keys present, that one runs alone; with neither, there is no included tier.
 * `onFallback` lets the route report the tier that actually answered.
 */
export function buildIncludedModel(
  gemini: GeminiClient | null,
  onFallback?: (reason: string) => void,
  onDecision?: (tier: ChatModelTier) => void,
): ResolvedChatModel | null {
  const primary = buildIncludedOpenRouter();
  const geminiModel = buildIncludedGemini(gemini);
  const base = {
    usesServerKey: true as const,
    source: "included" as const,
  };
  if (primary && geminiModel) {
    return {
      ...base,
      model: withModelFallback(primary, geminiModel, { onFallback, onDecision }),
      label: `openrouter:${INCLUDED_PRIMARY_MODEL_ID} (env, gemini fallback)`,
      providerOptions: INCLUDED_PROVIDER_OPTIONS,
      providerId: "custom",
      modelId: INCLUDED_PRIMARY_MODEL_ID,
      tier: "primary",
    };
  }
  if (primary) {
    return {
      ...base,
      model: primary,
      label: `openrouter:${INCLUDED_PRIMARY_MODEL_ID} (env)`,
      providerOptions: INCLUDED_PROVIDER_OPTIONS,
      providerId: "custom",
      modelId: INCLUDED_PRIMARY_MODEL_ID,
      tier: "primary",
    };
  }
  if (geminiModel) {
    return {
      ...base,
      model: geminiModel,
      label: `google:${INCLUDED_FALLBACK_MODEL_ID} (env)`,
      providerOptions: INCLUDED_PROVIDER_OPTIONS,
      providerId: "google",
      modelId: INCLUDED_FALLBACK_MODEL_ID,
      tier: "fallback",
    };
  }
  return null;
}

/**
 * One settings read → both candidate models + the user's mode. The caller must
 * `await ready` before invoking this (it reads the settings row). The stored key
 * is encrypted at rest (AES-256-GCM `enc:v1:` envelope) or legacy plaintext; a
 * missing/wrong secret decrypts to null → "no key configured".
 */
export async function resolveChatCandidates({ db, userId, gemini, onIncludedFallback, onIncludedTier }: ResolveArgs): Promise<ChatModelCandidates> {
  const settings = await getUserSettings(db, settingsKey(userId)).catch(() => null);
  const key = decryptApiKey(settings?.aiApiKey ?? null);
  const hasStoredKey = hasText(key);
  return {
    aiMode: deriveAiMode(settings?.aiMode, hasStoredKey),
    hasStoredKey,
    own: await buildOwnModel(settings, key),
    included: buildIncludedModel(gemini, onIncludedFallback, onIncludedTier),
  };
}

/**
 * Decide which model runs (pure — unit-tested):
 *  1. `aiMode === "own"` with a complete own config ⇒ the own key, never metered.
 *  2. `aiMode === "included"` ⇒ the included server Gemini, metered. When the
 *     weekly meter is `exhausted`: an own key, if stored and complete, takes
 *     over as `own-fallback` (not metered); otherwise 402 `free-limit-exceeded`.
 *     `aiMode === "own"` with an INCOMPLETE own config (e.g. OpenAI key, no
 *     model) lands here too, flagged `note: "own-key-incomplete"` so the client
 *     can tell the user to pick a model instead of being silently metered.
 *  3. No server key at all but an own config ⇒ the own key (self-host without
 *     GEMINI_API_KEY). Nothing anywhere ⇒ 503.
 */
export function pickChatModel(
  candidates: ChatModelCandidates,
  { exhausted }: { exhausted: boolean },
): ChatModelPick {
  const { aiMode, own, included } = candidates;
  if (aiMode === "own" && own) return { ok: true, resolved: own };
  const note: ChatAiNote | undefined = aiMode === "own" && !own ? "own-key-incomplete" : undefined;
  if (included) {
    if (!exhausted) return note ? { ok: true, resolved: included, note } : { ok: true, resolved: included };
    if (own) return { ok: true, resolved: { ...own, source: "own-fallback" } };
    return { ok: false, status: 402 };
  }
  if (own) return { ok: true, resolved: own };
  return { ok: false, status: 503 };
}

/**
 * Convenience: candidates + pick in one call, for callers that already know the
 * meter state (the chat route reads settings and the meter concurrently and
 * calls the two halves itself).
 */
export async function resolveChatModel(
  args: ResolveArgs & { exhausted?: boolean },
): Promise<ChatModelPick> {
  return pickChatModel(await resolveChatCandidates(args), { exhausted: args.exhausted === true });
}
