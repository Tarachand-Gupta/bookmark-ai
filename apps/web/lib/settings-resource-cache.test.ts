import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./api", () => ({
  getAppReleases: vi.fn(), getAccount: vi.fn(), getLive: vi.fn(), getMe: vi.fn(), getObservability: vi.fn(),
  getSettings: vi.fn(), listMcpTokens: vi.fn(), listSkills: vi.fn(),
}));
import { SettingsResourceCache, preloadSettingsResources, settingsResourceCache } from "./settings-resource-cache";
import * as api from "./api";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
afterEach(() => { settingsResourceCache.setAccount(null); vi.useRealTimers(); vi.clearAllMocks(); });

describe("account-scoped settings resources", () => {
  it("starts independent reads together and deduplicates pending/fresh reads, including force", async () => {
    const a = deferred<string>(); const b = deferred<number>();
    const first = vi.fn(() => a.promise); const second = vi.fn(() => b.promise);
    const cache = new SettingsResourceCache({ first, second }); cache.setAccount("a");
    const all = cache.prefetch("a", ["first", "second"]);
    expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
    const pending = cache.read("a", "first");
    expect(cache.read("a", "first", true)).toBe(pending);
    b.resolve(2); await Promise.resolve();
    expect(cache.snapshot("a", "second").data).toBe(2);
    expect(cache.snapshot("a", "first").refreshing).toBe(true);
    a.resolve("ready"); await all;
    await cache.read("a", "first"); expect(first).toHaveBeenCalledTimes(1);
  });

  it("bounds an abort-ignoring transport, retains stale data on timeout and permits retry", async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const stuck = deferred<string>(); const read = vi.fn((_accountId: string, _signal: AbortSignal) => stuck.promise);
    const cache = new SettingsResourceCache({ value: read }, { freshnessMs: 100, timeoutMs: 500 });
    cache.setAccount("a"); cache.remember("a", "value", "saved");
    const pending = cache.read("a", "value", true);
    expect(cache.snapshot("a", "value")).toMatchObject({ data: "saved", refreshing: true });
    await vi.advanceTimersByTimeAsync(501); await expect(pending).resolves.toBeUndefined();
    expect(cache.snapshot("a", "value")).toMatchObject({ data: "saved", refreshing: false, error: expect.stringContaining("too long") });
    expect(read.mock.calls[0]?.[1]?.aborted).toBe(true);
    stuck.resolve("late"); await Promise.resolve();
    expect(cache.snapshot("a", "value").data).toBe("saved");
    read.mockResolvedValueOnce("retried"); await cache.read("a", "value", true);
    expect(cache.snapshot("a", "value")).toMatchObject({ data: "retried", error: null });
  });

  it("keeps stale content on error and refreshes expired data without blocking", async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const read = vi.fn(async () => "first");
    const cache = new SettingsResourceCache({ value: read }, { freshnessMs: 100, timeoutMs: 500 }); cache.setAccount("a");
    await cache.read("a", "value"); await vi.advanceTimersByTimeAsync(101);
    read.mockRejectedValueOnce(new Error("Offline"));
    const pending = cache.read("a", "value");
    expect(cache.snapshot("a", "value")).toMatchObject({ data: "first", refreshing: true });
    await pending;
    expect(cache.snapshot("a", "value")).toMatchObject({ data: "first", error: "Offline", refreshing: false });
  });

  it("clears all resources across A→B→A and rejects reads and mutation completions from the old scope", async () => {
    const old = deferred<string>(); const read = vi.fn(() => old.promise);
    const cache = new SettingsResourceCache({ value: read }); cache.setAccount("a");
    const valid = cache.guard("a"); const pending = cache.read("a", "value");
    cache.setAccount("b");
    expect(cache.snapshot("a", "value").data).toBeUndefined();
    await expect(pending).resolves.toBeUndefined();
    expect(await cache.read("a", "value")).toBeUndefined();
    cache.setAccount("a"); old.resolve("private-old-value"); await Promise.resolve();
    expect(valid()).toBe(false); expect(cache.snapshot("a", "value").data).toBeUndefined();
    cache.remember("a", "value", "new-value"); cache.signOut("a"); cache.setAccount("a");
    expect(cache.isActive("a")).toBe(false);
    expect(cache.snapshot("a", "value").data).toBeUndefined();
    expect(await cache.read("a", "value")).toBeUndefined();
    cache.setAccount(null); cache.setAccount("a"); expect(cache.isActive("a")).toBe(true);
  });

  it("successful saves replace cached metadata and retire a pre-save response", async () => {
    const old = deferred<string>();
    const cache = new SettingsResourceCache({ value: () => old.promise }); cache.setAccount("a");
    const pending = cache.read("a", "value"); cache.remember("a", "value", "saved");
    await expect(pending).resolves.toBeUndefined();
    old.resolve("pre-save"); await Promise.resolve();
    expect(cache.snapshot("a", "value").data).toBe("saved");
  });

  it("mutation invalidation starts a new read and ignores the retired pre-mutation list", async () => {
    const old = deferred<string[]>(); const updated = deferred<string[]>();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(updated.promise);
    const cache = new SettingsResourceCache<{ list: string[] }>({ list: read }); cache.setAccount("a");
    cache.remember("a", "list", ["old"]);
    const before = cache.read("a", "list", true); const after = cache.invalidate("a", "list");
    expect(read).toHaveBeenCalledTimes(2); await expect(before).resolves.toBeUndefined();
    old.resolve(["obsolete"]); await Promise.resolve(); expect(cache.snapshot("a", "list").data).toEqual(["old"]);
    updated.resolve(["new"]); await after; expect(cache.snapshot("a", "list").data).toEqual(["new"]);
  });

  it("prefetches regular settings in parallel while leaving admin releases behind the authorization gate", async () => {
    const tokens = deferred<{ tokens: never[] }>();
    vi.mocked(api.getMe).mockResolvedValue({ signedIn: true, accountId: "a", name: null, email: null });
    vi.mocked(api.getAccount).mockResolvedValue({} as never);
    vi.mocked(api.getSettings).mockResolvedValue({ settings: { liveServerUrl: null } } as never);
    vi.mocked(api.getLive).mockResolvedValue({ enabled: false, devices: [] } as never);
    vi.mocked(api.listMcpTokens).mockReturnValue(tokens.promise);
    vi.mocked(api.listSkills).mockResolvedValue({ skills: [] });
    vi.mocked(api.getObservability).mockRejectedValue(new Error("Forbidden"));
    settingsResourceCache.setAccount("a"); const all = preloadSettingsResources("a");
    for (const read of [api.getMe, api.getAccount, api.getSettings, api.getLive, api.listMcpTokens, api.listSkills, api.getObservability]) expect(read).toHaveBeenCalledTimes(1);
    expect(api.getAppReleases).not.toHaveBeenCalled();
    await Promise.resolve(); await Promise.resolve();
    expect(settingsResourceCache.snapshot("a", "settings").data).toBeDefined();
    expect(settingsResourceCache.snapshot("a", "tokens").refreshing).toBe(true);
    expect(settingsResourceCache.snapshot("a", "observability").error).toBe("Forbidden");
    tokens.resolve({ tokens: [] }); await all;
  });
});
