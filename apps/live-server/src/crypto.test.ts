import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mock, test } from "node:test";
import {
  decodeEncryptionSecret,
  decryptWindows,
  encryptionEnabled,
  encryptWindows,
  isEncryptedEnvelope,
  resetCryptoDiagnostics,
  windowsAad,
} from "./crypto";

/**
 * At-rest crypto for `windowsJson` (AES-256-GCM, `enc:v1:` envelope, AAD-bound to
 * `userId:deviceId`). The security properties under test are the ones the read path
 * depends on:
 *   - decrypt NEVER throws (a corrupt row must render as zero windows, not 500);
 *   - a ciphertext only opens under the SAME key AND the SAME owner (AAD);
 *   - legacy plaintext passes through untouched, so migration is a no-op read;
 *   - a missing secret degrades to plaintext WRITES loudly, once.
 * The secret is an explicit argument (never process.env), so these are hermetic
 * regardless of the developer's shell. Run: `pnpm --filter @bookmark-ai/live-server test`.
 */

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");

const USER_A = "user_aaaaaaaaaaaaaaaaaaaaaaaaa";
const USER_B = "user_bbbbbbbbbbbbbbbbbbbbbbbbb";
const DEV_1 = "11111111-1111-1111-1111-111111111111";
const DEV_2 = "22222222-2222-2222-2222-222222222222";

const AAD_A1 = windowsAad(USER_A, DEV_1);
const PLAINTEXT = JSON.stringify([
  { windowId: 1, tabs: [{ url: "https://secret.test/inbox", title: "Inbox" }] },
]);

/** Run `fn` with console.warn captured; returns the lines it emitted. */
function captureWarn<T>(fn: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    return { result: fn(), warnings };
  } finally {
    console.warn = original;
  }
}

// ── secret decoding ──────────────────────────────────────────────────────────

test("decodeEncryptionSecret accepts exactly 32 base64 bytes, rejects everything else", () => {
  assert.equal(decodeEncryptionSecret(KEY_A)?.length, 32);
  assert.equal(decodeEncryptionSecret(undefined), null, "unset");
  assert.equal(decodeEncryptionSecret(""), null, "empty");
  assert.equal(decodeEncryptionSecret(randomBytes(16).toString("base64")), null, "16 bytes");
  assert.equal(decodeEncryptionSecret(randomBytes(48).toString("base64")), null, "48 bytes");
  assert.equal(decodeEncryptionSecret("not-base64-at-all"), null, "junk");
  assert.equal(
    decodeEncryptionSecret(randomBytes(32).toString("hex")),
    null,
    "hex is the classic mistake: 64 chars ⇒ 48 decoded bytes",
  );
  assert.equal(encryptionEnabled(KEY_A), true);
  assert.equal(encryptionEnabled(undefined), false);
  assert.equal(encryptionEnabled("not-base64-at-all"), false);
});

// ── round trip ───────────────────────────────────────────────────────────────

test("round-trip with AAD returns the exact plaintext", () => {
  resetCryptoDiagnostics();
  const stored = encryptWindows(PLAINTEXT, AAD_A1, KEY_A);
  assert.ok(isEncryptedEnvelope(stored), "stored value carries the enc:v1: prefix");
  assert.ok(!stored.includes("secret.test"), "no plaintext leaks into the envelope");
  assert.equal(decryptWindows(stored, AAD_A1, KEY_A), PLAINTEXT);
});

test("each encryption uses a fresh IV (envelopes differ, both decrypt)", () => {
  resetCryptoDiagnostics();
  const a = encryptWindows(PLAINTEXT, AAD_A1, KEY_A);
  const b = encryptWindows(PLAINTEXT, AAD_A1, KEY_A);
  assert.notEqual(a, b, "random IV ⇒ ciphertext is never byte-identical");
  assert.equal(decryptWindows(a, AAD_A1, KEY_A), PLAINTEXT);
  assert.equal(decryptWindows(b, AAD_A1, KEY_A), PLAINTEXT);
});

test("empty-windows plaintext round-trips (the 'all windows closed' state)", () => {
  resetCryptoDiagnostics();
  const stored = encryptWindows("[]", AAD_A1, KEY_A);
  assert.equal(decryptWindows(stored, AAD_A1, KEY_A), "[]");
});

// ── legacy plaintext passthrough ─────────────────────────────────────────────

test("legacy plaintext passes through unchanged (secret set or unset, any AAD)", () => {
  resetCryptoDiagnostics();
  const { warnings } = captureWarn(() => {
    assert.equal(decryptWindows(PLAINTEXT, AAD_A1, KEY_A), PLAINTEXT, "secret set");
    assert.equal(decryptWindows(PLAINTEXT, AAD_A1, undefined), PLAINTEXT, "secret unset");
    assert.equal(
      decryptWindows(PLAINTEXT, windowsAad(USER_B, DEV_2), KEY_A),
      PLAINTEXT,
      "no AAD check applies to plaintext",
    );
  });
  assert.deepEqual(warnings, [], "passthrough is not a failure — must not log");
});

// ── wrong key / wrong owner ──────────────────────────────────────────────────

test("wrong key → '[]' (rotation orphans ciphertext instead of 500ing)", () => {
  resetCryptoDiagnostics();
  const stored = encryptWindows(PLAINTEXT, AAD_A1, KEY_A);
  const { result } = captureWarn(() => decryptWindows(stored, AAD_A1, KEY_B));
  assert.equal(result, "[]");
});

