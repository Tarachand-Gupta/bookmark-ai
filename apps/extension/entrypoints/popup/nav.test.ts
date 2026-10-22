import { beforeEach, afterEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ send: vi.fn(), close: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/supabase-oauth", () => ({ SUPABASE_AUTH: true }));
vi.mock("wxt/browser", () => ({
  browser: { runtime: { sendMessage: harness.send }, tabs: { create: harness.create } },
}));
import { openSignIn, openBookmark } from "./nav";

beforeEach(() => {
  harness.send.mockReset();
  harness.close.mockReset();
  vi.stubGlobal("window", { close: harness.close });
});
afterEach(() => vi.unstubAllGlobals());

it("keeps the popup message port alive until the background acknowledges authorization", async () => {
  let acknowledge!: (value: { ok: boolean }) => void;
  harness.send.mockReturnValue(
    new Promise((resolve) => {
      acknowledge = resolve;
    }),
  );
  const opening = openSignIn("https://www.bookmark-ai.cloud");
  expect(harness.send).toHaveBeenCalledWith({ type: "START_OAUTH" });
  expect(harness.close).not.toHaveBeenCalled();
  acknowledge({ ok: true });
  await opening;
  expect(harness.close).toHaveBeenCalledOnce();
});

it.each([undefined, { ok: false }])(
  "keeps the popup available for a failed acknowledgement %s",
  async (response) => {
    harness.send.mockResolvedValue(response);
    await expect(openSignIn("https://www.bookmark-ai.cloud")).rejects.toThrow(
      "Could not open authorization",
    );
    expect(harness.close).not.toHaveBeenCalled();
  },
);

it("keeps the popup available when the message transport rejects", async () => {
  harness.send.mockRejectedValue(new Error("Port closed"));
  await expect(openSignIn("https://www.bookmark-ai.cloud")).rejects.toThrow("Port closed");
  expect(harness.close).not.toHaveBeenCalled();
});

it("does not close the popup until item navigation acknowledges a real tab", async () => {
  let acknowledge!: (tab: { id: number }) => void;
  harness.create.mockReturnValue(
    new Promise((resolve) => {
      acknowledge = resolve;
    }),
  );
  const opening = openBookmark("https://app.test", "id with spaces");
  expect(harness.close).not.toHaveBeenCalled();
  expect(harness.create).toHaveBeenCalledWith({
    url: "https://app.test/app/library?bookmark=id%20with%20spaces",
  });
  acknowledge({ id: 42 });
  await opening;
  expect(harness.close).toHaveBeenCalledOnce();
});
it("surfaces a failed item tab open while leaving the popup intact", async () => {
  harness.create.mockRejectedValue(new Error("Browser denied tab"));
  await expect(openBookmark("https://app.test", "id")).rejects.toThrow("Browser denied tab");
  expect(harness.close).not.toHaveBeenCalled();
});
