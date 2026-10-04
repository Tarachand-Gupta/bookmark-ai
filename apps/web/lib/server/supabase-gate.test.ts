import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const state = vi.hoisted(() => ({
  headers: new Headers(),
  cookie: null as string | null,
  verify: vi.fn(),
  resolve: vi.fn(),
  clerk: vi.fn(),
  master: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => state.headers }));
vi.mock("@clerk/nextjs/server", () => ({ auth: state.clerk }));
vi.mock("./rate-limit", () => ({ checkRateLimit: () => true }));
vi.mock("./context", () => ({ getMasterContext: state.master }));
vi.mock("@/lib/auth/server", () => ({ getCookieAccessToken: async () => state.cookie }));
vi.mock("@bookmark-ai/engine", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  createSupabaseVerifier: () => state.verify,
}));
import { PostgresMasterRepository } from "@bookmark-ai/db";
import { InvalidSessionError, AuthUnavailableError } from "@bookmark-ai/engine";
import { requireUser } from "./require-user";

const identity = {
  providerUserId: "9e6a25cd-4a86-4ba8-87be-b83bd4387d03",
  sessionId: "d7bd59e9-47bc-4cf6-ac89-1bc3e6dc4bc7",
  accessToken: "not-a-real-token",
  expiresAt: Date.now() / 1000 + 600,
  authenticatedAt: Date.now() / 1000,
  aal: "aal1",
  user: { id: "9e6a25cd-4a86-4ba8-87be-b83bd4387d03" },
};
beforeEach(() => {
  vi.stubEnv("AUTH_PROVIDER", "supabase");
  vi.stubEnv("BOOKMARK_BUILD_VARIANT", "supabase-qa");
  vi.stubEnv("SUPABASE_URL", "https://qa.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-publishable");
  vi.stubEnv("SUPABASE_EXTENSION_CLIENT_IDS", "trusted");
  vi.stubEnv("AUTH_ALLOWED_USER_IDS", "");
  state.cookie = null;
  state.headers = new Headers({
    authorization: "Bearer not-a-real-token",
    "x-bkm-route": "GET /api/me",
  });
  const repository = Object.create(PostgresMasterRepository.prototype);
  repository.kind = "postgres";
  repository.connection = { query: vi.fn(), transaction: vi.fn() };
  repository.resolveAccount = state.resolve;
  state.master.mockReset().mockReturnValue({ db: repository, ready: Promise.resolve() });
  state.resolve.mockReset().mockResolvedValue("account");
  state.verify.mockReset().mockResolvedValue(identity);
  state.clerk.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
describe("Supabase protected API gate", () => {
  it("fails closed when QA provider config is missing, never Clerk/open fallback", async () => {
    vi.stubEnv("AUTH_PROVIDER", "");
    vi.stubEnv("ALLOW_OPEN_MODE", "1");
    vi.stubEnv("DEV_OPEN_API", "1");
    const result = await requireUser();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
    expect(state.clerk).not.toHaveBeenCalled();
    expect(state.resolve).not.toHaveBeenCalled();
  });
  it("rejects a wrong-provider cached repository before account routing", async()=>{
    state.master.mockReturnValue({db:{kind:'libsql',resolveAccount:state.resolve},ready:Promise.resolve()});
    const result=await requireUser();
    expect(result.ok).toBe(false);
    if(!result.ok)expect(result.response.status).toBe(503);
    expect(state.resolve).not.toHaveBeenCalled();
  });
  it("maps authenticated human identity without approving cross-request reuse", async () => {
    const first = await requireUser();
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.userId).toBe("account");
    state.verify.mockRejectedValueOnce(new InvalidSessionError());
    const second = await requireUser();
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.response.status).toBe(401);
    expect(state.verify).toHaveBeenCalledTimes(2);
    expect(state.resolve).toHaveBeenCalledTimes(1);
  });
  it("returns temporary outage without mistaken invalid-credential status", async () => {
    state.verify.mockRejectedValueOnce(new AuthUnavailableError());
    const result = await requireUser();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
    expect(state.resolve).not.toHaveBeenCalled();
  });
  it("rejects unknown OAuth clients before master and denies trusted extension account controls", async () => {
    state.verify.mockResolvedValue({ ...identity, clientId: "unknown" });
    let result = await requireUser();
    expect(result.ok).toBe(false);
    expect(state.resolve).not.toHaveBeenCalled();
    state.verify.mockResolvedValue({ ...identity, clientId: "trusted" });
    state.headers.set("x-bkm-route", "DELETE /api/account");
    result = await requireUser();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
    state.headers.set("x-bkm-route", "POST /api/bookmarks");
    expect((await requireUser()).ok).toBe(true);
  });
  it("rejects foreign or absent cookie mutation origin before provider lookup, while preserving native bearer requests", async () => {
    state.cookie = "not-a-real-token";
    state.headers = new Headers({
      "x-bkm-route": "POST /api/bookmarks",
      "x-bkm-origin": "http://localhost:3100",
      origin: "http://localhost:9999",
      "content-type": "text/plain",
      "sec-fetch-site": "same-site",
    });
    let result = await requireUser();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
    expect(state.verify).not.toHaveBeenCalled();
    state.headers.delete("origin");
    result = await requireUser();
    expect(result.ok).toBe(false);
    expect(state.verify).not.toHaveBeenCalled();
    state.headers.set("origin", "http://localhost:3100");
    expect((await requireUser()).ok).toBe(true);
    state.headers.set("origin", "http://localhost:9999");
    state.headers.set("authorization", "Bearer not-a-real-token");
    expect((await requireUser()).ok).toBe(true);
  });
  it("requires enrolled MFA assurance before authorizing protected work", async () => {
    state.verify.mockResolvedValue({
      ...identity,
      user: { ...identity.user, factors: [{ status: "verified" }] },
    });
    const result = await requireUser();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
    expect(state.resolve).not.toHaveBeenCalled();
  });
});
