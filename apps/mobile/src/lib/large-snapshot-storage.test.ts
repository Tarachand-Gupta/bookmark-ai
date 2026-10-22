import assert from "node:assert/strict";
import { test } from "node:test";
import { createLargeSnapshotStorage } from "./large-snapshot-storage";
import { createSnapshotCache } from "./snapshot-cache";
test("large durable selections survive a cold read and failed replacement; logout removes payload files", async () => {
  const disk = new Map<string,string>(), files = new Map<string,string>(); let id = 0, fail = false;
  const storage = createLargeSnapshotStorage({
    getItem: async key => disk.get(key) ?? null,
    setItem: async (key, value) => { if (fail) throw new Error("Disk full"); assert.ok(value.length < 1000); disk.set(key, value); },
    getAllKeys: async () => [...disk.keys()],
    multiRemove: async keys => { keys.forEach(key => disk.delete(key)); },
  }, { read: async name => files.get(name)!, write: async (name, value) => { files.set(name,value); }, remove: async name => { files.delete(name); } }, () => String(++id));
  const scope = { namespace: "qa", accountId: "a", origin: "local" }, cache = createSnapshotCache(storage);
  const snapshot = Array.from({ length: 10000 }, (_, n) => ({ id: String(n), fieldVersions: { title: n, folderId: n, tags: n }, title: "saved title ".repeat(20) }));
  await cache.write(scope, "jobs", snapshot);
  assert.equal(files.size, 1);
  assert.deepEqual((await createSnapshotCache(storage).read(scope, "jobs"))?.data, snapshot);
  fail = true;
  await assert.rejects(cache.write(scope, "jobs", [...snapshot, snapshot[0]]), /Disk full/);
  assert.equal(files.size, 1);
  assert.deepEqual((await createSnapshotCache(storage).read(scope, "jobs"))?.data, snapshot);
  fail = false;
  await cache.clear(scope);
  assert.equal(files.size, 0);
  assert.equal(disk.size, 0);
});
