import {
  decryptApiKey as decryptWithSecret,
  encryptApiKey as encryptWithSecret,
} from "@bookmark-ai/engine";

/**
 * Env-reading wrapper around the engine's pure AES-256-GCM key crypto. All
 * process.env access lives in the app adapter (packages never read env). The
 * secret is `AI_KEY_ENCRYPTION_SECRET` (base64 32 bytes), set in root `.env` and
 * Vercel prod+preview.
 */

function secret(): string | undefined {
  return process.env.AI_KEY_ENCRYPTION_SECRET;
}

/**
 * Encrypt a plaintext API key for storage. FAIL-CLOSED: if the secret is missing
 * or encryption fails we THROW rather than persist the key unencrypted. A user's
 * provider API key must never be written to the DB in plaintext, so the settings
 * save fails loudly (the callsite turns the throw into a clean HTTP error) and
 * nothing is stored. The read path (`decryptApiKey`) stays tolerant of legacy
 * plaintext and a missing secret; only this write path is strict.
 */
export function encryptApiKey(plaintext: string): string {
  const s = secret();
  if (!s) {
    throw new Error(
      "AI_KEY_ENCRYPTION_SECRET is not configured — refusing to store AI key unencrypted",
    );
  }
  try {
    return encryptWithSecret(plaintext, s);
  } catch (err) {
    throw new Error("Failed to encrypt AI key: " + (err as Error).message);
  }
}

/** Decrypt a stored API key (handles legacy plaintext + missing secret → null). */
export function decryptApiKey(stored: string | null | undefined): string | null {
  return decryptWithSecret(stored, secret());
}
