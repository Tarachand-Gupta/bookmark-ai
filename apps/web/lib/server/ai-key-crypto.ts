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
 * Encrypt a plaintext API key for storage. If the secret is missing/invalid we
 * DEGRADE to storing plaintext (with a loud warn) rather than crashing the
 * settings save — the read path already tolerates legacy plaintext, and the key
 * gets encrypted on the next write once the secret is present. In every
 * configured environment the secret is set, so this is a safety net only.
 */
export function encryptApiKey(plaintext: string): string {
  const s = secret();
  if (!s) {
    console.warn("[ai-key] AI_KEY_ENCRYPTION_SECRET is unset — storing AI key WITHOUT encryption");
    return plaintext;
  }
  try {
    return encryptWithSecret(plaintext, s);
  } catch (err) {
    console.warn("[ai-key] encryption failed, storing plaintext:", (err as Error).message);
    return plaintext;
  }
}

/** Decrypt a stored API key (handles legacy plaintext + missing secret → null). */
export function decryptApiKey(stored: string | null | undefined): string | null {
  return decryptWithSecret(stored, secret());
}
