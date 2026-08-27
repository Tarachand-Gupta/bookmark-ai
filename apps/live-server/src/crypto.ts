import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * App-level AES-256-GCM encryption of `windowsJson` (real sanitized tab URLs, page
 * titles, favicon URLs) at rest in Redis.
 *
 * mirrors packages/engine/src/ai-key-crypto.ts — the algorithm is COPIED, not
 * imported, so the live-server stays self-contained (it is rsync-deployed as its
 * own built `dist` and has no `@bookmark-ai/engine` dependency).
 *
 * Envelope: `enc:v1:<iv-b64>:<ciphertext+tag-b64>`, 12-byte random IV, the 16-byte
 * GCM auth tag appended to the ciphertext. Key = 32 raw bytes decoded from a base64
 * secret (LIVE_ENCRYPTION_SECRET) — NO KDF. Decrypt tolerates legacy plaintext
 * (input without the `enc:v1:` prefix is returned unchanged).
 *
 * AAD BINDING: every envelope is authenticated against `${userId}:${deviceId}`
 * (GCM additional authenticated data, contextual — NOT stored in the envelope). A
 * ciphertext lifted out of one device's hash and pasted into another device's (or
 * another user's) hash fails the GCM tag check and degrades to `"[]"` instead of
 * disclosing the original owner's tabs. Rotating the AAD shape is a breaking change
 * for existing ciphertext, which is why it landed before any prod ciphertext existed.
 *
 * The secret is passed IN by the caller (LiveStore holds it from `Config`) rather
 * than read from `process.env` here — module-global env reads made the unit tests
 * depend on the developer's shell.
 *
 * Context: the VM's Redis is loopback-bound but has NO password and RDB persistence
 * is ON, so a local reader / the on-disk snapshot could otherwise read users' tabs.
 * This app-level layer is the actual protection.
 */

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Rate limit for decrypt-failure logs: at most one line per this window. */
const DECRYPT_LOG_INTERVAL_MS = 60_000;

/**
 * Decode the base64 32-byte secret, or null if missing/malformed/wrong length.
 * The SINGLE source of truth for "is this secret usable": `config.ts` calls it at
 * boot to fail loudly on a set-but-invalid value, so "the process booted" and "the
 * crypto layer can use the key" can never disagree.
 */
export function decodeEncryptionSecret(secretB64: string | undefined): Buffer | null {
  if (!secretB64) return null;
  try {
    const buf = Buffer.from(secretB64, "base64");
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

/** True when encryption is configured and usable (⇒ writes should be ciphertext). */
export function encryptionEnabled(secretB64: string | undefined): boolean {
  return decodeEncryptionSecret(secretB64) !== null;
}

/** True when a stored value is one of our envelopes (vs. legacy plaintext JSON). */
export function isEncryptedEnvelope(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

/**
 * The AAD an envelope is bound to. Both sides derive it from the same two ids, so
 * a ciphertext only ever decrypts in the (user, device) slot it was written for.
 */
export function windowsAad(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`;
}

let warnedUnset = false;
let decryptFailures = 0;
// -Infinity (not 0) so "never logged" is not a magic timestamp: with a mocked or
// pre-epoch clock, 0 is a REAL `Date.now()` and a `=== 0` sentinel would defeat
// the rate limit entirely. Any `now - -Infinity` is Infinity ⇒ the first failure logs.
let lastDecryptLogAt = Number.NEGATIVE_INFINITY;

/** Test-only: clear the one-shot warn + the rate-limited failure counter. */
export function resetCryptoDiagnostics(): void {
  warnedUnset = false;
  decryptFailures = 0;
  lastDecryptLogAt = Number.NEGATIVE_INFINITY;
}

/**
 * Encrypt `windowsJson` for storage in Redis, bound to `aad` (see `windowsAad`).
 *  - secret SET   → the `enc:v1:<iv>:<ct+tag>` envelope.
 *  - secret UNSET → the plaintext unchanged, with a ONE-TIME warn (dev ergonomics;
 *    prod sets the secret, and a set-but-INVALID secret can't reach here — it
 *    aborts the process at boot in config.ts).
 *
 * Unlike the web AI-key path (which fails CLOSED on a missing secret), this fails
 * OPEN because live tabs are ephemeral presence data and hard-failing the write
 * would take down presence. If the secret IS set and real crypto throws, we let it
 * throw — a genuine crypto fault should surface, not silently store plaintext.
 */
export function encryptWindows(
  plaintext: string,
  aad: string,
  secretB64: string | undefined,
): string {
  const key = decodeEncryptionSecret(secretB64);
  if (!key) {
    if (!warnedUnset) {
      warnedUnset = true;
      console.warn(
        "[live-crypto] LIVE_ENCRYPTION_SECRET unset — storing windowsJson as PLAINTEXT in Redis",
      );
    }
    return plaintext;
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([ciphertext, tag]);
  return `${PREFIX}${iv.toString("base64")}:${payload.toString("base64")}`;
}

/**
 * Decrypt a stored `windowsJson` value. MUST NOT throw and MUST NOT crash the
 * read/SSE path. Returns:
 *  (a) the decrypted plaintext JSON for a valid `enc:v1:` envelope whose GCM tag
 *      verifies under this key AND this `aad`;
 *  (b) the value unchanged for legacy plaintext (no `enc:v1:` prefix) — this also
 *      covers rows written while the secret was unset; no AAD check applies;
 *  (c) `"[]"` for ANY decrypt failure (rotated/wrong key, wrong owner's AAD,
 *      corrupt payload, secret missing) after a RATE-LIMITED warn — callers
 *      `JSON.parse` the result into `LiveWindow[]`, so a bad snapshot surfaces as
 *      zero windows instead of a 500.
 */
export function decryptWindows(stored: string, aad: string, secretB64: string | undefined): string {
  if (!isEncryptedEnvelope(stored)) return stored; // legacy / plaintext passthrough

  const key = decodeEncryptionSecret(secretB64);
  if (!key) {
    noteDecryptFailure("LIVE_ENCRYPTION_SECRET missing/invalid");
    return "[]";
  }
  try {
    // Exactly two base64 segments — base64 never contains ":", so anything else is
    // a mangled value, not one of ours. Strict rather than lenient on purpose.
    const parts = stored.slice(PREFIX.length).split(":");
    const [ivB64, payloadB64] = parts;
    if (parts.length !== 2 || !ivB64 || !payloadB64) throw new Error("malformed envelope");
    const iv = Buffer.from(ivB64, "base64");
    if (iv.length !== IV_BYTES) throw new Error("bad iv length");
    const payload = Buffer.from(payloadB64, "base64");
    if (payload.length <= TAG_BYTES) throw new Error("payload too short");
    const ciphertext = payload.subarray(0, payload.length - TAG_BYTES);
    const tag = payload.subarray(payload.length - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (err) {
    noteDecryptFailure((err as Error).message);
    return "[]";
  }
}

/**
 * Rate-limited (≤1 line / 60s) but CUMULATIVE decrypt-failure log. A one-shot warn
 * meant a fleet-wide rotation blip produced exactly one line for the whole process
 * lifetime; the running count makes "one corrupt row" vs "every row since the key
 * changed" distinguishable from the journal. Two integers of state — no growth.
 */
function noteDecryptFailure(reason: string): void {
  decryptFailures += 1;
  const now = Date.now();
  if (now - lastDecryptLogAt < DECRYPT_LOG_INTERVAL_MS) return;
  lastDecryptLogAt = now;
  console.warn(
    `[live-crypto] windowsJson decrypt failed (${decryptFailures} total since boot): ${reason} — returning empty windows`,
  );
}
