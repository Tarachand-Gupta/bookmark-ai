import assert from "node:assert/strict";
import { test } from "node:test";
import { displayLabel, nativeAppleExchange, nativeCallback, profileName, profileNameUpdate } from "./auth-policy";

const redirect = "bookmarkai-supabase-qa://sso-callback", now = 1_000_000;
const pending = { state: "random-attempt", createdAt: now - 100, flow: "google" as const };
const valid = `${redirect}?bmai_state=random-attempt&code=pkce-code`;
test("native callback accepts only the exact current PKCE flow", () => {
  assert.equal(nativeCallback(valid, redirect, pending, now), "pkce-code");
  for (const url of [valid.replace("supabase-qa", "production"), valid.replace("sso-callback", "sso-callback.attacker"), valid.replace("random-attempt", "other"), `${valid}&code=duplicate`, `${valid}&bmai_state=random-attempt`, `${valid}#access_token=secret`, `${valid}&refresh_token=secret`, `${valid}&error=access_denied`, `${redirect}?bmai_state=random-attempt`]) assert.throws(() => nativeCallback(url, redirect, pending, now));
  assert.throws(() => nativeCallback(valid, redirect, null, now));
  assert.throws(() => nativeCallback(valid, redirect, { ...pending, createdAt: now - 900_001 }, now));
  assert.throws(() => nativeCallback(valid, redirect, { ...pending, createdAt: now + 1 }, now));
});
test("Apple sends the hashed nonce to the OS and raw nonce to Supabase, retaining first-grant name", async () => {
  const calls: unknown[] = [];
  await nativeAppleExchange({ nonce: "raw", state: "attempt", hash: async (value) => `sha256:${value}`,
    signIn: async (request) => { calls.push(request); return { identityToken: "apple-jwt", state: "attempt", fullName: { givenName: "Tara", familyName: "Gupta" } }; },
    exchange: async (token, nonce) => { calls.push({ token, nonce }); }, saveName: async (name) => { calls.push(name); } });
  assert.deepEqual(calls, [{ nonce: "sha256:raw", state: "attempt" }, { token: "apple-jwt", nonce: "raw" }, "Tara Gupta"]);
});
test("Apple state mismatch or absent identity token never reaches Supabase", async () => {
  for (const credential of [{ state: "wrong", identityToken: "jwt" }, { state: "attempt", identityToken: null }]) {
    let exchanged = false;
    await assert.rejects(nativeAppleExchange({ nonce: "raw", state: "attempt", hash: async () => "hash", signIn: async () => credential, exchange: async () => { exchanged = true; }, saveName: async () => undefined }), /invalid/);
    assert.equal(exchanged, false);
  }
});
test("device labels strip controls and stay bounded", () => {
  assert.equal(displayLabel("  iPad\nTara\0 ", "device"), "iPadTara");
  assert.equal(displayLabel(" ", "device"), "device"); assert.equal(displayLabel("x".repeat(200), "device").length, 80);
});
test("profile name changes replace both historical metadata fields consistently", () => {
  assert.equal(profileName({ display_name: "Legacy name" }), "Legacy name");
  const previous = { full_name: "Provider name", display_name: "Old web name" };
  const changed = { ...previous, ...profileNameUpdate("  New name\n ") };
  assert.equal(profileName(changed), "New name"); assert.equal(changed.display_name, "New name");
  assert.equal(profileName({ full_name: "", display_name: "Fallback" }), "Fallback");
});
