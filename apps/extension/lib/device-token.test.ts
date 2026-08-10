import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { fakeBrowser } from "wxt/testing";
import {
  clearDeviceToken,
  getStoredDeviceToken,
  getUsableDeviceToken,
  renewDeviceTokenIfNeeded,
  storeDeviceToken,
} from "./device-token";

/**
 * The device token is the ONLY credential that keeps saves working after the
 * server-side Clerk session expires, so its self-heal behavior is the thing most
 * worth pinning down: hand back a valid token without a network round-trip, renew
 * INLINE rather than returning null at the edge of expiry, clear a token the
 * server rejects, keep one that merely hit the renewal-chain cap, and never
 * stampede the mint endpoint.
 *
 * `diag` is mocked because its real implementation debounce-POSTs to a dev-log
 * endpoint — a stray timer firing into the fetch mock would corrupt the call
 * assertions. Mocking it also lets us assert the breadcrumbs themselves.
 */
vi.mock("./diag", () => ({ diag: vi.fn() }));

const { diag } = await import("./diag");
const diagMock = diag as Mock;

const DAY_MS = 86_400_000;
const BASE = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The Authorization header of the nth fetch call (renewals must present the
 * token they are replacing). */
function bearerOf(mock: Mock, call = 0): string | undefined {
  const init = mock.mock.calls[call]?.[1] as RequestInit | undefined;
  return (init?.headers as Record<string, string> | undefined)?.authorization;
}

let fetchMock: Mock;

