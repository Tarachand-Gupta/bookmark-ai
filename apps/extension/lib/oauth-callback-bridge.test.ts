import { afterEach, expect, it, vi } from "vitest";
import { connectOAuthCallbackPage, waitForOAuthCallbackBackground } from "./oauth-callback-bridge";
import { observeExtensionAuthorization } from "../../web/lib/extension-authorization-status";

afterEach(() => vi.useRealTimers());

it("warms a cold background after the first readiness transport failure and sends the callback once", async () => {
  vi.useFakeTimers();
  const document = new EventTarget();
  const ready = vi.fn().mockRejectedValueOnce(new Error("Cold port")).mockResolvedValue({ ok: true });
  const exchange = vi.fn().mockResolvedValue({ ok: true });
  const update = vi.fn();
  const dispose = observeExtensionAuthorization(document, update);
  connectOAuthCallbackPage(document, ready, exchange, vi.fn(), vi.fn());
  await vi.advanceTimersByTimeAsync(101);
  expect(update).toHaveBeenCalledWith("complete");
  expect(ready).toHaveBeenCalledTimes(2);
  expect(exchange).toHaveBeenCalledOnce();
  dispose();
});

it("bounds permanently stalled readiness probes and never sends the callback", async () => {
  vi.useFakeTimers();
  const document = new EventTarget();
  const ready = vi.fn(() => new Promise(() => {}));
  const exchange = vi.fn();
  const update = vi.fn();
  const dispose = observeExtensionAuthorization(document, update);
  connectOAuthCallbackPage(document, ready, exchange, vi.fn(), vi.fn());
  await vi.advanceTimersByTimeAsync(4801);
  expect(ready).toHaveBeenCalledTimes(3);
  expect(exchange).not.toHaveBeenCalled();
  expect(update).toHaveBeenCalledWith("unavailable");
  dispose();
});

it("does not retry a readiness denial", async () => {
  const ready = vi.fn().mockResolvedValue({ ok: false });
  expect(await waitForOAuthCallbackBackground(ready)).toBe(false);
  expect(ready).toHaveBeenCalledOnce();
});

it("replays an early completion after page hydration without sending the code again", async () => {
  vi.useFakeTimers();
  const document = new EventTarget();
  const send = vi.fn().mockResolvedValue({ ok: true });
  const scrub = vi.fn();
  const report = vi.fn();
  connectOAuthCallbackPage(document, vi.fn().mockResolvedValue({ ok: true }), send, scrub, report);
  await vi.waitFor(() => expect(scrub).toHaveBeenCalledOnce());
  const update = vi.fn();
  const dispose = observeExtensionAuthorization(document, update);
  expect(update).toHaveBeenLastCalledWith("complete");
  document.dispatchEvent(new Event("bookmark-extension-authorization-ready"));
  expect(send).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(15000);
  expect(update.mock.calls.every(([result]) => result === "complete")).toBe(true);
  dispose();
});

it("delivers completion when the page listener was ready before the bridge", async () => {
  const document = new EventTarget();
  const update = vi.fn();
  const dispose = observeExtensionAuthorization(document, update);
  connectOAuthCallbackPage(document, vi.fn().mockResolvedValue({ ok: true }), vi.fn().mockResolvedValue({ ok: true }), vi.fn(), vi.fn());
  await vi.waitFor(() => expect(update).toHaveBeenCalledWith("complete"));
  dispose();
});

it.each([false, undefined])("reports a rejected callback acknowledgement as failure: %s", async ok => {
  const document = new EventTarget();
  const update = vi.fn();
  const dispose = observeExtensionAuthorization(document, update);
  connectOAuthCallbackPage(document, vi.fn().mockResolvedValue({ ok: true }), vi.fn().mockResolvedValue({ ok }), vi.fn(), vi.fn());
  await vi.waitFor(() => expect(update).toHaveBeenCalledWith("failed"));
  dispose();
});

it("handles transport failure explicitly without retrying a single-use code", async () => {
  const document = new EventTarget();
  const update = vi.fn();
  const send = vi.fn().mockRejectedValue(new Error("Port closed with private callback URL"));
  const report = vi.fn();
  const dispose = observeExtensionAuthorization(document, update);
  connectOAuthCallbackPage(document, vi.fn().mockResolvedValue({ ok: true }), send, vi.fn(), report);
  await vi.waitFor(() => expect(update).toHaveBeenCalledWith("unavailable"));
  document.dispatchEvent(new Event("bookmark-extension-authorization-ready"));
  expect(send).toHaveBeenCalledOnce();
  expect(report.mock.calls).toEqual([["received"], ["ready"], ["unavailable"]]);
  dispose();
});
