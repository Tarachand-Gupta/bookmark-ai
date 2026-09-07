import {
  AI_NOTE_HEADER,
  AI_NOTE_OWN_KEY_INCOMPLETE,
  AI_SOURCE_FALLBACK_NOTE,
  aiModeSchema,
  type AiMode,
  type UserSettings,
} from "@bookmark-ai/types";

/**
 * The explicit AI mode (CONTRACT §1): does chat run on the included free
 * credits or on the user's own key? Persisted server-side as
 * `user_settings.ai_mode` and ALWAYS present in the settings GET — the server
 * derives it for a NULL column (a stored key means "own", otherwise
 * "included"). The same derivation is kept here as a fallback for any client
 * talking to a server build that predates the field.
 */
export type { AiMode };

export const AI_MODE_OPTIONS: { value: AiMode; label: string }[] = [
  { value: "included", label: "Included free AI" },
  { value: "own", label: "Your own key" },
];

export function isAiMode(value: unknown): value is AiMode {
  return aiModeSchema.safeParse(value).success;
}

export function resolveAiMode(settings: UserSettings): AiMode {
  const explicit: unknown = settings.aiMode;
  if (isAiMode(explicit)) return explicit;
  return settings.apiKeySet ? "own" : "included";
}

/** The first sentence of a multi-sentence note. */
function firstSentence(text: string): string {
  return text.split(/(?<=[.!?])\s+/)[0] ?? text;
}

/** Copy shown under the mode switch (contract wording, verbatim). */
export const AI_MODE_COPY = {
  includedWithKey:
    "Your key stays saved. When the free credits run out this week, chat automatically switches to your key.",
  own: "Chat runs on your key. Nothing is metered against the free credits.",
  /** Shown under an assistant reply when the server fell back to the user's key. */
  ownFallback: AI_SOURCE_FALLBACK_NOTE,
  /** Own key saved, but no model chosen for a provider that needs one
   * (OpenAI / Anthropic / custom — only Google has a server default). The
   * shared note's first sentence; its trailing "This reply ran on…" is about
   * a reply and has no referent ON the settings card. */
  ownKeyIncomplete: firstSentence(AI_NOTE_OWN_KEY_INCOMPLETE),
  /** Under an assistant reply that carried `X-Ai-Note: own-key-incomplete` —
   * the shared constant, verbatim. */
  ownKeyIncompleteReply: AI_NOTE_OWN_KEY_INCOMPLETE,
} as const;

/** `X-Ai-Note` response header (BYOK rule): the server flags a reply that ran
 * on the included AI because the own-key setup was incomplete. */
export { AI_NOTE_HEADER };

/** The sentence a note value earns under the reply, or null for unknown values. */
export function describeAiNote(note: string | null | undefined): string | null {
  return note === "own-key-incomplete" ? AI_MODE_COPY.ownKeyIncompleteReply : null;
}

/**
 * Providers whose key is only usable WITH an explicit model. Google falls back
 * to `gemini-3.8-flash` server-side; everything else has no sensible default,
 * so Save must wait for a chosen model.
 */
export function providerNeedsModel(provider: string): boolean {
  return provider !== "google";
}

/**
 * Is the stored own-key setup complete? Prefers the server's `ownKeyReady`
 * (arriving with the BYOK rule; read defensively since older payloads lack it)
 * and otherwise derives it from what is stored: a key for a provider that
 * needs a model, with no model, is incomplete.
 */
export function resolveOwnKeyReady(settings: UserSettings): boolean {
  const explicit: unknown = (settings as UserSettings & { ownKeyReady?: unknown }).ownKeyReady;
  if (typeof explicit === "boolean") return explicit;
  if (!settings.apiKeySet) return false;
  return !providerNeedsModel(settings.provider) || !!settings.model;
}
