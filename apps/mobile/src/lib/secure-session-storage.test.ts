import assert from "node:assert/strict";
import { test } from "node:test";
import { createSecureSessionStorage, secureChunks } from "./secure-session-storage";

function fixture() {
  const values = new Map<string, string>(); let writes = 0, failAt = -1, generation = 0;
  const storage = createSecureSessionStorage({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { if (++writes === failAt) throw new Error("keychain locked"); values.set(key, value); },
    removeItem: async (key) => { values.delete(key); },
  }, "bookmark-ai:supabase-qa", () => `g${++generation}`);
  return { storage, values, failAfter: (count: number) => { failAt = writes + count; } };
}

test("large Unicode sessions round-trip within SecureStore's byte bound", async () => {
  const value = JSON.stringify({ access_token: "a".repeat(5000), user: { name: "🪷你好".repeat(600) } });
  const chunks = secureChunks(value);
  assert.ok(chunks.length > 5); assert.equal(chunks.join(""), value);
  for (const chunk of chunks) assert.ok(Buffer.byteLength(chunk) <= 1500);
  const { storage, values } = fixture();
  await storage.setItem("session", value); assert.equal(await storage.getItem("session"), value);
  for (const key of values.keys()) assert.match(key, /^bookmark-ai_supabase-qa\./);
  await storage.removeItem("session"); assert.equal(await storage.getItem("session"), null); assert.equal(values.size, 0);
});

test("failed chunk or atomic-pointer writes retain the previous credentials", async () => {
  for (const failAfter of [1, 2, 3]) {
    const { storage, values, failAfter: fail } = fixture();
    await storage.setItem("session", "previous refresh token");
    const before = new Map(values);
    fail(failAfter);
    await assert.rejects(storage.setItem("session", "x".repeat(2200)), /keychain locked/);
    assert.equal(await storage.getItem("session"), "previous refresh token"); assert.deepEqual(values, before);
  }
});

test("concurrent SDK writes serialize and incomplete reads fail without erasing credentials", async () => {
  const { storage, values } = fixture();
  await Promise.all([storage.setItem("session", "first"), storage.setItem("session", "second")]);
  assert.equal(await storage.getItem("session"), "second");
  const chunk = [...values.keys()].find((key) => key.endsWith(".0"))!;
  values.delete(chunk);
  await assert.rejects(storage.getItem("session"), /incomplete/);
  assert.ok(values.size > 0, "metadata is retained for retry, not silently removed");
});

test("QA storage does not read another namespace", async () => {
  const values = new Map<string, string>();
  const adapter = { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); }, removeItem: async (key: string) => { values.delete(key); } };
  const legacy = createSecureSessionStorage(adapter, "bookmark-ai:production", () => "prod");
  const qa = createSecureSessionStorage(adapter, "bookmark-ai:supabase-qa", () => "qa");
  await legacy.setItem("session", "legacy"); assert.equal(await qa.getItem("session"), null);
  await qa.setItem("session", "qa"); await qa.removeItem("session"); assert.equal(await legacy.getItem("session"), "legacy");
});
