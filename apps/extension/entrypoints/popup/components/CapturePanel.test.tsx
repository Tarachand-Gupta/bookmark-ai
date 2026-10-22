import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Exercise the component's timer effect across storage-poll renders without a
// browser/DOM. Runtime focus, layout and popup teardown remain separate QA.
const h = vi.hoisted(() => ({
  states: [] as unknown[],
  index: 0,
  effects: [] as { run: () => void | (() => void); deps: unknown[] }[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => [h.states[h.index++] ?? initial, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
  useCallback: (value: unknown) => value,
  useEffect: (run: () => void | (() => void), deps: unknown[]) => h.effects.push({ run, deps }),
}));
vi.mock("@/lib/release-client", () => ({ releaseCommand: vi.fn() }));
import { CapturePanel } from "./CapturePanel";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout, close: vi.fn() });
  h.states = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function render(held = false, draft = false) {
  h.index = 0;
  h.effects = [];
  // Each background poll returns new objects, even when the receipt is unchanged.
  h.states = [
    {
      scope: { accountId: "fixture-account", origin: "https://app.test" },
      state: {
        job: {
          status: "succeeded",
          request: { kind: "save", input: { operationId: "saved-once" } },
        },
        ...(draft ? { ask: { text: "unsent" } } : {}),
      },
    },
    "main",
    undefined,
    undefined,
    undefined,
    false,
    false,
    "",
    held,
    true,
  ];
  CapturePanel({
    tab: { url: "https://page.test/", title: "Page" },
    webUrl: "https://app.test",
    saveRequest: 0,
    sessionBusy: false,
    onBusy: vi.fn(),
  });
  return h.effects.find((effect) => effect.deps[0] === true && effect.deps.includes("main"))!;
}
it("closes an untouched quick save despite one-second receipt polls", async () => {
  let effect = render();
  let cleanup = effect.run();
  await vi.advanceTimersByTimeAsync(1000);
  const next = render();
  if (!next.deps.every((value, index) => Object.is(value, effect.deps[index]))) {
    cleanup?.();
    cleanup = next.run();
  }
  await vi.advanceTimersByTimeAsync(200);
  expect(window.close).toHaveBeenCalledOnce();
  cleanup?.();
});
it.each([
  [true, false],
  [false, true],
])("keeps interaction or an unsent draft open (%s, %s)", async (held, draft) => {
  render(held, draft).run();
  await vi.advanceTimersByTimeAsync(5000);
  expect(window.close).not.toHaveBeenCalled();
});