beforeEach(async () => {
  fakeBrowser.reset();
  diagMock.mockClear();
  const { apiUrlItem } = await import("./api");
  await apiUrlItem.setValue(BASE);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("getUsableDeviceToken", () => {
  it("hands back a comfortably-valid token without touching the network", async () => {
    await storeDeviceToken({ token: "bkd_valid", expiresAtMs: Date.now() + 90 * DAY_MS });

    expect(await getUsableDeviceToken()).toBe("bkd_valid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when nothing was ever minted", async () => {
    expect(await getUsableDeviceToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renews INLINE when the stored token is inside its last minute", async () => {
    // getStoredDeviceToken refuses this token (under the 60s floor); the whole
    // point of getUsableDeviceToken is that the caller still gets a bearer.
    await storeDeviceToken({ token: "bkd_old", expiresAtMs: Date.now() + 10_000 });
    expect(await getStoredDeviceToken()).toBeNull();

    fetchMock.mockImplementation(async () =>
      jsonResponse({ token: "bkd_fresh", expiresAtMs: Date.now() + 90 * DAY_MS }),
    );

    expect(await getUsableDeviceToken()).toBe("bkd_fresh");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE}/api/device-token`);
    // The OLD token is the renewal bearer — the server accepts it until real expiry.
    expect(bearerOf(fetchMock)).toBe("Bearer bkd_old");
    expect(diagMock).toHaveBeenCalledWith(
      "deviceToken",
      "near expiry: inline renewal",
      expect.objectContaining({ remainingMs: expect.any(Number) }),
    );
  });

  it("renews an already-expired token (the server's grace window still accepts it)", async () => {
    await storeDeviceToken({ token: "bkd_expired", expiresAtMs: Date.now() - 5_000 });
    fetchMock.mockImplementation(async () =>
      jsonResponse({ token: "bkd_fresh", expiresAtMs: Date.now() + 90 * DAY_MS }),
    );

    expect(await getUsableDeviceToken()).toBe("bkd_fresh");
  });

  it("clears the token and reports null when the server calls it invalid", async () => {
    await storeDeviceToken({ token: "bkd_bad", expiresAtMs: Date.now() + 10_000 });
    fetchMock.mockImplementation(async () => jsonResponse({ error: "unauthorized" }, 401));

    expect(await getUsableDeviceToken()).toBeNull();
    // Cleared, so the next call doesn't even try to renew.
    fetchMock.mockClear();
    expect(await getUsableDeviceToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("KEEPS the token on `reauth` — only a fresh Clerk mint can replace that chain", async () => {
    await storeDeviceToken({ token: "bkd_capped", expiresAtMs: Date.now() + 10_000 });
    fetchMock.mockImplementation(async () => jsonResponse({ code: "reauth" }, 401));

    expect(await getUsableDeviceToken()).toBeNull();
    // Still stored: a later forced renewal presents the same bearer (the 60s
    // cooldown is what stops it from being tried again immediately).
    expect(await renewDeviceTokenIfNeeded({ force: true })).toBe("throttled");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not stampede the renewal endpoint when a burst of calls all miss", async () => {
    await storeDeviceToken({ token: "bkd_old", expiresAtMs: Date.now() + 10_000 });
    fetchMock.mockImplementation(async () => new Response("boom", { status: 503 }));

    await Promise.all([getUsableDeviceToken(), getUsableDeviceToken(), getUsableDeviceToken()]);

    // 60s forced-renewal cooldown: one POST, not three.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("renewDeviceTokenIfNeeded", () => {
  it("reports `none` with no stored token and never calls out", async () => {
    expect(await renewDeviceTokenIfNeeded()).toBe("none");
    expect(await renewDeviceTokenIfNeeded({ force: true })).toBe("none");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports `fresh` while the token is past 1/3 of its TTL", async () => {
    await storeDeviceToken({ token: "bkd_new", expiresAtMs: Date.now() + 89 * DAY_MS });
    expect(await renewDeviceTokenIfNeeded()).toBe("fresh");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renews once the token drops under 60 days, then throttles for 24h", async () => {
    await storeDeviceToken({ token: "bkd_aging", expiresAtMs: Date.now() + 30 * DAY_MS });
    fetchMock.mockImplementation(async () =>
      jsonResponse({ token: "bkd_renewed", expiresInSeconds: 90 * 86_400 }),
    );

    expect(await renewDeviceTokenIfNeeded()).toBe("renewed");
    expect(await getStoredDeviceToken()).toBe("bkd_renewed");

    // Age it again — the 24h scheduled throttle still bites.
    await storeDeviceToken({ token: "bkd_renewed", expiresAtMs: Date.now() + 30 * DAY_MS });
    expect(await renewDeviceTokenIfNeeded()).toBe("throttled");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives forced renewals their OWN clock so the 24h throttle can't block recovery", async () => {
    await storeDeviceToken({ token: "bkd_aging", expiresAtMs: Date.now() + 30 * DAY_MS });
    fetchMock.mockImplementation(async () =>
      jsonResponse({ token: "bkd_renewed", expiresAtMs: Date.now() + 90 * DAY_MS }),
    );
    expect(await renewDeviceTokenIfNeeded()).toBe("renewed"); // consumes the 24h window

    // A 401 arrives seconds later on a token the local expiry says is fine.
    // The forced path must still go out.
    expect(await renewDeviceTokenIfNeeded({ force: true })).toBe("renewed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports `failed` (and keeps the token) on a non-401 status", async () => {
    await storeDeviceToken({ token: "bkd_keep", expiresAtMs: Date.now() + 90 * DAY_MS });
    fetchMock.mockImplementation(async () => new Response("nope", { status: 500 }));

    expect(await renewDeviceTokenIfNeeded({ force: true })).toBe("failed");
    expect(await getStoredDeviceToken()).toBe("bkd_keep");
  });

  it("reports `failed` (and keeps the token) when the network is down", async () => {
    await storeDeviceToken({ token: "bkd_keep", expiresAtMs: Date.now() + 90 * DAY_MS });
    fetchMock.mockRejectedValue(new Error("offline"));

    expect(await renewDeviceTokenIfNeeded({ force: true })).toBe("failed");
    expect(await getStoredDeviceToken()).toBe("bkd_keep");
  });

  it("reports `invalid` and clears, vs `reauth` and keeps", async () => {
    await storeDeviceToken({ token: "bkd_a", expiresAtMs: Date.now() + 90 * DAY_MS });
    fetchMock.mockImplementation(async () => jsonResponse({ code: "reauth" }, 401));
    expect(await renewDeviceTokenIfNeeded({ force: true })).toBe("reauth");
    expect(await getStoredDeviceToken()).toBe("bkd_a");

    // Fresh slate so the 60s forced cooldown doesn't swallow the second attempt.
    fakeBrowser.reset();
    const { apiUrlItem } = await import("./api");
    await apiUrlItem.setValue(BASE);
    await storeDeviceToken({ token: "bkd_b", expiresAtMs: Date.now() + 90 * DAY_MS });
    fetchMock.mockImplementation(async () => jsonResponse({ error: "nope" }, 401));
    expect(await renewDeviceTokenIfNeeded({ force: true })).toBe("invalid");
    expect(await getStoredDeviceToken()).toBeNull();
  });

  it("never logs a token value", async () => {
    await storeDeviceToken({ token: "bkd_secret", expiresAtMs: Date.now() + 10_000 });
    fetchMock.mockImplementation(async () =>
      jsonResponse({ token: "bkd_alsosecret", expiresAtMs: Date.now() + 90 * DAY_MS }),
    );
    await getUsableDeviceToken();

    expect(JSON.stringify(diagMock.mock.calls)).not.toContain("bkd_");
  });
});

describe("clearDeviceToken", () => {
  it("forgets the token", async () => {
    await storeDeviceToken({ token: "bkd_x", expiresAtMs: Date.now() + 90 * DAY_MS });
    await clearDeviceToken();
    expect(await getStoredDeviceToken()).toBeNull();
  });
});
