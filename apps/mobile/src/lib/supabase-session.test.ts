import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
const user = { id: "00000000-0000-0000-0000-000000000001", aud: "authenticated", role: "authenticated", email: "fixture@example.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-10-04T00:00:00Z" };
const jwt = (exp: number) => `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp, aud: "authenticated" })).toString("base64url")}.signature`;

for (const days of [21, 30]) test(`SDK single-flight restores a simulated ${days}-day idle session once`, async () => {
  const key = "bookmark-ai:supabase-qa:session", now = Math.floor(Date.now() / 1000);
  const expiredAt = now - days * 86400;
  const data = new Map([[key, JSON.stringify({ access_token: jwt(expiredAt), refresh_token: "original-refresh", expires_at: expiredAt, expires_in: 3600, token_type: "bearer", user })]]);
  let refreshes = 0;
  const client = createClient("https://fixture.supabase.co", "public-fixture-key", { auth: { storageKey: key, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false,
    storage: { getItem: async (name) => data.get(name) ?? null, setItem: async (name, value) => { data.set(name, value); }, removeItem: async (name) => { data.delete(name); } },
  }, global: { fetch: async (url, options) => {
    assert.match(String(url), /token\?grant_type=refresh_token/); assert.match(String(options?.body), /original-refresh/);
    refreshes++; await new Promise((resolve) => setTimeout(resolve, 10));
    return new Response(JSON.stringify({ access_token: jwt(now + 3600), refresh_token: "rotated-refresh", expires_in: 3600, token_type: "bearer", user }), { status: 200, headers: { "content-type": "application/json" } });
  } } });
  try {
    const results = await Promise.all(Array.from({ length: 12 }, () => client.auth.getSession()));
    for (const result of results) { assert.equal(result.error, null); assert.equal(result.data.session?.refresh_token, "rotated-refresh"); }
    assert.equal(refreshes, 1); assert.match(data.get(key)!, /rotated-refresh/);
  } finally { client.auth.dispose(); }
});

test("SDK provider outage returns retryable error and retains encrypted-session adapter input", async (t) => {
  const clock = Date.now(), key = "bookmark-ai:supabase-qa:session", now = Math.floor(clock / 1000);
  const original = JSON.stringify({ access_token: jwt(now + 3600), refresh_token: "original-refresh", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user });
  const data = new Map([[key, original]]);
  t.mock.timers.enable({ apis: ["Date"], now: clock });
  const client = createClient("https://fixture.supabase.co", "public-fixture-key", { auth: { storageKey: key, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false,
    storage: { getItem: async (name) => data.get(name) ?? null, setItem: async (name, value) => { data.set(name, value); }, removeItem: async (name) => { data.delete(name); } },
  }, global: { fetch: async () => {
    // Advance past the SDK retry budget instead of sleeping30 seconds; the
    // real SDK still classifies the503 and decides whether to erase storage.
    t.mock.timers.setTime(clock + 31_000);
    return new Response(JSON.stringify({ message: "temporarily unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
  } } });
  try {
    await client.auth.getSession();
    const result = await client.auth.refreshSession();
    assert.equal(result.error?.name, "AuthRetryableFetchError");
    assert.equal(data.get(key), original); assert.equal((await client.auth.getSession()).data.session?.refresh_token, "original-refresh");
  } finally { client.auth.dispose(); t.mock.timers.reset(); }
});

test("SDK never resurrects a session when signout wins a concurrent refresh", async () => {
  const key = "bookmark-ai:supabase-qa:session", now = Math.floor(Date.now() / 1000);
  const data = new Map([[key, JSON.stringify({ access_token: jwt(now + 3600), refresh_token: "original-refresh", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user })]]);
  let release!: () => void, started!: () => void;
  const refreshStarted = new Promise<void>((resolve) => { started = resolve; }), responseGate = new Promise<void>((resolve) => { release = resolve; });
  const client = createClient("https://fixture.supabase.co", "public-fixture-key", { auth: { storageKey: key, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false,
    storage: { getItem: async (name) => data.get(name) ?? null, setItem: async (name, value) => { data.set(name, value); }, removeItem: async (name) => { data.delete(name); } },
  }, global: { fetch: async (url) => {
    if (String(url).includes("/logout")) return new Response(null, { status: 204 });
    assert.match(String(url), /token\?grant_type=refresh_token/); started(); await responseGate;
    return new Response(JSON.stringify({ access_token: jwt(now + 7200), refresh_token: "rotated-refresh", expires_in: 7200, token_type: "bearer", user }), { status: 200, headers: { "content-type": "application/json" } });
  } } });
  try {
    await client.auth.getSession();
    const refresh = client.auth.refreshSession(); await refreshStarted;
    assert.equal((await client.auth.signOut({ scope: "local" })).error, null);
    release(); const result = await refresh;
    assert.equal(result.error?.name, "AuthRefreshDiscardedError");
    assert.equal(data.get(key), undefined); assert.equal((await client.auth.getSession()).data.session, null);
  } finally { release(); client.auth.dispose(); }
});
