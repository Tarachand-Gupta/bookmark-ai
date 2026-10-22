import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdmissionMarker } from "./admission-marker";

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => resolve = r); return { promise, resolve }; }
test("delayed old admission, logout, and new verified account retain only the new marker", async () => {
  let disk: string | null = null, identity = "a", writes = 0;
  const started = deferred(), finish = deferred();
  const marker = createAdmissionMarker<{ id: string }>({
    getItem: async () => disk,
    setItem: async (_, value) => { if (++writes === 1) { started.resolve(); await finish.promise; } disk = value; },
    removeItem: async () => { disk = null; },
  }, "marker");
  const old = marker.write({ id: "a" }, marker.epoch(), () => identity === "a");
  await started.promise;
  const clear = marker.clear();
  identity = "b";
  const next = marker.write({ id: "b" }, marker.epoch(), () => identity === "b");
  finish.resolve();
  assert.equal(await old, false);
  await clear;
  assert.equal(await next, true);
  assert.deepEqual(await marker.read(), { id: "b" });
  assert.deepEqual(JSON.parse(disk!), { id: "b" });
});
test("stale protected proof and delayed disk restore cannot re-admit after logout", async () => {
  const started = deferred(), finish = deferred();
  let disk: string | null = JSON.stringify({ id: "a" });
  const marker = createAdmissionMarker<{ id: string }>({
    getItem: async () => { const captured = disk; started.resolve(); await finish.promise; return captured; },
    setItem: async (_, value) => { disk = value; },
    removeItem: async () => { disk = null; },
  }, "marker");
  const epoch = marker.epoch(), read = marker.read();
  await started.promise;
  const clear = marker.clear();
  const late = marker.write({ id: "a" }, epoch, () => true);
  finish.resolve();
  assert.equal(await read, null);
  await clear;
  assert.equal(await late, false);
  assert.equal(disk, null);
});
