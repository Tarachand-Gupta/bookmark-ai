import { beforeEach, expect, it, vi } from "vitest";
import type { Bookmark } from "@bookmark-ai/types";
const h = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  generation: 1,
  accountId: "A",
  fence: 0,
  failStorage: false,
  lookup: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("wxt/browser", () => ({
  browser: { storage: { local: { get: async () => Object.fromEntries(h.values) } } },
}));
vi.mock("./detect", () => ({ detectSource: () => ({ browser: "chrome", device: "desktop" }) }));
vi.mock("./supabase-oauth", () => ({ oauthGeneration: () => h.generation }));
vi.mock("./release-api", () => ({
  releaseSession: async () => ({
    scope: { accountId: h.accountId, origin: "https://app.test" },
    generation: h.generation,
  }),
  sessionCurrent: async (session: { generation: number }) => session.generation === h.generation,
  lookupPage: h.lookup,
  executeReleaseJob: (_session: unknown, job: unknown) => h.execute(job),
}));
vi.mock("./release-background", async () => {
  const { ReleaseJournal } = await import("./release-state");
  return {
    releaseFence: () => h.fence,
    releaseJournal: new ReleaseJournal({
      read: async (key: string) => structuredClone(h.values.get(key)) as never,
      write: async (key: string, value: unknown) => {
        if (h.failStorage) throw new Error("Storage failed");
        h.values.set(key, structuredClone(value));
      },
    }),
  };
});
import { drainReadingEntries, mirrorReadingEntry } from "./release-reading-list";
const entry = { url: "https://page.test/", title: "Browser title", hasBeenRead: false };
const bookmark = {
  id: "existing",
  url: entry.url,
  title: "Manual title",
  folderId: "folder",
  categoryId: "topic",
  tags: ["Manual tag"],
  readingState: "unread",
  fieldVersions: { readingState: "v7" },
} as unknown as Bookmark;
beforeEach(() => {
  h.values.clear();
  h.generation++;
  h.fence++;
  h.accountId = "A";
  h.failStorage = false;
  h.lookup.mockReset();
  h.execute.mockReset();
  h.lookup.mockResolvedValue(bookmark);
  h.execute.mockResolvedValue({ bookmark });
});
it("removal patches only membership and preserves bookmark identity and all organization", async () => {
  await mirrorReadingEntry(entry, true);
  expect(h.execute).toHaveBeenCalledOnce();
  expect(h.execute.mock.calls[0]?.[0].request).toMatchObject({
    kind: "edit",
    bookmarkId: "existing",
    input: { changes: { readingState: "not_on_list" }, expected: { readingState: "v7" } },
  });
  expect(Object.keys(h.execute.mock.calls[0]?.[0].request.input.changes)).toEqual(["readingState"]);
});
it.each([false, true])(
  "maps add/read update to canonical state without reintroducing legacy tags (%s)",
  async (hasBeenRead) => {
    await mirrorReadingEntry({ ...entry, hasBeenRead });
    expect(h.execute.mock.calls[0]?.[0].request.input.changes).toEqual({
      readingState: hasBeenRead ? "read" : "unread",
    });
    expect(h.execute.mock.calls[0]?.[0].request.kind).toBe("edit");
  },
);
it("never saves or deletes an absent bookmark on removal", async () => {
  h.lookup.mockResolvedValue(undefined);
  await mirrorReadingEntry(entry, true);
  expect(h.execute).not.toHaveBeenCalled();
});
it("saves a new reading entry then independently enrolls it without reading/article tags", async () => {
  h.lookup.mockResolvedValue(undefined);
  await mirrorReadingEntry(entry);
  expect(h.execute).toHaveBeenCalledTimes(2);
  const save = h.execute.mock.calls[0]?.[0].request;
  expect(save.kind).toBe("save");
  expect(save.input.tags).toBeUndefined();
  expect(h.execute.mock.calls[1]?.[0].request.input.changes).toEqual({ readingState: "unread" });
});
it("does not dispatch anything if durable event storage fails", async () => {
  h.failStorage = true;
  await expect(mirrorReadingEntry(entry)).rejects.toThrow("Storage failed");
  expect(h.execute).not.toHaveBeenCalled();
});
it("recovers an unknown membership update with the same operation ID and versions", async () => {
  h.execute.mockRejectedValueOnce(new Error("lost response"));
  await mirrorReadingEntry(entry, true);
  const request = h.execute.mock.calls[0]?.[0].request;
  await drainReadingEntries();
  expect(h.execute.mock.calls[1]?.[0].request).toEqual(request);
});
it("never drains another account's stored reading event", async () => {
  h.execute.mockRejectedValueOnce(new Error("offline"));
  await mirrorReadingEntry(entry);
  h.accountId = "B";
  h.generation++;
  await drainReadingEntries();
  expect(h.execute).toHaveBeenCalledOnce();
});
it("a sign-out during an accepted read-state request cannot restore private data", async () => {
  h.execute.mockImplementationOnce(async () => {
    h.fence++;
    h.generation++;
    h.values.clear();
    return { bookmark };
  });
  await mirrorReadingEntry(entry);
  expect(h.values.size).toBe(0);
});
it("keeps native read updates ordered for one account", async () => {
  await Promise.all([
    mirrorReadingEntry(entry),
    mirrorReadingEntry({ ...entry, hasBeenRead: true }),
    mirrorReadingEntry(entry, true),
  ]);
  expect(h.execute.mock.calls.map((call) => call[0].request.input.changes.readingState)).toEqual([
    "unread",
    "read",
    "not_on_list",
  ]);
});
it("reconciles a failed older lookup before applying a newer membership change", async () => {
  h.lookup.mockRejectedValueOnce(new Error("offline lookup"));
  await mirrorReadingEntry(entry);
  expect(h.execute).not.toHaveBeenCalled();
  await mirrorReadingEntry(entry, true);
  expect(h.execute.mock.calls.map((call) => call[0].request.input.changes.readingState)).toEqual([
    "unread",
    "not_on_list",
  ]);
  await drainReadingEntries();
  expect(h.execute).toHaveBeenCalledTimes(2);
});
it("queues newer events behind an unresolved request and replays its original identity first", async () => {
  h.execute.mockRejectedValue(new Error("response lost"));
  await mirrorReadingEntry(entry);
  const original = h.execute.mock.calls[0]?.[0].request;
  await mirrorReadingEntry(entry, true);
  expect(h.execute.mock.calls.map((call) => call[0].request)).toEqual([original, original]);
  h.execute.mockResolvedValue({ bookmark });
  await drainReadingEntries();
  expect(h.execute.mock.calls[2]?.[0].request).toEqual(original);
  expect(h.execute.mock.calls[3]?.[0].request.input.changes).toEqual({
    readingState: "not_on_list",
  });
});
it("does not replay an absent-bookmark removal after a later addition", async () => {
  h.lookup.mockResolvedValueOnce(undefined);
  await mirrorReadingEntry(entry, true);
  await mirrorReadingEntry(entry);
  await drainReadingEntries();
  expect(h.execute).toHaveBeenCalledOnce();
  expect(h.execute.mock.calls[0]?.[0].request.input.changes).toEqual({ readingState: "unread" });
});
