import { beforeEach, expect, it, vi } from "vitest";
const { values, storageMock, storageHooks } = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const storageHooks: {
    get?: (key: string) => Promise<void>;
    set?: (key: string, value: unknown) => Promise<void>;
    remove?: (key: string) => Promise<void>;
  } = {};
  return { values, storageHooks, storageMock: {
    defineItem(key: string, options: { fallback: unknown }) {
      return {
        getValue: async () => {
          const value = values.has(key) ? values.get(key) : options.fallback;
          await storageHooks.get?.(key);
          return value;
        },
        setValue: async (value: unknown) => {
          await storageHooks.set?.(key, value);
          values.set(key, value);
        },
        removeValue: async () => {
          await storageHooks.remove?.(key);
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
vi.mock("./diag", () => ({ diag: vi.fn() }));
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
  storageHooks.get = storageHooks.set = storageHooks.remove = undefined;
  vi.stubEnv("MODE", "supabase-qa");
  vi.stubEnv("WXT_SUPABASE_URL", "https://xogqaqtyacmecdbmgqqd.supabase.co");
  vi.stubEnv("WXT_APP_URL", "http://localhost:3100");
  vi.stubEnv("WXT_SUPABASE_OAUTH_CLIENT_ID", "public-client");
});

const pendingKey = "local:bookmark-ai:supabase-qa:oauth-pending";
const identityKey = "local:bookmark-ai:supabase-qa:identity";
const callback = "http://localhost:3100/auth/extension-callback?state=bound&code=one";
function seedPending() {
  values.set(pendingKey, { state: "bound", verifier: "verifier", redirect: "http://localhost:3100/auth/extension-callback", expiresAt: Date.now() + 600000, tabId: 7 });
}
function tokenResponse() {
  return new Response(JSON.stringify({ token_type: "Bearer", access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}

it("readiness checks retain pending state and require its exact unexpired Safari tab binding", async () => {
  seedPending();
  const { oauthCallbackReady } = await import("./supabase-oauth");
  expect(await oauthCallbackReady(8)).toBe(false);
  expect(await oauthCallbackReady(7)).toBe(true);
  expect(await oauthCallbackReady(7)).toBe(true);
  expect(values.has(pendingKey)).toBe(true);
  values.set(pendingKey, { ...(values.get(pendingKey) as object), expiresAt: Date.now() - 1 });
  expect(await oauthCallbackReady(7)).toBe(false);
  expect(values.has(pendingKey)).toBe(true);
  const { fetchWithTimeout } = await import("./net");
  expect(fetchWithTimeout).not.toHaveBeenCalled();
});

it.each([200, 401])("ignores an old identity response %s during the asynchronous credential commit", async status => {
  values.set(key, { ...original, expiresAt: Date.now() + 3600000 });
  seedPending();
  const oldProbe = deferred<Response>();
  const commit = deferred<void>();
  let commitStarted = false;
  storageHooks.set = async (item, value) => {
    if (item === key && (value as { accessToken?: string })?.accessToken === "new-access") {
      commitStarted = true;
      await commit.promise;
    }
  };
  const { fetchWithTimeout } = await import("./net");
  vi.mocked(fetchWithTimeout).mockImplementation(async (url, init) => {
    if (url.endsWith("/oauth/token")) return tokenResponse();
    if (url.endsWith("/sessions/current")) return new Response(null, { status: 204 });
    const bearer = (init?.headers as Record<string, string>)?.Authorization;
    if (bearer === "Bearer access") return oldProbe.promise;
    return new Response(JSON.stringify({ name: "New account", email: "new@example.test" }));
  });
  const { oauthIdentity, completeOAuth } = await import("./supabase-oauth");
  const reading = oauthIdentity();
  await vi.waitFor(() => expect(fetchWithTimeout).toHaveBeenCalledTimes(1));
  const completing = completeOAuth(callback, 7);
  await vi.waitFor(() => expect(commitStarted).toBe(true));
  oldProbe.resolve(status === 401 ? new Response(null, { status }) : new Response(JSON.stringify({ name: "Old account", email: "old@example.test" })));
  // The older result arrives while credential.setValue is still unresolved.
  await Promise.resolve();
  commit.resolve();
  await completing;
  expect(await reading).toMatchObject({ signedIn: true, name: "New account" });
  expect(values.get(key)).toMatchObject({ accessToken: "new-access" });
  expect(values.get(identityKey)).toMatchObject({ name: "New account" });
});

it("does not cancel a callback when an old 401 arrives during its pending-state read", async () => {
  values.set(key, { ...original, expiresAt: Date.now() + 3600000 });
  seedPending();
  const oldProbe = deferred<Response>();
  const pendingRead = deferred<void>();
  let readingPending = false;
  storageHooks.get = async item => {
    if (item === pendingKey) { readingPending = true; await pendingRead.promise; }
  };
  const { fetchWithTimeout } = await import("./net");
  vi.mocked(fetchWithTimeout).mockImplementation(async (url, init) => {
    if (url.endsWith("/oauth/token")) return tokenResponse();
    if (url.endsWith("/sessions/current")) return new Response(null, { status: 204 });
    return (init?.headers as Record<string, string>)?.Authorization === "Bearer access"
      ? oldProbe.promise : new Response(JSON.stringify({ name: "New account" }));
  });
  const { oauthIdentity, completeOAuth } = await import("./supabase-oauth");
  const reading = oauthIdentity();
  await vi.waitFor(() => expect(fetchWithTimeout).toHaveBeenCalledOnce());
  const completing = completeOAuth(callback, 7);
  await vi.waitFor(() => expect(readingPending).toBe(true));
  oldProbe.resolve(new Response(null, { status: 401 }));
  await new Promise(resolve => setTimeout(resolve, 0));
  pendingRead.resolve();
  await completing;
  expect(await reading).toMatchObject({ signedIn: true, name: "New account" });
  expect(values.get(key)).toMatchObject({ accessToken: "new-access" });
});

it("does not erase a pending sign-in merely because the previous credential is rejected", async () => {
  values.set(key, { ...original, expiresAt: Date.now() + 3600000 });
  seedPending();
  const { fetchWithTimeout } = await import("./net");
  vi.mocked(fetchWithTimeout).mockResolvedValue(new Response(null, { status: 401 }));
  const { oauthIdentity } = await import("./supabase-oauth");
  expect(await oauthIdentity()).toMatchObject({ signedIn: false });
  expect(values.has(key)).toBe(false);
  expect(values.has(pendingKey)).toBe(true);
});

it("never writes token, callback, verifier, state or identity values to OAuth diagnostics", async () => {
  seedPending();
  const { fetchWithTimeout } = await import("./net");
  vi.mocked(fetchWithTimeout).mockResolvedValueOnce(tokenResponse()).mockRejectedValueOnce(new Error("private-error-payload"));
  const { completeOAuth } = await import("./supabase-oauth");
  await completeOAuth(callback, 7);
  const { diag } = await import("./diag");
  const logged = JSON.stringify(vi.mocked(diag).mock.calls);
  for (const privateValue of ["new-access", "new-refresh", "verifier", "bound", callback, "private-error-payload"]) {
    expect(logged).not.toContain(privateValue);
  }
  expect(logged).toContain("callback complete");
});

it("does not let an old identity 401 remove a fresh callback credential during delayed removal", async () => {
  values.set(key, { ...original, expiresAt: Date.now() + 3600000 });
  const removing = deferred<void>();
  let removalStarted = false;
  storageHooks.remove = async item => {
    if (item === key) { removalStarted = true; await removing.promise; }
  };
  const { fetchWithTimeout } = await import("./net");
  vi.mocked(fetchWithTimeout).mockImplementation(async (url, init) => {
    if (url.endsWith("/oauth/token")) return tokenResponse();
    if (url.endsWith("/sessions/current")) return new Response(null, { status: 204 });
    return (init?.headers as Record<string, string>)?.Authorization === "Bearer access"
      ? new Response(null, { status: 401 })
      : new Response(JSON.stringify({ name: "New account" }));
  });
  const { oauthIdentity, completeOAuth } = await import("./supabase-oauth");
  const reading = oauthIdentity();
  await vi.waitFor(() => expect(removalStarted).toBe(true));
  seedPending();
  const completing = completeOAuth(callback, 7);
  await vi.waitFor(() => expect(fetchWithTimeout).toHaveBeenCalledTimes(2));
  removing.resolve();
  await completing;
  expect(await reading).toMatchObject({ signedIn: true, name: "New account" });
  expect(values.get(key)).toMatchObject({ accessToken: "new-access" });
});

it("does not cache an old successful identity response arriving after logout", async () => {
  values.set(key, { ...original, expiresAt: Date.now() + 3600000 });
  const response = deferred<Response>();
  const { fetchWithTimeout } = await import("./net");
  vi.mocked(fetchWithTimeout).mockReturnValue(response.promise);
  const { oauthIdentity, clearOAuth } = await import("./supabase-oauth");
  const reading = oauthIdentity();
  await vi.waitFor(() => expect(fetchWithTimeout).toHaveBeenCalledOnce());
  await clearOAuth();
  response.resolve(new Response(JSON.stringify({ name: "Old account" })));
  expect(await reading).toMatchObject({ signedIn: false });
  expect(values.has(identityKey)).toBe(false);
});

it("clears a delayed identity cache write before logout finishes", async () => {
  values.set(key, { ...original, expiresAt: Date.now() + 3600000 });
  const cacheWrite = deferred<void>();
  let writing = false;
  storageHooks.set = async item => {
    if (item === identityKey) { writing = true; await cacheWrite.promise; }
  };
  const { fetchWithTimeout } = await import("./net");
  vi.mocked(fetchWithTimeout).mockResolvedValue(new Response(JSON.stringify({ name: "Old account" })));
  const { oauthIdentity, clearOAuth } = await import("./supabase-oauth");
  const reading = oauthIdentity();
  await vi.waitFor(() => expect(writing).toBe(true));
  const logout = clearOAuth();
  cacheWrite.resolve();
  await logout;
  expect(await reading).toMatchObject({ signedIn: false });
  expect(values.has(identityKey)).toBe(false);
  expect(values.has(key)).toBe(false);
});

it("does not commit a callback credential after logout during its storage write", async () => {
  seedPending();
  const commit = deferred<void>();
  let writing = false;
  storageHooks.set = async item => {
    if (item === key) { writing = true; await commit.promise; }
  };
  const { fetchWithTimeout } = await import("./net");
  vi.mocked(fetchWithTimeout).mockResolvedValue(tokenResponse());
  const { completeOAuth, clearOAuth } = await import("./supabase-oauth");
  const completing = completeOAuth(callback, 7);
  const failed = expect(completing).rejects.toThrow("superseded");
  await vi.waitFor(() => expect(writing).toBe(true));
  const logout = clearOAuth();
  commit.resolve();
  await Promise.all([logout, failed]);
  expect(values.has(key)).toBe(false);
  expect(values.has(identityKey)).toBe(false);
});

it.each(["network", 403, 503])("keeps completed authentication when optional registration fails: %s", async failure => {
  seedPending();
  const { fetchWithTimeout } = await import("./net");
  vi.mocked(fetchWithTimeout).mockResolvedValueOnce(tokenResponse());
  if (failure === "network") vi.mocked(fetchWithTimeout).mockRejectedValueOnce(new Error("offline"));
  else vi.mocked(fetchWithTimeout).mockResolvedValueOnce(new Response(null, { status: failure as number }));
  const { completeOAuth, getOAuthToken } = await import("./supabase-oauth");
  await completeOAuth(callback, 7);
  expect(await getOAuthToken()).toBe("new-access");
});

it("does not report success for a registration 401 rejecting the committed token", async () => {
  seedPending();
  const { fetchWithTimeout } = await import("./net");
  vi.mocked(fetchWithTimeout).mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response(null, { status: 401 }));
  const { completeOAuth, getOAuthToken } = await import("./supabase-oauth");
  await expect(completeOAuth(callback, 7)).rejects.toThrow("rejected");
  expect(await getOAuthToken()).toBeNull();
});
it("production OAuth uses its own credentials and cannot reuse QA storage", async () => {
  vi.stubEnv("MODE", "production");
  vi.stubEnv("WXT_AUTH_PROVIDER", "supabase");
  vi.stubEnv("WXT_APP_URL", "https://www.bookmark-ai.cloud");
  values.set(key, { accessToken: "qa-access", refreshToken: "qa-refresh", expiresAt: Date.now() + 3600000 });
  const { SUPABASE_AUTH, getOAuthToken } = await import("./supabase-oauth");
  expect(SUPABASE_AUTH).toBe(true);
  expect(await getOAuthToken()).toBeNull();
  values.set("local:bookmark-ai:supabase-production:oauth", { accessToken: "production-access", refreshToken: "production-refresh", expiresAt: Date.now() + 3600000 });
  expect(await getOAuthToken()).toBe("production-access");
  expect(values.get(key)).toMatchObject({ accessToken: "qa-access" });
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
