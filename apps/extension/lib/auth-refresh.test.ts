import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { apiUrlItem, authFetch, setAuthTokenProvider } from "./api";
import { resetAuthRefreshState, setDeviceTokenReminter } from "./auth-refresh";
import { getUsableDeviceToken, storeDeviceToken } from "./device-token";

/**
 * The 401-recovery contract, which is the whole point of the hardening: a data
 * call that comes back 401 must force a credential refresh and go out ONE more
 * time, on every build target — so a user never has to open the web app to
 * un-stick a save. And it must not become a request amplifier: one retry, one
 * refresh per burst, and a cooldown after a refresh that came up empty.
 */
vi.mock("./diag", () => ({ diag: vi.fn() }));

const BASE = "http://localhost:3000";
const SAVE_URL = `${BASE}/api/bookmarks`;
const MINT_URL = `${BASE}/api/device-token`;
const DAY_MS = 86_400_000;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Calls to `url`, in order, as [url, init] pairs. */
function callsTo(mock: Mock, url: string): [string, RequestInit | undefined][] {
  return mock.mock.calls.filter((c) => c[0] === url) as [string, RequestInit | undefined][];
}

function bearerOf(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.authorization;
}

/** Route a mocked fetch by url, so a test declares behavior per endpoint. */
function routeFetch(routes: Record<string, () => Response>): Mock {
  const mock = vi.fn(async (url: string) => {
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch: ${url}`);
    return route();
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

let fetchMock: Mock;

beforeEach(async () => {
  fakeBrowser.reset();
  resetAuthRefreshState();
  await apiUrlItem.setValue(BASE);
  // The background registers this provider for real; here it's the device-token
  // rung alone, which is what the refresh replaces.
  setAuthTokenProvider(getUsableDeviceToken);
});

describe("authFetch 401 recovery", () => {
  it("refreshes and retries exactly once, carrying the NEW credential", async () => {
    await storeDeviceToken({ token: "bkd_stale", expiresAtMs: Date.now() + 90 * DAY_MS });
    let saveCalls = 0;
    fetchMock = routeFetch({
      [SAVE_URL]: () => {
        saveCalls += 1;
        return saveCalls === 1
          ? jsonResponse({ error: "Unauthorized" }, 401)
          : jsonResponse({ bookmark: { id: "b1" } }, 201);
      },
      [MINT_URL]: () =>
        jsonResponse({ token: "bkd_renewed", expiresAtMs: Date.now() + 90 * DAY_MS }, 200),
    });

    const res = await authFetch(SAVE_URL, { method: "POST", body: '{"url":"https://x.test"}' });

    expect(res.status).toBe(201);
    const saves = callsTo(fetchMock, SAVE_URL);
    expect(saves).toHaveLength(2);
    expect(bearerOf(saves[0]?.[1])).toBe("Bearer bkd_stale");
    expect(bearerOf(saves[1]?.[1])).toBe("Bearer bkd_renewed");
    // The retry must be the SAME request, not a mangled one.
    expect(saves[1]?.[1]?.method).toBe("POST");
    expect(saves[1]?.[1]?.body).toBe('{"url":"https://x.test"}');
  });

  it("retries at most ONCE, even when the second attempt 401s too", async () => {
    await storeDeviceToken({ token: "bkd_stale", expiresAtMs: Date.now() + 90 * DAY_MS });
    fetchMock = routeFetch({
      [SAVE_URL]: () => jsonResponse({ error: "Unauthorized" }, 401),
      [MINT_URL]: () =>
        jsonResponse({ token: "bkd_renewed", expiresAtMs: Date.now() + 90 * DAY_MS }, 200),
    });

    const res = await authFetch(SAVE_URL, { method: "POST", body: "{}" });

    expect(res.status).toBe(401);
    expect(callsTo(fetchMock, SAVE_URL)).toHaveLength(2);
    expect(callsTo(fetchMock, MINT_URL)).toHaveLength(1);
  });

  it("single-flights the refresh: a burst of 401s costs ONE renewal", async () => {
    await storeDeviceToken({ token: "bkd_stale", expiresAtMs: Date.now() + 90 * DAY_MS });
    // Three DIFFERENT saves, each 401ing on its own first attempt — i.e. three
    // concurrent recoveries racing for one credential.
    const seen = new Set<string>();
    fetchMock = vi.fn(async (url: string) => {
      if (url === MINT_URL) {
        return jsonResponse({ token: "bkd_renewed", expiresAtMs: Date.now() + 90 * DAY_MS }, 200);
      }
      if (seen.has(url)) return jsonResponse({ bookmark: { id: "x" } }, 201);
      seen.add(url);
      return jsonResponse({ error: "Unauthorized" }, 401);
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await Promise.all([
      authFetch(`${BASE}/api/bookmarks?a`, { method: "POST", body: "{}" }),
      authFetch(`${BASE}/api/bookmarks?b`, { method: "POST", body: "{}" }),
      authFetch(`${BASE}/api/bookmarks?c`, { method: "POST", body: "{}" }),
    ]);

    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(callsTo(fetchMock, MINT_URL)).toHaveLength(1);
  });

  it("mints a fresh token through the background when there is NO token to renew", async () => {
    // A Chrome/Firefox install whose Clerk session died before the first mint ever
    // ran: renewal has nothing to work with, so the Clerk-authed mint is the cure.
    let saveCalls = 0;
    fetchMock = routeFetch({
      [SAVE_URL]: () => {
        saveCalls += 1;
        return saveCalls === 1
          ? jsonResponse({ error: "Unauthorized" }, 401)
          : jsonResponse({ bookmark: { id: "b1" } }, 201);
      },
    });
    const reminter = vi.fn(async () => {
      await storeDeviceToken({ token: "bkd_minted", expiresAtMs: Date.now() + 90 * DAY_MS });
      return true;
    });
    setDeviceTokenReminter(reminter);

    const res = await authFetch(SAVE_URL, { method: "POST", body: "{}" });

    expect(res.status).toBe(201);
    expect(reminter).toHaveBeenCalledTimes(1);
    expect(callsTo(fetchMock, MINT_URL)).toHaveLength(0); // nothing to renew
    expect(bearerOf(callsTo(fetchMock, SAVE_URL)[1]?.[1])).toBe("Bearer bkd_minted");
  });

  it("escalates to the Clerk mint when the server says the token is INVALID", async () => {
    await storeDeviceToken({ token: "bkd_revoked", expiresAtMs: Date.now() + 90 * DAY_MS });
    let saveCalls = 0;
    fetchMock = routeFetch({
      [SAVE_URL]: () => {
        saveCalls += 1;
        return saveCalls === 1
          ? jsonResponse({ error: "Unauthorized" }, 401)
          : jsonResponse({ bookmark: { id: "b1" } }, 201);
      },
      // Renewal rejects it outright → device-token.ts clears the stored token.
      [MINT_URL]: () => jsonResponse({ error: "Unauthorized" }, 401),
    });
    setDeviceTokenReminter(async () => {
      await storeDeviceToken({ token: "bkd_minted", expiresAtMs: Date.now() + 90 * DAY_MS });
      return true;
    });

    const res = await authFetch(SAVE_URL, { method: "POST", body: "{}" });

    expect(res.status).toBe(201);
    expect(bearerOf(callsTo(fetchMock, SAVE_URL)[1]?.[1])).toBe("Bearer bkd_minted");
  });

  it("does not retry when the refresh comes up empty, and then cools down", async () => {
    await storeDeviceToken({ token: "bkd_stale", expiresAtMs: Date.now() + 90 * DAY_MS });
    fetchMock = routeFetch({
      [SAVE_URL]: () => jsonResponse({ error: "Unauthorized" }, 401),
      [MINT_URL]: () => new Response("boom", { status: 500 }),
    });
    // No reminter registered (popup context / genuinely signed out).

    const first = await authFetch(SAVE_URL, { method: "POST", body: "{}" });
    expect(first.status).toBe(401);
    expect(callsTo(fetchMock, SAVE_URL)).toHaveLength(1); // refresh failed → no retry
    expect(callsTo(fetchMock, MINT_URL)).toHaveLength(1);

    const second = await authFetch(SAVE_URL, { method: "POST", body: "{}" });
    expect(second.status).toBe(401);
    // Cooldown: the second 401 does NOT buy another renewal attempt.
    expect(callsTo(fetchMock, MINT_URL)).toHaveLength(1);
    expect(callsTo(fetchMock, SAVE_URL)).toHaveLength(2);
  });

  it("leaves non-401 failures completely alone", async () => {
    await storeDeviceToken({ token: "bkd_ok", expiresAtMs: Date.now() + 90 * DAY_MS });
    fetchMock = routeFetch({
      [SAVE_URL]: () => new Response("server exploded", { status: 500 }),
    });

    const res = await authFetch(SAVE_URL, { method: "POST", body: "{}" });

    expect(res.status).toBe(500);
    expect(callsTo(fetchMock, SAVE_URL)).toHaveLength(1);
  });

  it("does not replay a body it cannot re-send", async () => {
    await storeDeviceToken({ token: "bkd_ok", expiresAtMs: Date.now() + 90 * DAY_MS });
    fetchMock = routeFetch({
      [SAVE_URL]: () => jsonResponse({ error: "Unauthorized" }, 401),
      [MINT_URL]: () =>
        jsonResponse({ token: "bkd_renewed", expiresAtMs: Date.now() + 90 * DAY_MS }, 200),
    });

    const res = await authFetch(SAVE_URL, {
      method: "POST",
      body: new Blob(["{}"]) as unknown as BodyInit,
    });

    expect(res.status).toBe(401);
    expect(callsTo(fetchMock, SAVE_URL)).toHaveLength(1);
    expect(callsTo(fetchMock, MINT_URL)).toHaveLength(0);
  });

  it("honors retryOn401: false", async () => {
    await storeDeviceToken({ token: "bkd_ok", expiresAtMs: Date.now() + 90 * DAY_MS });
    fetchMock = routeFetch({
      [SAVE_URL]: () => jsonResponse({ error: "Unauthorized" }, 401),
    });

    const res = await authFetch(SAVE_URL, { method: "POST", body: "{}" }, { retryOn401: false });

    expect(res.status).toBe(401);
    expect(callsTo(fetchMock, SAVE_URL)).toHaveLength(1);
  });
});
