import { beforeEach, afterEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ send: vi.fn(), close: vi.fn() }));
vi.mock("@/lib/supabase-oauth", () => ({ SUPABASE_AUTH: true }));
vi.mock("wxt/browser", () => ({ browser: { runtime: { sendMessage: harness.send } } }));
import { openSignIn } from "./nav";

beforeEach(() => { harness.send.mockReset(); harness.close.mockReset(); vi.stubGlobal("window", { close: harness.close }); });
afterEach(() => vi.unstubAllGlobals());

it("keeps the popup message port alive until the background acknowledges authorization", async () => {
  let acknowledge!: (value: { ok: boolean }) => void;
  harness.send.mockReturnValue(new Promise(resolve => { acknowledge = resolve; }));
  const opening = openSignIn("https://www.bookmark-ai.cloud");
  expect(harness.send).toHaveBeenCalledWith({ type: "START_OAUTH" });
  expect(harness.close).not.toHaveBeenCalled();
  acknowledge({ ok: true });
  await opening;
  expect(harness.close).toHaveBeenCalledOnce();
});

it.each([undefined, { ok: false }])("keeps the popup available for a failed acknowledgement %s", async response => {
  harness.send.mockResolvedValue(response);
  await expect(openSignIn("https://www.bookmark-ai.cloud")).rejects.toThrow("Could not open authorization");
  expect(harness.close).not.toHaveBeenCalled();
});

it("keeps the popup available when the message transport rejects", async () => {
  harness.send.mockRejectedValue(new Error("Port closed"));
  await expect(openSignIn("https://www.bookmark-ai.cloud")).rejects.toThrow("Port closed");
  expect(harness.close).not.toHaveBeenCalled();
});
