import { describe, expect, it } from "vitest";
import {
  bookmarkImportProgress,
  bookmarkImportStorageKey,
  createBookmarkImportJob,
  parseBookmarkImportText,
  restoreBookmarkImportJob,
  retryFailedBookmarkImports,
  runBookmarkImportJob,
  type BookmarkImportApplyRequest,
  type BookmarkImportJob,
  type BookmarkImportResult,
} from "@bookmark-ai/types";

let uuidIndex = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++uuidIndex).padStart(12, "0")}`;
const job = (count = 2) =>
  createBookmarkImportJob(
    parseBookmarkImportText({
      action: "preview",
      source: "browser",
      items: Array.from({ length: count }, (_, i) => ({
        url: `https://example.com/${i}`,
        title: String(i),
      })),
    }),
    {
      id: uuid(),
      accountId: "account-a",
      origin: "https://api.test",
      browser: "chrome",
      device: "desktop",
      preserveFolders: true,
    },
  );
const receipt = (request: BookmarkImportApplyRequest): BookmarkImportResult => ({
  requestId: request.requestId,
  items: request.items.map((item) => ({
    key: item.key,
    url: item.url,
    status: "imported",
    bookmarkId: `b-${item.key}`,
  })),
  imported: request.items.length,
  existing: 0,
  failed: 0,
});

describe("durable account-scoped import jobs", () => {
  it("persists the pending request before sending and replays its exact UUID after interruption", async () => {
    let stored: BookmarkImportJob | null = null;
    const requests: BookmarkImportApplyRequest[] = [];
    const runner = {
      uuid,
      save: async (next: BookmarkImportJob) => {
        stored = structuredClone(next);
      },
      isCurrentAccount: () => true,
      shouldPause: () => false,
      changed: () => {},
      apply: async (request: BookmarkImportApplyRequest) => {
        expect(stored?.pending?.requestId).toBe(request.requestId);
        requests.push(request);
        throw new Error("Offline");
      },
    };
    const paused = await runBookmarkImportJob(job(), runner);
    expect(paused.status).toBe("paused");
    const resumed = await runBookmarkImportJob(paused, {
      ...runner,
      apply: async (request) => {
        requests.push(request);
        return receipt(request);
      },
    });
    expect(requests[1]).toEqual(requests[0]);
    expect(bookmarkImportProgress(resumed)).toMatchObject({ imported: 2, remaining: 0 });
  });
  it("never sends when persistence fails", async () => {
    let calls = 0;
    const result = await runBookmarkImportJob(job(), {
      uuid,
      save: async () => {
        throw new Error("Storage full");
      },
      isCurrentAccount: () => true,
      shouldPause: () => false,
      changed: () => {},
      apply: async (request) => {
        calls++;
        return receipt(request);
      },
    });
    expect(calls).toBe(0);
    expect(result.error).toBe("Storage full");
  });
  it("pauses at a batch boundary and only retries failed rows", async () => {
    let pause = false;
    const first = await runBookmarkImportJob(job(101), {
      uuid,
      save: async () => {},
      isCurrentAccount: () => true,
      shouldPause: () => pause,
      changed: () => {},
      apply: async (request) => {
        pause = true;
        const result = receipt(request);
        result.items[3].status = "failed";
        result.failed = 1;
        result.imported--;
        return result;
      },
    });
    expect(bookmarkImportProgress(first)).toMatchObject({ imported: 99, failed: 1, remaining: 1 });
    const retry = retryFailedBookmarkImports(first);
    let retried: string[] = [];
    await runBookmarkImportJob(retry, {
      uuid,
      save: async () => {},
      isCurrentAccount: () => true,
      shouldPause: () => false,
      changed: () => {},
      apply: async (request) => {
        retried = request.items.map((item) => item.key);
        return receipt(request);
      },
    });
    expect(retried).toEqual(["3", "100"]);
  });
  it("does not adopt a response or send another batch after an account switch", async () => {
    let current = true;
    let calls = 0;
    const changes: BookmarkImportJob[] = [];
    await runBookmarkImportJob(job(101), {
      uuid,
      save: async () => {},
      isCurrentAccount: () => current,
      shouldPause: () => false,
      changed: (next) => {
        changes.push(next);
      },
      apply: async (request) => {
        calls++;
        current = false;
        return receipt(request);
      },
    });
    expect(calls).toBe(1);
    expect(changes).toHaveLength(1);
    expect(changes[0].outcomes).toHaveLength(0);
  });
  it("rejects incomplete receipts and retains the pending batch", async () => {
    const result = await runBookmarkImportJob(job(), {
      uuid,
      save: async () => {},
      isCurrentAccount: () => true,
      shouldPause: () => false,
      changed: () => {},
      apply: async (request) => ({ ...receipt(request), items: [] }),
    });
    expect(result.pending).not.toBeNull();
    expect(result.error).toContain("incomplete receipt");
  });
  it("restores only matching account/origin and validates stored data", () => {
    const current = job();
    const raw = JSON.stringify({ ...current, status: "running" });
    expect(restoreBookmarkImportJob(raw, current.accountId, current.origin)?.status).toBe("paused");
    expect(restoreBookmarkImportJob(raw, "account-b", current.origin)).toBeNull();
    expect(restoreBookmarkImportJob(raw, current.accountId, "https://other.test")).toBeNull();
    expect(restoreBookmarkImportJob("{}", current.accountId, current.origin)).toBeNull();
    expect(
      restoreBookmarkImportJob(
        JSON.stringify({
          ...current,
          outcomes: [{ key: "unknown", url: "https://private.test", status: "imported" }],
        }),
        current.accountId,
        current.origin,
      ),
    ).toBeNull();
    expect(bookmarkImportStorageKey("a:b", "c")).not.toBe(bookmarkImportStorageKey("a", "b:c"));
  });
});
