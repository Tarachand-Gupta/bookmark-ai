import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The dev-log network sink must be a no-op in PRODUCTION builds: a shipped
 * extension has no business POSTing diagnostics at whatever a user runs on
 * localhost:3000. The endpoint is derived from the inlined build mode at module
 * evaluation, so each case re-imports the module under a stubbed MODE.
 *
 * The `local:diagLog` storage mirror is out of scope here and is stubbed: after
 * `vi.resetModules()` the re-imported `@wxt-dev/storage` no longer sees the
 * fake browser the WXT test setup wired in, and its internal promise chain
 * rejects — noise unrelated to the sink under test.
 */
// `vi.mock` calls are hoisted above every other statement, so the shared factory
// must be hoisted too. `#imports` is rewritten by the WXT vitest plugin to the
// concrete module (`wxt/utils/storage` → `@wxt-dev/storage`), so the concrete ids
// are what must be mocked; the `#imports` alias is kept for safety.
const { storageStub } = vi.hoisted(() => ({
  storageStub: () => ({
    storage: {
      defineItem: () => ({
        getValue: async () => [],
        setValue: async () => {},
        removeValue: async () => {},
      }),
    },
  }),
}));
vi.mock("#imports", storageStub);
vi.mock("wxt/utils/storage", storageStub);
vi.mock("@wxt-dev/storage", storageStub);

async function loadDiag(mode: string) {
  vi.resetModules();
  vi.stubEnv("MODE", mode);
  return import("./diag");
}

describe("diag dev-log sink", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("never touches the network in a production build (endpoint is null)", async () => {
    const fetchSpy = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchSpy);
    const { diag, diagRing, DEV_LOG_ENDPOINT } = await loadDiag("production");
    expect(DEV_LOG_ENDPOINT).toBeNull();
    diag("bg", "boot"); // "bg" would flush immediately in a dev build
    diag("token", "sdk settled", { hasToken: false }); // other scopes flush after the debounce
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchSpy).not.toHaveBeenCalled();
    // The in-memory ring (and its storage mirror) still work — only the network sink is off.
    expect(diagRing().map((e) => e.msg)).toEqual(["boot", "sdk settled"]);
  });

  it.each(["development", "dev-remote"])("POSTs batches to the local dev server in %s mode", async (mode) => {
    const fetchSpy = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchSpy);
    const { diag, DEV_LOG_ENDPOINT } = await loadDiag(mode);
    expect(DEV_LOG_ENDPOINT).toBe("http://localhost:3000/api/dev/extension-log");
    diag("token", "sdk settled", { hasToken: false });
    expect(fetchSpy).not.toHaveBeenCalled(); // debounced
    await vi.advanceTimersByTimeAsync(1_500);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(DEV_LOG_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).entries).toHaveLength(1);
  });

  it("flushes bg-scope entries immediately in a dev build (event pages die fast)", async () => {
    const fetchSpy = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchSpy);
    const { diag } = await loadDiag("development");
    diag("bg", "boot");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
