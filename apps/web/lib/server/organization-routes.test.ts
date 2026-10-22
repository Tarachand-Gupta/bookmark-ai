import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { ensureSchema, insertBookmark, getBookmark, type Db } from "@bookmark-ai/db";
import type { NextRequest } from "next/server";
const state = vi.hoisted(() => ({
  headers: new Headers(),
  identity: null as any,
  tenants: new Map<string, any>(),
  after: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => state.headers }));
vi.mock("next/server", async (original) => ({ ...(await original<any>()), after: state.after }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(), clerkClient: vi.fn() }));
vi.mock("./supabase-auth", () => ({
  getWebAuth: async () => state.identity,
  isSupabaseAuth: () => true,
  AuthUnavailableError: class extends Error {},
  MfaRequiredError: class extends Error {},
}));
vi.mock("./rate-limit", () => ({ checkRateLimit: () => true }));
vi.mock("./context", () => ({
  getGemini: () => null,
  isMultiTenant: () => false,
  getTenantDb: async (id: string) => ({ db: state.tenants.get(id), ready: Promise.resolve() }),
  getApiContext: () => {
    throw new Error("No open context in protected route tests");
  },
  getMasterContext: () => null,
  MultiTenantConfigError: class extends Error {},
  TenantNotProvisionedError: class extends Error {},
}));
vi.mock("./observability/request-logging", () => ({
  withRequestLogging: (_path: string, _method: string, handler: unknown) => handler,
}));
import { GET as organizationGet } from "@/app/api/organization/route";
import { POST as operationPost } from "@/app/api/organization/operations/route";
import { GET as operationGet } from "@/app/api/organization/operations/[id]/route";
import { POST as selectionPost } from "@/app/api/organization/selections/route";
import { PATCH as bookmarkPatch } from "@/app/api/bookmarks/[id]/route";
import { GET as bookmarksGet } from "@/app/api/bookmarks/route";
import { POST as handoffPost } from "@/app/api/composer/handoffs/route";
import { POST as handoffClaim } from "@/app/api/composer/handoffs/[id]/claim/route";
import { GET as meGet } from "@/app/api/me/route";
let dir: string, db: Db;
function request(method: string, path: string, body?: unknown) {
  const url = new URL(path, "https://test.invalid");
  state.headers = new Headers({
    authorization: "Bearer fixture-token",
    "x-bkm-route": `${method} ${url.pathname}`,
  });
  return new Request(url, {
    method,
    headers: state.headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as NextRequest;
}
function identity(accountId = "account-a", clientId?: string) {
  return {
    userId: accountId,
    sessionId: "fixture-session",
    clientId,
    user: {
      id: `provider-${accountId}`,
      email: "fixture@example.invalid",
      user_metadata: { name: "Fixture" },
    },
  };
}
beforeEach(async () => {
  vi.stubEnv("SUPABASE_EXTENSION_CLIENT_IDS", "trusted-extension");
  vi.stubEnv("AUTH_ALLOWED_USER_IDS", "");
  state.after.mockReset();
  dir = mkdtempSync(join(tmpdir(), "bmai-route-"));
  state.tenants.clear();
  for (const id of ["account-a", "account-b"]) {
    const tenant = createClient({ url: `file:${join(dir, `${id}.db`)}` });
    await ensureSchema(tenant);
    state.tenants.set(id, tenant);
  }
  db = state.tenants.get("account-a");
  await insertBookmark(db, {
    id: "owned-bookmark",
    url: "https://example.invalid/owned",
    domain: "example.invalid",
    title: "Owned",
    description: null,
    og: {},
    source: { browser: "other", device: "other", savedAt: new Date().toISOString() },
    category: "Research",
    tags: [],
    createdAt: new Date().toISOString(),
  });
  state.identity = identity();
});
afterEach(() => {
  for (const tenant of state.tenants.values()) tenant.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
describe("protected organization route flows", () => {
  it("returns 401 before touching organization when signed out", async () => {
    state.identity = null;
    request("GET", "/api/organization");
    expect((await organizationGet()).status).toBe(401);
  });
  it("lets trusted extension edit and reconcile, denies general bookmark listing and account controls", async () => {
    state.identity = identity("account-a", "trusted-extension");
    const blocked = await bookmarksGet(request("GET", "/api/bookmarks"));
    expect(blocked.status).toBe(403);
    const lookup = await bookmarksGet(
      request("GET", "/api/bookmarks?url=https%3A%2F%2Fexample.invalid%2Fowned"),
    );
    expect(lookup.status).toBe(200);
    expect((await lookup.json()).bookmarks).toHaveLength(1);
    const edit = await bookmarkPatch(
      request("PATCH", "/api/bookmarks/owned-bookmark", {
        operationId: "extension-edit-01",
        changes: { title: "Edited" },
      }),
      { params: Promise.resolve({ id: "owned-bookmark" }) },
    );
    expect(edit.status).toBe(200);
    expect((await edit.json()).operation.status).toBe("completed");
    const result = await operationGet(
      request("GET", "/api/organization/operations/extension-edit-01"),
      { params: Promise.resolve({ id: "extension-edit-01" }) },
    );
    expect(result.status).toBe(200);
    request("DELETE", "/api/account");
    expect((await organizationGet()).status).toBe(403);
  });
  it("maps tenant ownership for edits, selections, receipt reads and accountId", async () => {
    const saved = await operationPost(
      request("POST", "/api/organization/operations", {
        operationId: "tenant-operation-01",
        action: "bookmarks.update",
        bookmarkIds: ["owned-bookmark"],
        changes: { categoryId: null },
      }),
    );
    expect(saved.status).toBe(200);
    state.identity = identity("account-b");
    const foreign = await bookmarkPatch(
      request("PATCH", "/api/bookmarks/owned-bookmark", {
        operationId: "foreign-operation-01",
        changes: { title: "Wrong" },
      }),
      { params: Promise.resolve({ id: "owned-bookmark" }) },
    );
    expect((await foreign.json()).operation.status).toBe("failed");
    const receipt = await operationGet(
      request("GET", "/api/organization/operations/tenant-operation-01"),
      { params: Promise.resolve({ id: "tenant-operation-01" }) },
    );
    expect(receipt.status).toBe(404);
    const selection = await selectionPost(
      request("POST", "/api/organization/selections", { query: {} }),
    );
    expect((await selection.json()).selection.count).toBe(0);
    request("GET", "/api/me");
    expect(await (await meGet()).json()).toMatchObject({
      accountId: "account-b",
      userId: "account-b",
    });
    expect((await getBookmark(db, "owned-bookmark"))?.title).toBe("Owned");
  });
  it("claims extension handoff only for the same human account with frozen draft", async () => {
    state.identity = identity("account-a", "trusted-extension");
    request("GET", "/api/me");
    expect(await (await meGet()).json()).toMatchObject({ accountId: "account-a" });
    const created = await handoffPost(
      request("POST", "/api/composer/handoffs", {
        operationId: "handoff-route-01",
        draft: {
          text: "Frozen question",
          context: { type: "bookmarks", bookmarkIds: ["owned-bookmark"] },
        },
      }),
    );
    const { handoff } = await created.json();
    state.identity = identity("account-b");
    const foreign = await handoffClaim(
      request("POST", `/api/composer/handoffs/${handoff.id}/claim`),
      { params: Promise.resolve({ id: handoff.id }) },
    );
    expect(foreign.status).toBe(404);
    state.identity = identity("account-a");
    const claimed = await handoffClaim(
      request("POST", `/api/composer/handoffs/${handoff.id}/claim`),
      { params: Promise.resolve({ id: handoff.id }) },
    );
    expect(await claimed.json()).toMatchObject({
      handoff: { id: handoff.id, draft: { text: "Frozen question" } },
    });
    expect((await db.execute("SELECT count(*) n FROM chat_messages")).rows[0]?.n).toBe(0);
  });
  it("rejects malformed changes and does not silently narrow large selection batches", async () => {
    const bad = await bookmarkPatch(
      request("PATCH", "/api/bookmarks/owned-bookmark", {
        operationId: "invalid-edit-01",
        changes: { url: "https://other.invalid" },
      }),
      { params: Promise.resolve({ id: "owned-bookmark" }) },
    );
    expect(bad.status).toBe(400);
    const tooMany = await operationPost(
      request("POST", "/api/organization/operations", {
        operationId: "oversized-batch-01",
        action: "bookmarks.update",
        bookmarkIds: Array.from({ length: 501 }, (_, i) => `id-${i}`),
        changes: { categoryId: null },
      }),
    );
    expect(tooMany.status).toBe(422);
    expect((await tooMany.json()).code).toBe("selection-too-large");
  });
});
