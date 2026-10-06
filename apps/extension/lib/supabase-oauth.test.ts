import { beforeEach, expect, it, vi } from "vitest";
const { values, storageMock } = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return { values, storageMock: {
    defineItem(key: string, options: { fallback: unknown }) {
      return {
        getValue: async () => (values.has(key) ? values.get(key) : options.fallback),
        setValue: async (value: unknown) => {
          values.set(key, value);
        },
        removeValue: async () => {
          values.delete(key);
        },
      };
    },
  } };
});
vi.mock("#imports", () => ({ storage: storageMock }));
// WXT rewrites #imports to its concrete utility during the complete suite.
vi.mock("wxt/utils/storage", () => ({ storage: storageMock }));
vi.mock("wxt/browser", () => ({
  browser: { storage: { local: { remove: vi.fn() } }, identity: {}, tabs: {} },
}));
vi.mock("./net", () => ({ fetchWithTimeout: vi.fn() }));
const key = "local:bookmark-ai:supabase-qa:oauth";
const original = { accessToken: "access", refreshToken: "refresh", expiresAt: 1 };
it.each(["not-a-jwt", "header..signature", "header.not-json.signature"])(
  "does not invent a Live device session from malformed token %s",
  async (accessToken) => {
    values.set(key, { accessToken, refreshToken: "refresh", expiresAt: Date.now() + 3600000 });
    const { getOAuthSessionId } = await import("./supabase-oauth");
    expect(await getOAuthSessionId()).toBeNull();
  },
);
beforeEach(async () => {
  vi.resetModules();
  values.clear();
  vi.stubEnv("MODE", "supabase-qa");
  vi.stubEnv("WXT_SUPABASE_URL", "https://xogqaqtyacmecdbmgqqd.supabase.co");
  vi.stubEnv("WXT_APP_URL", "http://localhost:3100");
  vi.stubEnv("WXT_SUPABASE_OAUTH_CLIENT_ID", "public-client");
});
it.each(["http://localhost:3100", "https://www.bookmark-ai.cloud"])(
  "exchanges scoped OAuth credentials against the configured target %s",
  async (appUrl) => {
    vi.stubEnv("WXT_APP_URL", appUrl);
    values.set(key, original);
    const { fetchWithTimeout } = await import("./net");
    vi.mocked(fetchWithTimeout).mockResolvedValue(new Response(JSON.stringify({
      token_type: "Bearer", access_token: "next", refresh_token: "rotated", expires_in: 3600,
    })));
    const { getOAuthToken } = await import("./supabase-oauth");
    expect(await getOAuthToken()).toBe("next");
  },
);
it.each(["https://bookmark-ai.cloud.evil.example", "http://www.bookmark-ai.cloud", "https://preview.example"])(
  "rejects an unapproved OAuth app target %s",
  async (appUrl) => {
    vi.stubEnv("WXT_APP_URL", appUrl);
    values.set(key, original);
    const { getOAuthToken } = await import("./supabase-oauth");
    await expect(getOAuthToken()).rejects.toThrow("not configured");
  },
);
it("coalesces concurrent rotation and stores the provider replacement", async () => {
  values.set(key, original);
  const { fetchWithTimeout } = await import("./net");
  vi.mocked(fetchWithTimeout).mockResolvedValue(
    new Response(
      JSON.stringify({
        token_type: "Bearer",
        access_token: "next",
        refresh_token: "rotated",
        expires_in: 3600,
      }),
    ),
  );
  const { getOAuthToken } = await import("./supabase-oauth");
  expect(await Promise.all([getOAuthToken(), getOAuthToken()])).toEqual(["next", "next"]);
  expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  expect(values.get(key)).toMatchObject({ refreshToken: "rotated" });
});
it("preserves credentials during a provider outage", async () => {
  values.set(key, original);
  const { fetchWithTimeout } = await import("./net");
  vi.mocked(fetchWithTimeout).mockResolvedValue(new Response("", { status: 503 }));
  const { getOAuthToken } = await import("./supabase-oauth");
  await expect(getOAuthToken()).rejects.toThrow("temporarily unavailable");
  expect(values.get(key)).toEqual(original);
});
it("drops an invalid grant instead of falling through to a web credential", async () => {
  values.set(key, original);
  const { fetchWithTimeout } = await import("./net");
  vi.mocked(fetchWithTimeout).mockResolvedValue(new Response("", { status: 400 }));
  const { getOAuthToken } = await import("./supabase-oauth");
  expect(await getOAuthToken()).toBeNull();
  expect(values.get(key)).toBeNull();
});
it("does not resurrect a credential when logout wins a refresh race", async () => {
  values.set(key, original);
  const { fetchWithTimeout } = await import("./net");
  let finish!: (response: Response) => void;
  vi.mocked(fetchWithTimeout).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { getOAuthToken, clearOAuth } = await import("./supabase-oauth");
  const result = getOAuthToken();
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await clearOAuth();
  finish(
    new Response(
      JSON.stringify({
        token_type: "Bearer",
        access_token: "next",
        refresh_token: "rotated",
        expires_in: 3600,
      }),
    ),
  );
  expect(await result).toBeNull();
  expect(values.has(key)).toBe(false);
});
it("consumes a valid code once and rejects a replay without another exchange", async () => {
  const pendingKey = "local:bookmark-ai:supabase-qa:oauth-pending";
  values.set(pendingKey, {
    state: "bound",
    verifier: "verifier",
    redirect: "http://localhost:3100/auth/extension-callback",
    expiresAt: Date.now() + 600000,
    tabId: 7,
  });
  const { fetchWithTimeout } = await import("./net");
  vi.mocked(fetchWithTimeout)
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          token_type: "Bearer",
          access_token: "next",
          refresh_token: "rotated",
          expires_in: 3600,
        }),
      ),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const { completeOAuth } = await import("./supabase-oauth");
  const callback = "http://localhost:3100/auth/extension-callback?state=bound&code=one";
  await completeOAuth(callback, 7);
  await expect(completeOAuth(callback, 7)).rejects.toThrow("expired");
  expect(values.has(pendingKey)).toBe(false);
});
it("rejects a callback from another Safari tab before token exchange", async () => {
  values.set("local:bookmark-ai:supabase-qa:oauth-pending", {
    state: "bound",
    verifier: "verifier",
    redirect: "http://localhost:3100/auth/extension-callback",
    expiresAt: Date.now() + 600000,
    tabId: 7,
  });
  const { completeOAuth } = await import("./supabase-oauth");
  await expect(
    completeOAuth("http://localhost:3100/auth/extension-callback?state=bound&code=one", 8),
  ).rejects.toThrow("expired");
  expect(values.has(key)).toBe(false);
});
