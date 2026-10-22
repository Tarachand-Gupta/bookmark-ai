import { beforeEach, expect, it, vi } from "vitest";
import type { OrganizationResponse } from "@bookmark-ai/types";
const h = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  origin: "https://app.test",
  accountId: "A",
  generation: 1,
  failStorage: false,
  tabs: vi.fn(),
  execute: vi.fn(),
  session: vi.fn(),
}));
vi.mock("wxt/browser", () => ({
  browser: {
    tabs: { create: h.tabs },
    storage: {
      local: {
        get: async (key: string | null) =>
          key === null
            ? Object.fromEntries(h.values)
            : { [key]: structuredClone(h.values.get(key)) },
        set: async (values: Record<string, unknown>) => {
          if (h.failStorage) throw new Error("Storage unavailable");
          for (const [key, value] of Object.entries(values))
            h.values.set(key, structuredClone(value));
        },
        remove: async (keys: string[]) => {
          for (const key of keys) h.values.delete(key);
        },
      },
    },
  },
}));
vi.mock("./supabase-oauth", () => ({ oauthGeneration: () => h.generation }));
vi.mock("./release-api", () => ({
  releaseSession: async (expected?: { accountId: string; origin: string }) => {
    h.session();
    if (expected && (expected.accountId !== h.accountId || expected.origin !== h.origin))
      throw new Error("Account changed");
    return {
      scope: { accountId: h.accountId, origin: h.origin },
      generation: h.generation,
      token: "test-only",
    };
  },
  sessionCurrent: async (session: {
    scope: { accountId: string; origin: string };
    generation: number;
  }) =>
    session.generation === h.generation &&
    session.scope.origin === h.origin &&
    session.scope.accountId === h.accountId,
  lookupPage: async () => undefined,
  readOrganization: async () =>
    ({
      capabilities: { organization: 1, handoff: 1 },
      folders: [],
      categories: [],
      tags: [],
    }) as unknown as OrganizationResponse,
  executeReleaseJob: (_session: unknown, job: unknown) => h.execute(job),
}));
import {
  clearReleasePrivateState,
  handleReleaseCommand,
  releaseJournal,
} from "./release-background";
import { pageKey, type ReleaseRequest } from "./release-state";
const page = { url: "https://page.test/one", title: "Frozen page" };
const scope = { accountId: "A", origin: "https://app.test" };
const draft = { text: "private question", context: { type: "page" as const, ...page } };
const handoff: ReleaseRequest = {
  kind: "handoff",
  input: { operationId: "handoff-operation", draft },
};
const saved = {
  handoff: { id: "opaque-id", expiresAt: new Date(Date.now() + 600000).toISOString() },
};
beforeEach(async () => {
  h.values.clear();
  h.origin = scope.origin;
  h.accountId = scope.accountId;
  h.generation++;
  h.failStorage = false;
  h.tabs.mockReset();
  h.execute.mockReset();
  h.session.mockReset();
  await clearReleasePrivateState();
  h.tabs.mockResolvedValue({ id: 42 });
  h.execute.mockResolvedValue(saved);
});
async function settle() {
  await vi.waitFor(async () =>
    expect(releaseJournal.isRunning(pageKey(scope, page.url))).toBe(false),
  );
}
it("persists a handoff before opening and passes only an opaque reference", async () => {
  await handleReleaseCommand({ action: "load", page });
  await handleReleaseCommand({ action: "draft", scope, page, field: "ask", value: draft });
  await handleReleaseCommand({ action: "submit", scope, page, request: handoff });
  await settle();
  expect(h.tabs).not.toHaveBeenCalled();
  await handleReleaseCommand({ action: "open", scope, page });
  expect(h.tabs).toHaveBeenCalledWith({ url: "https://app.test/app/library?handoff=opaque-id" });
  expect(JSON.stringify(h.tabs.mock.calls)).not.toContain(draft.text);
  expect((await handleReleaseCommand({ action: "state", scope, page })).state.ask).toEqual(draft);
});
it("keeps failed tab creation recoverable and retries the identical transfer", async () => {
  await handleReleaseCommand({ action: "load", page });
  await handleReleaseCommand({ action: "draft", scope, page, field: "ask", value: draft });
  await handleReleaseCommand({ action: "submit", scope, page, request: handoff });
  await settle();
  h.tabs.mockRejectedValueOnce(new Error("Tab creation failed"));
  await expect(handleReleaseCommand({ action: "open", scope, page })).rejects.toThrow(
    "Tab creation failed",
  );
  expect((await handleReleaseCommand({ action: "state", scope, page })).state.ask).toEqual(draft);
  await handleReleaseCommand({ action: "open", scope, page });
  await handleReleaseCommand({ action: "open", scope, page });
  expect(h.execute).toHaveBeenCalledOnce();
  expect(new Set(h.tabs.mock.calls.map((call) => call[0].url)).size).toBe(1);
});
it("does not open an unpersisted transfer or mutate after storage failure", async () => {
  await handleReleaseCommand({ action: "load", page });
  await expect(handleReleaseCommand({ action: "open", scope, page })).rejects.toThrow(
    "Save the handoff",
  );
  expect(h.tabs).not.toHaveBeenCalled();
  h.failStorage = true;
  await expect(
    handleReleaseCommand({ action: "submit", scope, page, request: handoff }),
  ).rejects.toThrow("Storage unavailable");
  expect(h.execute).not.toHaveBeenCalled();
});
it("keeps expired transfers reopenable and permits explicit recreation with a new operation", async () => {
  h.execute.mockResolvedValue({
    handoff: { id: "expired-opaque", expiresAt: new Date(0).toISOString() },
  });
  await handleReleaseCommand({ action: "submit", scope, page, request: handoff });
  await settle();
  await handleReleaseCommand({ action: "open", scope, page });
  expect(h.tabs).toHaveBeenCalledWith({ url: expect.stringContaining("expired-opaque") });
  const fresh = {
    ...handoff,
    input: { ...handoff.input, operationId: "recreated-operation" },
  } as ReleaseRequest;
  h.execute.mockResolvedValue(saved);
  await handleReleaseCommand({ action: "submit", scope, page, request: fresh });
  await settle();
  expect(h.execute).toHaveBeenCalledTimes(2);
  expect(
    (await handleReleaseCommand({ action: "state", scope, page })).state.job?.request.input
      .operationId,
  ).toBe("recreated-operation");
});
it("retains same-account drafts across expiry but rejects another account or origin", async () => {
  await handleReleaseCommand({ action: "load", page });
  await handleReleaseCommand({ action: "draft", scope, page, field: "ask", value: draft });
  h.generation++;
  await expect(handleReleaseCommand({ action: "state", scope, page })).rejects.toThrow(
    "Sign in again",
  );
  h.accountId = "B";
  expect((await handleReleaseCommand({ action: "load", page })).state.ask).toBeUndefined();
  await expect(handleReleaseCommand({ action: "open", scope, page })).rejects.toThrow(
    "Account changed",
  );
  h.accountId = "A";
  h.origin = "https://other.test";
  expect((await handleReleaseCommand({ action: "load", page })).state.ask).toBeUndefined();
  h.origin = scope.origin;
  expect((await handleReleaseCommand({ action: "load", page })).state.ask).toEqual(draft);
});
it("explicit logout purges private drafts and fences a late accepted callback", async () => {
  await handleReleaseCommand({ action: "load", page });
  await handleReleaseCommand({ action: "draft", scope, page, field: "ask", value: draft });
  let finish!: (result: typeof saved) => void;
  h.execute.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await handleReleaseCommand({ action: "submit", scope, page, request: handoff });
  await vi.waitFor(() => expect(h.execute).toHaveBeenCalledOnce());
  h.values.set("unrelated-setting", true);
  await clearReleasePrivateState();
  finish(saved);
  await settle();
  expect([...h.values.keys()]).toEqual(["unrelated-setting"]);
});
it("stores drafts without network access after verified admission", async () => {
  await handleReleaseCommand({ action: "load", page });
  h.session.mockClear();
  await handleReleaseCommand({ action: "draft", scope, page, field: "ask", value: draft });
  expect(h.session).not.toHaveBeenCalled();
});
it("explicit discard removes local handoff content and cannot resurrect it by opening", async () => {
  await handleReleaseCommand({ action: "submit", scope, page, request: handoff });
  await settle();
  await handleReleaseCommand({ action: "draft", scope, page, field: "ask" });
  await expect(handleReleaseCommand({ action: "open", scope, page })).rejects.toThrow(
    "Save the handoff",
  );
});
it("does not expose a frozen draft under a different page", async () => {
  await handleReleaseCommand({ action: "load", page });
  await handleReleaseCommand({ action: "draft", scope, page, field: "ask", value: draft });
  const otherPage = { url: "https://page.test/two", title: "New active tab" };
  expect(
    (await handleReleaseCommand({ action: "load", page: otherPage })).state.ask,
  ).toBeUndefined();
  await expect(
    handleReleaseCommand({ action: "submit", scope, page: otherPage, request: handoff }),
  ).rejects.toThrow("Page context changed");
});

it("keeps an acknowledged handoff receipt when another save later completes on the page", async () => {
  await handleReleaseCommand({ action: "submit", scope, page, request: handoff });
  await settle();
  h.execute.mockResolvedValue({ bookmark: { id: "saved-bookmark" } });
  await handleReleaseCommand({
    action: "submit",
    scope,
    page,
    request: {
      kind: "save",
      input: {
        operationId: "later-page-save",
        url: page.url,
        browser: "chrome",
        device: "desktop",
      },
    },
  });
  await settle();
  await handleReleaseCommand({ action: "open", scope, page });
  expect(h.tabs).toHaveBeenCalledWith({ url: "https://app.test/app/library?handoff=opaque-id" });
  expect(h.execute).toHaveBeenCalledTimes(2);
});
