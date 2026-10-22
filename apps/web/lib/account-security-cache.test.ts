import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  accountId: "a",
  listFactors: vi.fn(),
  getSession: vi.fn(),
  getAccessToken: vi.fn(),
  listeners: new Map<string, Set<() => void>>(),
}));
vi.mock("./auth", () => ({
  getBrowserSupabase: () => ({
    auth: { getSession: mocks.getSession, mfa: { listFactors: mocks.listFactors } },
  }),
  getAccessToken: mocks.getAccessToken,
}));
vi.mock("./account-private-state", () => ({
  onExplicitSignOut: (id: string, clear: () => void) => {
    const listeners = mocks.listeners.get(id) ?? new Set();
    listeners.add(clear);
    mocks.listeners.set(id, listeners);
    return () => listeners.delete(clear);
  },
}));
import {
  clearAccountSecurity,
  preloadAccountSecurity,
  readAccountDevices,
  readAccountFactors,
} from "./account-security-cache";
const fetchMock = vi.fn();
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  mocks.accountId = "a";
  mocks.getSession.mockImplementation(async () => ({
    data: { session: { user: { id: mocks.accountId } } },
    error: null,
  }));
  mocks.getAccessToken.mockResolvedValue("fixture-token");
  mocks.listFactors.mockResolvedValue({
    data: { totp: [{ id: "factor-a", status: "verified", secret: "must-not-cache" }] },
    error: null,
  });
  fetchMock.mockImplementation(async () => ({
    ok: true,
    json: async () => ({
      sessions: [{ id: `device-${mocks.accountId}`, access_token: "must-not-cache" }],
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", {});
});
afterEach(() => {
  clearAccountSecurity();
  mocks.listeners.clear();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("account security read cache", () => {
  it("deduplicates preload and pane reads, caches summaries only, and refreshes after expiry", async () => {
    await Promise.all([
      preloadAccountSecurity("a"),
      preloadAccountSecurity("a"),
      readAccountDevices("a"),
      readAccountFactors("a"),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await readAccountDevices("a"))[0]).not.toHaveProperty("access_token");
    expect(mocks.listFactors).toHaveBeenCalledTimes(1);
    expect(await readAccountFactors("a")).toEqual([
      { id: "factor-a", status: "verified", friendly_name: undefined },
    ]);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 30_001);
    await readAccountDevices("a");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("keeps accounts isolated and refuses to fetch under a different session", async () => {
    expect(await readAccountDevices("a")).toEqual([{ id: "device-a" }]);
    await expect(readAccountDevices("b")).rejects.toThrow("Sign in");
    mocks.accountId = "b";
    expect(await readAccountDevices("b")).toEqual([{ id: "device-b" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("drops a response when the account switches during the read", async () => {
    const pending = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const read = readAccountDevices("a");
    const rejected = expect(read).rejects.toThrow("Sign in");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    mocks.accountId = "b";
    pending.resolve({ ok: true, json: async () => ({ sessions: [{ id: "old" }] }) });
    await rejected;
    mocks.accountId = "a";
    expect(await readAccountDevices("a")).toEqual([{ id: "device-a" }]);
  });
  it("settles failed preloads without an unhandled rejection and lets panes retry", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    mocks.listFactors.mockResolvedValueOnce({ data: null, error: new Error("offline") });
    await expect(preloadAccountSecurity("a")).resolves.toEqual([
      expect.objectContaining({ status: "rejected" }),
      expect.objectContaining({ status: "rejected" }),
    ]);
    await expect(readAccountDevices("a")).resolves.toEqual([{ id: "device-a" }]);
    await expect(readAccountFactors("a")).resolves.toHaveLength(1);
  });
  it("bounds hung factor reads and prevents late responses repopulating the cache", async () => {
    vi.useFakeTimers();
    const pending = deferred<unknown>();
    mocks.listFactors.mockReturnValueOnce(pending.promise);
    const read = readAccountFactors("a");
    const rejected = expect(read).rejects.toThrow("could not be loaded");
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(10_001);
    await rejected;
    pending.resolve({ data: { totp: [{ id: "late", status: "verified" }] }, error: null });
    expect(await readAccountFactors("a")).toEqual([
      { id: "factor-a", status: "verified", friendly_name: undefined },
    ]);
  });
  it("clears explicit signout data and cancels in-flight reads while preserving other accounts", async () => {
    await preloadAccountSecurity("a");
    mocks.accountId = "b";
    await readAccountDevices("b");
    for (const clear of [...mocks.listeners.get("a")!]) clear();
    await readAccountDevices("b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    mocks.accountId = "a";
    const pending = deferred<unknown>();
    mocks.listFactors.mockReturnValueOnce(pending.promise);
    const read = readAccountFactors("a");
    const rejected = expect(read).rejects.toThrow("could not be loaded");
    for (const clear of [...mocks.listeners.get("a")!]) clear();
    await rejected;
    await readAccountDevices("a");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("aborts a hung device request on timeout and permits a clean retry", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const read = readAccountDevices("a");
    const rejected = expect(read).rejects.toThrow("could not be loaded");
    await vi.advanceTimersByTimeAsync(1);
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(signal.aborted).toBe(true);
    await expect(readAccountDevices("a")).resolves.toEqual([{ id: "device-a" }]);
  });
  it("invalidates one resource without cancelling an unrelated preload", async () => {
    await preloadAccountSecurity("a");
    clearAccountSecurity("a", "factors");
    await Promise.all([readAccountDevices("a"), readAccountFactors("a")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.listFactors).toHaveBeenCalledTimes(2);
  });
});
