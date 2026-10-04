import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createMfaVerificationGuard, createSessionAssuranceGate } from "./session-assurance";
const session = (token: string, user = "A") => ({ access_token: token, user: { id: user } });

test("MFA restore stays blocked until AAL2; refresh downgrade immediately closes admission", async () => {
  const gate = createSessionAssuranceGate(async (token) => ({ currentLevel: token === "aal2" ? "aal2" : "aal1", nextLevel: "aal2" }));
  const first = session("aal1"), verified = session("aal2");
  gate.observe(first); assert.equal(gate.allowed(first), false);
  assert.equal((await gate.check(first)).status, "required"); assert.equal(gate.allowed(first), false);
  gate.observe(verified); assert.equal(gate.allowed(verified), false);
  await gate.check(verified); assert.equal(gate.allowed(verified), true);
  gate.observe(first); assert.equal(gate.allowed(verified), false); assert.equal(gate.allowed(first), false);
  assert.equal((await gate.check(first)).status, "required");
});
test("account switch and signout discard late admission without resurrecting old session", async () => {
  let release!: (value: { currentLevel: string; nextLevel: string }) => void;
  const gate = createSessionAssuranceGate(() => new Promise((resolve) => { release = resolve; }));
  const old = session("old"), next = session("new", "B");
  gate.observe(old); const oldCheck = gate.check(old); gate.observe(next);
  release({ currentLevel: "aal2", nextLevel: "aal2" }); await oldCheck;
  assert.equal(gate.getState().userId, "B"); assert.equal(gate.getState().status, "checking"); assert.equal(gate.allowed(old), false);
  await gate.check(old); assert.equal(gate.getState().userId, "B");
  const newCheck = gate.check(next); gate.observe(null); release({ currentLevel: "aal2", nextLevel: "aal2" }); await newCheck;
  assert.equal(gate.getState().status, "signed-out"); assert.equal(gate.allowed(next), false);
});
test("parallel checks single-flight; provider outage is retryable and missing AAL fails closed", async () => {
  let calls = 0, fail = true;
  const gate = createSessionAssuranceGate(async () => { calls++; if (fail) throw new Error("503"); return { currentLevel: "aal1", nextLevel: "aal1" }; });
  const current = session("token"); gate.observe(current);
  await Promise.all(Array.from({ length: 8 }, () => gate.check(current)));
  assert.equal(calls, 1); assert.equal(gate.getState().status, "unavailable"); assert.equal(gate.getState().token, "token");
  fail = false; await gate.check(current); assert.equal(gate.allowed(current), true);
  const missing = createSessionAssuranceGate(async () => ({ currentLevel: null, nextLevel: null }));
  missing.observe(current); assert.equal((await missing.check(current)).status, "unavailable"); assert.equal(missing.allowed(current), false);
});

test("real SDK checks live factors, invalid code stays blocked, valid challenge emits AAL2 admission", async () => {
  const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "mfa@example.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-10-04T00:00:00Z", factors: [{ id: "factor-id", status: "verified", factor_type: "totp" }] };
  const jwt = (aal: string) => `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600, aal })).toString("base64url")}.${Buffer.from("fixture-signature").toString("base64url")}`;
  const key = "assurance-session", storage = new Map([[key, JSON.stringify({ access_token: jwt("aal1"), refresh_token: "fixture-refresh", expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: "bearer", user: { ...user, factors: [] } })]]);
  let liveChecks = 0;
  let delayedVerify: (() => void) | null = null, enteredVerify: (() => void) | null = null;
  let delay = false;
  const client = createClient("https://fixture.supabase.co", "fixture-public-key", { auth: { storageKey: key, autoRefreshToken: false, detectSessionInUrl: false, storage: { getItem: (name) => storage.get(name) ?? null, setItem: (name, value) => { storage.set(name, value); }, removeItem: (name) => { storage.delete(name); } } }, global: { fetch: async (url, init) => {
    if (String(url).endsWith("/user")) { liveChecks++; return new Response(JSON.stringify(user), { status: 200 }); }
    if (String(url).endsWith("/challenge")) return new Response(JSON.stringify({ id: "challenge-id", type: "totp", expires_at: 9999999999 }), { status: 200 });
    if (String(url).endsWith("/verify")) {
      const code = JSON.parse(String(init?.body)).code;
      if (delay) await new Promise<void>((resolve) => { delayedVerify = resolve; enteredVerify?.(); });
      return code !== "123456" ? new Response(JSON.stringify({ message: "Invalid code", code: "mfa_verification_failed" }), { status: 400 }) : new Response(JSON.stringify({ access_token: jwt("aal2"), refresh_token: "fixture-rotated", expires_in: 3600, token_type: "bearer", user }), { status: 200 });
    }
    if (String(url).includes("/logout")) return new Response(null, { status: 204 });
    throw new Error("Unexpected test request");
  } } });
  const gate = createSessionAssuranceGate(async (token) => { const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel(token); assert.equal(error, null); assert.ok(data); return data; });
  const verification = createMfaVerificationGuard();
  let discarded = 0;
  const { data: listener } = client.auth.onAuthStateChange((event, next) => {
    if (!verification.observe(event, next?.user.id ?? null)) { discarded++; gate.observe(null); }
    else gate.observe(next);
  });
  try {
    const initial = (await client.auth.getSession()).data.session!; gate.observe(initial);
    assert.equal((await gate.check(initial)).status, "required"); assert.equal(liveChecks, 1);
    const firstTicket = verification.begin(user.id);
    assert.ok((await client.auth.mfa.challengeAndVerify({ factorId: "factor-id", code: "000000" })).error);
    assert.equal(gate.allowed(initial), false);
    assert.equal((await client.auth.mfa.challengeAndVerify({ factorId: "factor-id", code: "123456" })).error, null);
    const verified = (await client.auth.getSession()).data.session!;
    assert.equal(gate.getState().status, "checking"); await gate.check(verified);
    assert.equal(gate.allowed(verified), true); assert.equal(gate.allowed(initial), false);
    verification.finish(firstTicket);
    // Real SDK + mocked HTTP: hold a verify response while signout completes.
    delay = true;
    const waiting = new Promise<void>((resolve) => { enteredVerify = resolve; });
    const staleTicket = verification.begin(user.id);
    const late = client.auth.mfa.challengeAndVerify({ factorId: "factor-id", code: "123456" });
    await waiting;
    await client.auth.signOut({ scope: "local" });
    delayedVerify!(); await late;
    assert.equal(verification.finish(staleTicket), false); assert.equal(discarded, 1);
    assert.equal(gate.getState().status, "signed-out"); assert.equal(gate.allowed(verified), false);
    // auth-js saved the stale response, so the rejected-event path must remove it.
    assert.ok((await client.auth.getSession()).data.session);
    await client.auth.signOut({ scope: "local" });
    assert.equal((await client.auth.getSession()).data.session, null);
  } finally { listener.subscription.unsubscribe(); client.auth.dispose(); }
});

test("verification guard rejects account-switch and revoked challenge events", () => {
  const guard = createMfaVerificationGuard();
  const first = guard.begin("A");
  assert.equal(guard.observe("SIGNED_IN", "B"), true);
  assert.equal(guard.observe("MFA_CHALLENGE_VERIFIED", "A"), false);
  assert.equal(guard.finish(first), false);
  const next = guard.begin("B"); guard.invalidate();
  assert.equal(guard.observe("MFA_CHALLENGE_VERIFIED", "B"), false);
  assert.equal(guard.finish(next), false);
  assert.equal(guard.observe("MFA_CHALLENGE_VERIFIED", "B"), false);
});