test("wrong AAD: ciphertext moved to another DEVICE of the same user → '[]'", () => {
  resetCryptoDiagnostics();
  const stored = encryptWindows(PLAINTEXT, windowsAad(USER_A, DEV_1), KEY_A);
  const { result } = captureWarn(() => decryptWindows(stored, windowsAad(USER_A, DEV_2), KEY_A));
  assert.equal(result, "[]", "a hash copied device→device must not disclose tabs");
});

test("wrong AAD: ciphertext moved to another USER → '[]'", () => {
  resetCryptoDiagnostics();
  const stored = encryptWindows(PLAINTEXT, windowsAad(USER_A, DEV_1), KEY_A);
  const { result } = captureWarn(() => decryptWindows(stored, windowsAad(USER_B, DEV_1), KEY_A));
  assert.equal(result, "[]", "same key, different tenant ⇒ auth tag fails");
});

// ── corrupt envelopes ────────────────────────────────────────────────────────

test("every corrupt envelope shape → '[]' and never throws", () => {
  resetCryptoDiagnostics();
  const good = encryptWindows(PLAINTEXT, AAD_A1, KEY_A);
  const [, ivB64, payloadB64] = good.split(":");

  const corrupt: Array<[string, string]> = [
    ["prefix only", "enc:v1:"],
    ["no separator", "enc:v1:garbage"],
    ["empty iv", `enc:v1::${payloadB64}`],
    ["empty payload", `enc:v1:${ivB64}:`],
    ["non-base64 halves", "enc:v1:!!!:!!!"],
    ["short iv", `enc:v1:${Buffer.from("abc").toString("base64")}:${payloadB64}`],
    ["payload shorter than the tag", `enc:v1:${ivB64}:${Buffer.alloc(8).toString("base64")}`],
    ["truncated ciphertext", good.slice(0, good.length - 8)],
    ["extra segment", `${good}:extra`],
    ["wrong version-ish body", "enc:v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAA"],
  ];

  captureWarn(() => {
    for (const [name, value] of corrupt) {
      let out: string | undefined;
      assert.doesNotThrow(() => {
        out = decryptWindows(value, AAD_A1, KEY_A);
      }, `decrypt must not throw on: ${name}`);
      assert.equal(out, "[]", `corrupt (${name}) must degrade to zero windows`);
    }
  });
});

test("a single flipped byte in the ciphertext → '[]' (GCM integrity)", () => {
  resetCryptoDiagnostics();
  const good = encryptWindows(PLAINTEXT, AAD_A1, KEY_A);
  const [, ivB64, payloadB64] = good.split(":");
  const payload = Buffer.from(payloadB64 as string, "base64");
  payload[0] = payload[0] === undefined ? 0 : payload[0] ^ 0xff;
  const tampered = `enc:v1:${ivB64}:${payload.toString("base64")}`;
  const { result } = captureWarn(() => decryptWindows(tampered, AAD_A1, KEY_A));
  assert.equal(result, "[]");
});

test("envelope + missing secret → '[]' (never the raw ciphertext)", () => {
  resetCryptoDiagnostics();
  const stored = encryptWindows(PLAINTEXT, AAD_A1, KEY_A);
  const { result, warnings } = captureWarn(() => decryptWindows(stored, AAD_A1, undefined));
  assert.equal(result, "[]");
  assert.match(warnings[0] ?? "", /LIVE_ENCRYPTION_SECRET missing\/invalid/);
});

// ── unset secret (dev plaintext mode) ────────────────────────────────────────

test("unset secret → encrypt passes the plaintext through, warning exactly once", () => {
  resetCryptoDiagnostics();
  const { result, warnings } = captureWarn(() => {
    const first = encryptWindows(PLAINTEXT, AAD_A1, undefined);
    const second = encryptWindows(PLAINTEXT, AAD_A1, undefined);
    assert.equal(second, PLAINTEXT);
    return first;
  });
  assert.equal(result, PLAINTEXT, "stored value is the plaintext, unwrapped");
  assert.equal(isEncryptedEnvelope(result), false);
  assert.equal(warnings.length, 1, "the plaintext-mode warn is one-shot, not per write");
  assert.match(warnings[0] ?? "", /PLAINTEXT/);
});

// ── rate-limited, cumulative failure logging (the one-shot-warn fix) ─────────

test("decrypt failures log at most once per 60s and carry the cumulative count", () => {
  resetCryptoDiagnostics();
  mock.timers.enable({ apis: ["Date"] });
  try {
    const stored = encryptWindows(PLAINTEXT, AAD_A1, KEY_A);
    const { warnings } = captureWarn(() => {
      // A rotation blip: many rows fail back to back.
      for (let i = 0; i < 5; i += 1) decryptWindows(stored, AAD_A1, KEY_B);
    });
    assert.equal(warnings.length, 1, "5 failures in one window ⇒ 1 line, not 5 and not 0");
    assert.match(warnings[0] ?? "", /\(1 total since boot\)/);

    // Still inside the window: silent, but still counted.
    const quiet = captureWarn(() => decryptWindows(stored, AAD_A1, KEY_B));
    assert.deepEqual(quiet.warnings, [], "no second line inside the 60s window");

    // Past the window: one more line, reporting everything since boot.
    mock.timers.tick(60_001);
    const later = captureWarn(() => decryptWindows(stored, AAD_A1, KEY_B));
    assert.equal(later.warnings.length, 1);
    assert.match(
      later.warnings[0] ?? "",
      /\(7 total since boot\)/,
      "the counter accumulates across the suppressed window (5 + 1 + 1)",
    );
  } finally {
    mock.timers.reset();
    resetCryptoDiagnostics();
  }
});
