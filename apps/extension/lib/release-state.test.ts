import { describe, expect, it, vi } from "vitest";
import type { Bookmark } from "@bookmark-ai/types";
import {
  DefinitiveReleaseError,
  ReleaseJournal,
  editChanges,
  rebaseEdit,
  editValues,
  pageKey,
  supportedPage,
  type ReleasePage,
  type ReleaseRequest,
} from "./release-state";
const page = { url: "https://example.test/page", title: "Page" };
const bookmark = {
  id: "bookmark",
  url: page.url,
  title: "Manual",
  tags: ["Research"],
  folderId: "folder",
  categoryId: "topic",
  readingState: "read",
  fieldVersions: { title: "v1" },
} as unknown as Bookmark;
const request: ReleaseRequest = {
  kind: "save",
  input: {
    operationId: "stable-save-identity",
    url: page.url,
    browser: "chrome",
    device: "desktop",
  },
};
function harness() {
  const values = new Map<string, ReleasePage>();
  const write = vi.fn(async (key: string, value: ReleasePage) => {
    values.set(key, structuredClone(value));
  });
  const io = { read: async (key: string) => structuredClone(values.get(key)), write };
  return { values, write, io, journal: new ReleaseJournal(io) };
}
it("requires durable admission before any accepted network request", async () => {
  const { journal, write } = harness();
  write.mockRejectedValue(new Error("storage full"));
  const execute = vi.fn();
  await expect(journal.accept("key", page, request, () => true)).rejects.toThrow("storage full");
  await journal.run("key", () => true, execute);
  expect(execute).not.toHaveBeenCalled();
});
it("completes after popup teardown and restores the receipt in a new owner", async () => {
  const { journal, io } = harness();
  await journal.accept("key", page, request, () => true);
  await journal.run(
    "key",
    () => true,
    async () => ({ bookmark }),
  );
  const reopened = new ReleaseJournal(io);
  expect((await reopened.read("key"))?.job?.status).toBe("succeeded");
  expect((await reopened.read("key"))?.bookmark?.id).toBe(bookmark.id);
});
it("restores an unsent edit independently of network status", async () => {
  const { journal, io } = harness();
  const edit = { base: bookmark, values: { ...editValues(bookmark), title: "Unsent" } };
  await journal.update(
    "key",
    () => true,
    () => ({ page, edit }),
  );
  const execute = vi.fn();
  await new ReleaseJournal(io).run("key", () => true, execute);
  expect(execute).not.toHaveBeenCalled();
  expect((await new ReleaseJournal(io).read("key"))?.edit).toEqual(edit);
});
it("replays lost-response and worker-restart outcomes with the identical operation and payload", async () => {
  const { journal, io } = harness();
  await journal.accept("key", page, request, () => true);
  await journal.run(
    "key",
    () => true,
    async () => {
      throw new Error("response lost");
    },
  );
  expect((await journal.read("key"))?.job?.status).toBe("unknown");
  await expect(
    journal.accept(
      "key",
      page,
      { ...request, input: { ...request.input, operationId: "different-id" } } as ReleaseRequest,
      () => true,
    ),
  ).rejects.toThrow("previous request");
  const execute = vi.fn(async () => ({ bookmark }));
  await new ReleaseJournal(io).run("key", () => true, execute);
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ request }));
  expect((await journal.read("key"))?.job?.request).toEqual(request);
});
it("deduplicates concurrent reconciliation", async () => {
  const { journal } = harness();
  await journal.accept("key", page, request, () => true);
  let finish!: () => void;
  const execute = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { bookmark };
  });
  const first = journal.run("key", () => true, execute);
  const second = journal.run("key", () => true, execute);
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
  finish();
  await Promise.all([first, second]);
  expect(execute).toHaveBeenCalledOnce();
});
it("rejects a late old-account completion and a queued old-account draft write", async () => {
  const { journal } = harness();
  let current = true;
  await journal.accept("key", page, request, () => current);
  await journal.run(
    "key",
    () => current,
    async () => {
      current = false;
      return { bookmark };
    },
  );
  expect((await journal.read("key"))?.bookmark).toBeUndefined();
  await expect(
    journal.update(
      "key",
      () => current,
      () => ({ page }),
    ),
  ).rejects.toThrow("Account changed");
});
it("retains unknown status when the server succeeded but receipt storage failed", async () => {
  const { journal, write } = harness();
  await journal.accept("key", page, request, () => true);
  await journal.run(
    "key",
    () => true,
    async () => {
      write.mockRejectedValueOnce(new Error("quota"));
      return { bookmark };
    },
  );
  expect((await journal.read("key"))?.job?.status).toBe("unknown");
  expect((await journal.read("key"))?.job?.request).toEqual(request);
});
it("separates a successful link from a failed organization update", async () => {
  const { journal } = harness();
  await journal.update(
    "key",
    () => true,
    () => ({ page, bookmark }),
  );
  await journal.accept(
    "key",
    page,
    {
      kind: "edit",
      bookmarkId: bookmark.id,
      input: { operationId: "atomic-edit-id", changes: { folderId: "missing-folder" } },
    },
    () => true,
  );
  await journal.run(
    "key",
    () => true,
    async () => {
      throw new DefinitiveReleaseError("Folder no longer exists");
    },
  );
  const state = await journal.read("key");
  expect(state?.bookmark).toEqual(bookmark);
  expect(state?.job?.status).toBe("failed");
});
it("does not clear a newer edit when an accepted old edit finishes", async () => {
  const { journal } = harness();
  const values = { ...editValues(bookmark), title: "Older" };
  await journal.update(
    "key",
    () => true,
    () => ({ page, edit: { base: bookmark, values } }),
  );
  await journal.accept(
    "key",
    page,
    {
      kind: "edit",
      bookmarkId: bookmark.id,
      input: { operationId: "atomic-edit-id", changes: { title: "Older" } },
    },
    () => true,
  );
  await journal.run(
    "key",
    () => true,
    async () => {
      await journal.update(
        "key",
        () => true,
        (state) => ({ ...state!, edit: { base: bookmark, values: { ...values, title: "Newer" } } }),
      );
      return { bookmark: { ...bookmark, title: "Older" } };
    },
  );
  expect((await journal.read("key"))?.edit?.values.title).toBe("Newer");
});
it("only patches changed fields and never adds legacy tags", () => {
  expect(
    editChanges({
      base: bookmark,
      values: { ...editValues(bookmark), readingState: "not_on_list" },
    }),
  ).toEqual({ readingState: "not_on_list" });
});
it("isolates account, exact origin and page with unambiguous keys", () => {
  const scope = { accountId: "one", origin: "https://example.test" };
  expect(
    new Set([
      pageKey(scope, page.url),
      pageKey({ ...scope, accountId: "two" }, page.url),
      pageKey({ ...scope, origin: "https://www.example.test" }, page.url),
      pageKey(scope, page.url + "?a=1"),
    ]).size,
  ).toBe(4);
});
describe("page capabilities", () => {
  it.each([
    "chrome://settings",
    "about:blank",
    "file:///private",
    "javascript:alert(1)",
    "https://name:password@example.test",
  ])("rejects %s", (url) => expect(supportedPage(url)).toBe(false));
  it.each(["http://localhost:3000/page", "https://example.test/private"])(
    "admits URL capture without claiming page access: %s",
    (url) => expect(supportedPage(url)).toBe(true),
  );
});

it("conflict resolution preserves newer fields the user never changed", () => {
  const draft = { base: bookmark, values: { ...editValues(bookmark), title: "My correction" } };
  const current = {
    ...bookmark,
    title: "Other correction",
    folderId: "newer-folder",
    tags: ["Newer tag"],
    fieldVersions: { title: "v2", folderId: "v2" },
  };
  const rebased = rebaseEdit(draft, current);
  expect(rebased.values.folderId).toBe("newer-folder");
  expect(rebased.values.tags).toEqual(["Newer tag"]);
  expect(editChanges(rebased)).toEqual({ title: "My correction" });
});
