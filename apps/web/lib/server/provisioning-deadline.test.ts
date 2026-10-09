import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForProvisioning } from "./provisioning-deadline";

afterEach(() => vi.useRealTimers());
describe("bounded tenant provisioning", () => {
  it("returns a successful quick provision and clears the deadline", async () => {
    vi.useFakeTimers();
    const retain = vi.fn();
    await expect(waitForProvisioning(Promise.resolve({ status: "active" }), retain)).resolves.toEqual({ status: "active" });
    expect(retain).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await expect(retain.mock.calls[0]![0]).resolves.toBeUndefined();
  });
  it("returns pending at 500ms while retained work runs to completion", async () => {
    vi.useFakeTimers();
    let finish!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { finish = resolve; });
    const retained: Promise<void>[] = [];
    const result = waitForProvisioning(pending, (work) => retained.push(work));
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBeNull();
    let completed = false;
    void retained[0]!.then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    finish("active");
    await retained[0];
    expect(completed).toBe(true);
  });
  it("propagates a quick failure and safely settles retained work", async () => {
    const retained: Promise<void>[] = [];
    await expect(waitForProvisioning(Promise.reject(new Error("remote unavailable")), (work) => retained.push(work))).rejects.toThrow("remote unavailable");
    await expect(retained[0]).resolves.toBeUndefined();
  });
  it("consumes a late rejection after the early response without restarting work", async () => {
    vi.useFakeTimers();
    let fail!: (error: Error) => void;
    const start = vi.fn(() => new Promise<string>((_resolve, reject) => { fail = reject; }));
    const retained: Promise<void>[] = [];
    const pending = start();
    const result = waitForProvisioning(pending, (work) => retained.push(work));
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBeNull();
    fail(new Error("remote failed"));
    await expect(retained[0]).resolves.toBeUndefined();
    expect(start).toHaveBeenCalledOnce();
  });
  it("retains the same deduplicated operation for concurrent requests", async () => {
    vi.useFakeTimers();
    let finish!: (value: string) => void;
    const start = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const pending = start();
    const retained: Promise<void>[] = [];
    const results = [waitForProvisioning(pending, (work) => retained.push(work)), waitForProvisioning(pending, (work) => retained.push(work))];
    await vi.advanceTimersByTimeAsync(500);
    expect(await Promise.all(results)).toEqual([null, null]);
    finish("active");
    await Promise.all(retained);
    expect(start).toHaveBeenCalledOnce();
    await expect(waitForProvisioning(pending, () => undefined)).resolves.toBe("active");
  });
});
