import { afterEach, expect, it, vi } from "vitest";
import { observeExtensionAuthorization } from "./extension-authorization-status";

afterEach(() => vi.useRealTimers());

it.each(["complete", "failed", "unavailable"])("does not overwrite the terminal result %s with the fallback timer", result => {
  vi.useFakeTimers();
  const document = new EventTarget();
  const update = vi.fn();
  const dispose = observeExtensionAuthorization(document, update);
  document.dispatchEvent(new CustomEvent("bookmark-extension-authorization", { detail: result }));
  vi.advanceTimersByTime(15000);
  expect(update.mock.calls).toEqual([[result]]);
  dispose();
});

it("does not treat missing bridge acknowledgement as failed authorization, and accepts a late result", () => {
  vi.useFakeTimers();
  const document = new EventTarget();
  const update = vi.fn();
  const dispose = observeExtensionAuthorization(document, update);
  vi.advanceTimersByTime(10000);
  expect(update).toHaveBeenLastCalledWith("unavailable");
  document.dispatchEvent(new CustomEvent("bookmark-extension-authorization", { detail: "complete" }));
  expect(update).toHaveBeenLastCalledWith("complete");
  dispose();
});

it("ignores malformed page events and removes the listener and timer on cleanup", () => {
  vi.useFakeTimers();
  const document = new EventTarget();
  const update = vi.fn();
  const dispose = observeExtensionAuthorization(document, update);
  for (const detail of [null, {}, "unknown", { status: "complete" }]) {
    document.dispatchEvent(new CustomEvent("bookmark-extension-authorization", { detail }));
  }
  expect(update).not.toHaveBeenCalled();
  dispose();
  document.dispatchEvent(new CustomEvent("bookmark-extension-authorization", { detail: "complete" }));
  vi.advanceTimersByTime(15000);
  expect(update).not.toHaveBeenCalled();
});
