import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const state = vi.hoisted(() => ({
  context: vi.fn(),
  quota: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
  receipt: vi.fn(),
  after: vi.fn(),
  embed: vi.fn(),
}));
vi.mock("next/server", async (original) => ({ ...(await original<any>()), after: state.after }));
vi.mock("@/lib/server/api-context", () => ({
  getRequestApiContext: state.context,
  enforceQuota: state.quota,
}));
vi.mock("@/lib/server/observability/request-logging", () => ({
  withRequestLogging: (_path: string, _method: string, handler: unknown) => handler,
}));
vi.mock("@/lib/server/observability/flush", () => ({ flushObservability: vi.fn() }));
vi.mock("@bookmark-ai/engine", () => ({
  applyBookmarkImportBatch: state.apply,
  previewBookmarkImport: state.preview,
  getBookmarkImportReceipt: state.receipt,
  embedBookmarkById: state.embed,
  BookmarkImportConflictError: class extends Error {},
}));
import { GET, POST } from "@/app/api/import/bookmarks/route";
import { BookmarkImportConflictError } from "@bookmark-ai/engine";
const requestId = "00000000-0000-4000-8000-000000000001";
const input = {
  action: "apply",
  requestId,
  items: [{ key: "0", url: "https://fixture.test", title: "Fixture", folderPath: ["Research"] }],
  browser: "chrome",
  device: "desktop",
  preserveFolders: true,
};
function request(body?: unknown) {
  return new NextRequest("https://fixture.test/api/import/bookmarks", {
    method: body ? "POST" : "GET",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  state.context.mockResolvedValue({
    db: {},
    userId: "account-a",
    gemini: null,
    ready: Promise.resolve(),
  });
  state.quota.mockResolvedValue(null);
  state.receipt.mockResolvedValue(null);
  state.apply.mockResolvedValue({ requestId, items: [], imported: 0, existing: 0, failed: 0 });
});
describe("bookmark import API boundaries", () => {
  it("does not read source or database before authentication", async () => {
    state.context.mockResolvedValue({
      response: NextResponse.json({ error: "Sign in" }, { status: 401 }),
    });
    expect((await GET(request())).status).toBe(401);
    expect((await POST(request(input))).status).toBe(401);
    expect(state.apply).not.toHaveBeenCalled();
    expect(state.preview).not.toHaveBeenCalled();
  });
  it("previews without charging or applying, and reports safe capabilities", async () => {
    state.preview.mockResolvedValue({ items: [] });
    expect((await GET(request())).status).toBe(200);
    expect(
      (await POST(request({ action: "preview", source: "text", content: "https://fixture.test" })))
        .status,
    ).toBe(200);
    expect(state.preview).toHaveBeenCalledOnce();
    expect(state.quota).not.toHaveBeenCalled();
    expect(state.apply).not.toHaveBeenCalled();
  });
  it("honors quota before a new batch but reconciles existing receipts", async () => {
    state.quota.mockResolvedValue(NextResponse.json({ error: "Limit" }, { status: 429 }));
    expect((await POST(request(input))).status).toBe(429);
    expect(state.apply).not.toHaveBeenCalled();
    state.quota.mockClear();
    state.receipt.mockResolvedValue({ requestId });
    expect((await POST(request(input))).status).toBe(200);
    expect(state.quota).not.toHaveBeenCalled();
    expect(state.apply).toHaveBeenCalledOnce();
  });
  it("returns a conflict for reused receipt IDs with changed payloads", async () => {
    state.receipt.mockResolvedValue({ requestId });
    state.apply.mockRejectedValueOnce(new BookmarkImportConflictError());
    expect((await POST(request(input))).status).toBe(409);
  });
  it("bounds post-response indexing to three new rows without replaying it", async () => {
    state.context.mockResolvedValue({
      db: {},
      userId: "account-a",
      gemini: {},
      ready: Promise.resolve(),
    });
    state.apply.mockResolvedValue({
      requestId,
      items: Array.from({ length: 5 }, (_, n) => ({
        key: String(n),
        status: "imported",
        bookmarkId: String(n),
      })),
      imported: 5,
      existing: 0,
      failed: 0,
    });
    await POST(request(input));
    expect(state.after).toHaveBeenCalledOnce();
    await state.after.mock.calls[0][0]();
    expect(state.embed).toHaveBeenCalledTimes(3);
    state.after.mockClear();
    state.receipt.mockResolvedValue({ requestId });
    await POST(request(input));
    expect(state.after).not.toHaveBeenCalled();
  });
});
