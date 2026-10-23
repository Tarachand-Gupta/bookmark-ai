import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { ensureSchema, insertBookmark, createSession, type Db } from "@bookmark-ai/db";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatContext } from "@bookmark-ai/types";

const state = vi.hoisted(() => ({
  db: null as unknown as Db,
  call: null as any,
  response: null as Response | null,
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("./api-context", () => ({
  getRequestApiContext: async () =>
    state.response
      ? { response: state.response }
      : {
          db: state.db,
          userId: "tenant-a",
          sessionId: "session-a",
          ready: Promise.resolve(),
          gemini: null,
        },
  enforceQuota: async () => null,
}));
vi.mock("./ai-model", () => ({
  resolveChatCandidates: async () => ({}),
  pickChatModel: () => ({
    ok: true,
    resolved: { model: {}, usesServerKey: false, source: "own", label: "test" },
  }),
}));
vi.mock("./observability/request-logging", () => ({
  withRequestLogging: (_a: string, _b: string, fn: unknown) => fn,
}));
vi.mock("./observability/server-logs", () => ({ serverLogger: { log: vi.fn() } }));
vi.mock("./observability/config", () => ({ isSurfaceEnabled: async () => false }));
vi.mock("./observability/flush", () => ({ flushObservability: vi.fn() }));
vi.mock("./ai-limit", () => ({ getFreeAiWeeklyLimit: async () => 2000000 }));
vi.mock("./live-token", () => ({
  resolveLiveBaseUrl: async () => "https://live.example.invalid",
  mintLiveSessionToken: async () => ({ token: "tenant-a-token" }),
}));
vi.mock("@/app/api/product-analytics", () => ({
  trackChatOutcome: () => ({ complete: vi.fn(), fail: vi.fn() }),
}));
vi.mock("@langfuse/tracing", () => ({
  propagateAttributes: (_attributes: unknown, fn: () => unknown) => fn(),
}));
vi.mock("ai", async (original) => ({
  ...(await original<any>()),
  streamText: (options: any) => {
    state.call = options;
    return {
      toUIMessageStream: () =>
        new ReadableStream({
          start(c) {
            c.close();
          },
        }),
      finishReason: Promise.resolve("stop"),
    };
  },
}));
import { POST } from "@/app/api/chat/route";
import { attachedContextPage, buildAttachedContextPrompt } from "./chat-context";

let dir: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "chat-context-"));
  state.db = createClient({ url: `file:${join(dir, "a.db")}` });
  await ensureSchema(state.db);
  state.response = null;
  state.call = null;
  for (const [id, title] of [
    ["attached", "A gardening guide"],
    ["outside", "AI content generation tools"],
  ]) {
    await insertBookmark(state.db, {
      id,
      title,
      url: `https://example.invalid/${id}`,
      domain: "example.invalid",
      description: null,
      og: {},
      category: "Research",
      tags: [],
      source: { browser: "chrome", device: "desktop", savedAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    });
  }
  await createSession(state.db, {
    id: "session",
    name: "AI research",
    tabs: [{ url: "https://example.invalid/ai", title: "AI generation" }],
    browser: "chrome",
    device: "desktop",
    os: "macOS",
    savedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ enabled: false, devices: [] })),
  );
});
afterEach(async () => {
  // Let the route's off-critical-path user persistence finish before closing SQLite.
  await vi.waitFor(async () =>
    expect(
      Number((await state.db.execute("SELECT count(*) AS n FROM chat_messages")).rows[0].n),
    ).toBeGreaterThanOrEqual(state.call ? 1 : 0),
  );
  state.db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

async function call(context?: ChatContext) {
  const response = await POST(
    new Request("https://example.invalid/api/chat", {
      method: "POST",
      body: JSON.stringify({
        message: {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text: "Find AI content generation tools" }],
        },
        ...(context ? { context } : {}),
      }),
    }),
  );
  expect(response.status).toBe(200);
  await response.text();
  return state.call;
}

describe("chat retrieval with additional context", () => {
  for (const [name, context] of [
    ["no context", undefined],
    ["library", { type: "library" }],
    ["selected bookmarks", { type: "bookmarks", bookmarkIds: ["attached"] }],
    ["unavailable bookmarks", { type: "bookmarks", bookmarkIds: ["other-tenant-or-deleted"] }],
  ] as [string, ChatContext | undefined][]) {
    it(`keeps full tenant retrieval available with ${name}`, async () => {
      const { tools, system } = await call(context);
      const search = await tools.searchBookmarks.execute({
        query: "AI",
        mode: "text",
        limit: 20,
        offset: 0,
      });
      expect(search.results.map((b: any) => b.id)).toContain("outside");
      const sql = await tools.queryDatabase.execute({
        sql: "SELECT count(*) AS n FROM bookmarks",
        limit: 20,
        offset: 0,
      });
      expect(sql.rows[0][0]).toBe(2);
      expect(
        (await tools.listSessions.execute({ query: "AI", limit: 20, offset: 0 })).sessions,
      ).toHaveLength(1);
      expect(await tools.listLiveTabs.execute({ limit: 20, offset: 0 })).toMatchObject({
        enabled: false,
      });
      const attached = await tools.listContext.execute({ limit: 20, offset: 0 });
      expect(attached.libraryAvailable).toBe(true);
      expect(attached.sources.some((s: any) => s.id === "other-tenant-or-deleted")).toBe(false);
      expect(system).not.toContain("retrieval is constrained");
      expect(system).toContain("Attachments add focus");
      expect(
        await tools.queryDatabase.execute({ sql: "DELETE FROM bookmarks", limit: 20, offset: 0 }),
      ).toHaveProperty("error");
      const url = await tools.fetchUrl.execute({ url: "http://127.0.0.1/private" });
      expect(url).toHaveProperty("error");
      expect(JSON.stringify(url)).not.toContain("outside the selected context");
    });
  }
  it("leaves auth denial ahead of model and database access", async () => {
    state.response = Response.json({ error: "unauthorized" }, { status: 401 });
    expect(
      (await POST(new Request("https://example.invalid/api/chat", { method: "POST" }))).status,
    ).toBe(401);
    expect(state.call).toBeNull();
  });
  it("pages attached sources without representing them as the whole library", () => {
    const context = {
      context: { type: "bookmarks" as const, bookmarkIds: ["a", "b"] },
      bookmarkIds: ["a", "b"],
      sources: [
        { id: "a", title: "A", url: "https://a.invalid" },
        { id: "b", title: "B", url: "https://b.invalid" },
      ],
      unavailable: [],
    };
    expect(attachedContextPage(context, 0, 1)).toMatchObject({
      libraryAvailable: true,
      page: { total: 2, hasMore: true, nextOffset: 1 },
    });
    expect(attachedContextPage(undefined).message).toContain("does not mean the library is empty");
    expect(buildAttachedContextPrompt({ ...context, context: { type: "library" } })).toBe("");
  });
});
