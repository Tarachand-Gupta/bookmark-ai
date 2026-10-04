import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({ createBrowserClient: () => ({ auth: mocks }) }));
describe("browser credential recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("window", { location: { assign: vi.fn() } });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://qa.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("single-flights concurrent refresh and returns fresh credentials", async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "old-test-token", expires_at: 1 } },
      error: null,
    });
    mocks.refreshSession.mockResolvedValue({
      data: { session: { access_token: "fresh-test-token" } },
      error: null,
    });
    const { getAccessToken } = await import("./auth");
    expect(await Promise.all([getAccessToken(), getAccessToken(), getAccessToken()])).toEqual([
      "fresh-test-token",
      "fresh-test-token",
      "fresh-test-token",
    ]);
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
  });
  it("does not sign out or discard credentials on refresh outage", async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "old-test-token", expires_at: 1 } },
      error: null,
    });
    mocks.refreshSession.mockResolvedValue({ data: { session: null }, error: { status: 503 } });
    const { getAccessToken } = await import("./auth");
    await expect(getAccessToken()).rejects.toThrow("could not be refreshed");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("does not refresh a missing session", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const { getAccessToken } = await import("./auth");
    expect(await getAccessToken()).toBeNull();
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });
});
