import type { UserSettingsPatch } from "@bookmark-ai/db";
import type { UpdateUserSettingsInput } from "@bookmark-ai/types";

/**
 * PUT /api/settings body → the partial DB patch, as a PURE function (unit-tested;
 * the route wraps it with the async SSRF check and the DB write). Encodes the
 * field semantics the clients rely on:
 *
 *  - absent = keep, for every field.
 *  - `provider` sets provider (+ clears baseUrl unless custom) and NOTHING else
 *    — changing provider never clears the key and never nulls the model.
 *  - `model`: "" = clear, else set (independent of `provider`).
 *  - `apiKey`: "" = REMOVE the key AND switch to `included`; a non-empty key is
 *    stored (encrypted) AND, unless `aiMode` is sent too, switches to `own`.
 *  - `aiMode`: sets the mode WITHOUT touching key/provider/model. `own` is a 400
 *    when no key would be stored after this request.
 */

export const OWN_MODE_NEEDS_KEY_MESSAGE = "Add an API key before switching to your own key";
export const ENCRYPTION_UNAVAILABLE_MESSAGE = "Encryption is not configured on the server";

export interface SettingsPatchContext {
  /** Whether a (decryptable) key is stored on the existing row. */
  hasStoredKey: boolean;
  /** Encrypt-at-rest for a new key; may throw when the secret is unset. */
  encrypt: (plaintext: string) => string;
}

export type SettingsPatchResult =
  | { ok: true; patch: UserSettingsPatch }
  | { ok: false; status: 400 | 500; error: string };

export function buildSettingsPatch(
  input: UpdateUserSettingsInput,
  ctx: SettingsPatchContext,
): SettingsPatchResult {
  const {
    provider,
    apiKey,
    baseUrl,
    model,
    aiMode,
    liveServerUrl,
    onboarded,
    nativeSyncEnabled,
    nativeSyncFull,
    mcpTools,
  } = input;
  const patch: UserSettingsPatch = {};

  // provider: a base URL only makes sense for a custom provider — clear it
  // otherwise. The model is deliberately NOT touched here (see `model` below).
  if (provider !== undefined) {
    patch.aiProvider = provider;
    patch.aiBaseUrl = provider === "custom" ? (baseUrl ?? null) : null;
  }
  // model: absent → keep; "" → clear; else set.
  if (model !== undefined) patch.aiModel = model.trim() === "" ? null : model;

  // apiKey: absent → keep; "" → clear (+ mode included); else encrypt-at-rest
  // (AES-256-GCM `enc:v1:` envelope; also the lazy re-encryption path for any
  // legacy plaintext row) (+ mode own unless aiMode is explicit). Encryption
  // fails CLOSED — a missing secret is a clean 500, never a plaintext write.
  let keyAfter = ctx.hasStoredKey;
  if (apiKey !== undefined) {
    if (apiKey.trim() === "") {
      patch.aiApiKey = null;
      keyAfter = false;
      if (aiMode === undefined) patch.aiMode = "included";
    } else {
      try {
        patch.aiApiKey = ctx.encrypt(apiKey);
      } catch {
        return { ok: false, status: 500, error: ENCRYPTION_UNAVAILABLE_MESSAGE };
      }
      keyAfter = true;
      if (aiMode === undefined) patch.aiMode = "own";
    }
  }

  // aiMode: explicit wins over the implicit switch above; `own` needs a key.
  if (aiMode !== undefined) {
    if (aiMode === "own" && !keyAfter) {
      return { ok: false, status: 400, error: OWN_MODE_NEEDS_KEY_MESSAGE };
    }
    patch.aiMode = aiMode;
  }

  // liveServerUrl: absent → keep; "" or null → clear; else set.
  if (liveServerUrl !== undefined) patch.liveServerUrl = liveServerUrl ? liveServerUrl : null;
  // onboarded: true → stamp now (marks the tour seen). Absent/false → untouched.
  if (onboarded) patch.onboardedAt = new Date().toISOString();
  // Native-sync toggles: absent → keep; the Sync section PATCHes exactly one.
  if (nativeSyncEnabled !== undefined) patch.nativeSyncEnabled = nativeSyncEnabled;
  if (nativeSyncFull !== undefined) patch.nativeSyncFull = nativeSyncFull;
  // mcpTools: absent → keep; null → reset to default (all tools); array → exact allowlist.
  if (mcpTools !== undefined) patch.mcpToolsJson = mcpTools === null ? null : JSON.stringify(mcpTools);

  return { ok: true, patch };
}
