import { beforeEach, expect, it, vi } from "vitest";
const { values } = vi.hoisted(() => ({ values: new Map<string, unknown>() }));
vi.mock("#imports", () => ({
  storage: {
    defineItem(key: string, options: { fallback: unknown }) {
      return {
        getValue: async () => (values.has(key) ? values.get(key) : options.fallback),
        setValue: async (value: unknown) => {
          values.set(key, value);
        },
      };
    },
  },
}));
vi.mock("./diag", () => ({ diag: vi.fn() }));
import {
  enqueueMirrorAdd,
  drainMirrorQueue,
  queuedMirrorAdds,
  resetDrainGuard,
} from "./native-sync-queue";
beforeEach(() => {
  values.clear();
  resetDrainGuard();
});
it("stops an old-account drain after account switch and preserves newly queued work", async () => {
  await enqueueMirrorAdd({ url: "https://old.example/one" });
  await enqueueMirrorAdd({ url: "https://old.example/two" });
  let current = true;
  const send = vi.fn(async () => {
    current = false;
    values.clear();
    await enqueueMirrorAdd({ url: "https://new.example" });
    return false;
  });
  await drainMirrorQueue(send, () => current);
  expect(send).toHaveBeenCalledTimes(1);
  expect((await queuedMirrorAdds()).map((entry) => entry.url)).toEqual(["https://new.example"]);
});
it("does not send anything if its originating account is already gone", async () => {
  await enqueueMirrorAdd({ url: "https://old.example" });
  const send = vi.fn();
  await drainMirrorQueue(send, () => false);
  expect(send).not.toHaveBeenCalled();
});
