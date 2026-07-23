import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for AI provider API keys stored in `user_settings`.
 *
 * Stored format: `enc:v1:<iv-b64>:<ciphertext+tag-b64>` where the tag is the
 * trailing 16 bytes of the payload. Following the packages-never-read-process.env
 * rule, the 32-byte key is passed in (base64) by the API adapter; this module is
 * pure. nodejs-only (uses `node:crypto`) — chat/settings routes run the nodejs
 * runtime.
 *
 * Legacy plaintext: values WITHOUT the `enc:v1:` prefix are treated as legacy
 * plaintext and passed through by `decryptApiKey`. They are re-encrypted lazily
 * the next time the key is written (the write path always encrypts) — we never
 * bulk-rewrite tenant DBs.
 */

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Decode the base64 32-byte secret, or null if missing/malformed/wrong length. */
function decodeSecret(secretB64: string | null | undefined): Buffer | null {
  if (!secretB64) return null;
  try {
    const buf = Buffer.from(secretB64, "base64");
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

/** True iff `stored` is in our `enc:v1:` envelope (vs. legacy plaintext / null). */
export function isEncryptedApiKey(stored: string | null | undefined): boolean {
  return typeof stored === "string" && stored.startsWith(PREFIX);
}

/**
 * Encrypt a plaintext API key into the `enc:v1:` envelope. Throws if the secret
 * is missing or not a 32-byte base64 value — the API adapter decides whether to
 * surface that or degrade (see apps/web/lib/server/ai-key-crypto.ts).
 */
export function encryptApiKey(plaintext: string, secretB64: string | null | undefined): string {
  const key = decodeSecret(secretB64);
  if (!key) {
    throw new Error("AI_KEY_ENCRYPTION_SECRET is missing or not a 32-byte base64 value");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([ciphertext, tag]);
  return `${PREFIX}${iv.toString("base64")}:${payload.toString("base64")}`;
}

/**
 * Decrypt a stored API key. Returns:
 *  - the plaintext for a valid `enc:v1:` value,
 *  - the value unchanged for legacy plaintext (no prefix),
 *  - null for null/empty input,
 *  - null (with a one-line warn) when the secret is missing/wrong or the payload
 *    fails authentication — the caller degrades to "no key configured", never
 *    crashes.
 */
export function decryptApiKey(
  stored: string | null | undefined,
  secretB64: string | null | undefined,
): string | null {
  if (stored == null || stored === "") return null;
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext

  const key = decodeSecret(secretB64);
  if (!key) {
    console.warn("[ai-key-crypto] cannot decrypt: AI_KEY_ENCRYPTION_SECRET missing/invalid");
    return null;
  }
  try {
    const [ivB64, payloadB64] = stored.slice(PREFIX.length).split(":");
    if (!ivB64 || !payloadB64) throw new Error("malformed envelope");
    const iv = Buffer.from(ivB64, "base64");
    const payload = Buffer.from(payloadB64, "base64");
    if (payload.length <= TAG_BYTES) throw new Error("payload too short");
    const ciphertext = payload.subarray(0, payload.length - TAG_BYTES);
    const tag = payload.subarray(payload.length - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (err) {
    console.warn("[ai-key-crypto] decrypt failed:", (err as Error).message);
    return null;
  }
}
