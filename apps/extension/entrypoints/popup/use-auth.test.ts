import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ states: [] as unknown[], effects: [] as (() => void | (() => void))[], index: 0, request: vi.fn() }));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = harness.index++;
    if (!(index in harness.states)) harness.states[index] = initial;
    return [harness.states[index], (value: unknown) => { harness.states[index] = value; }];
  },
  useEffect: (effect: () => void | (() => void)) => harness.effects.push(effect),
}));
vi.mock("@/lib/messages", () => ({ requestUser: harness.request }));
vi.mock("@/lib/diag", () => ({ diag: vi.fn() }));
vi.mock("wxt/browser", () => ({ browser: { runtime: {} } }));
import { degradedAuthNote, SIGNED_OUT, useAuth } from "./use-auth";

beforeEach(() => {
  vi.useFakeTimers(); harness.states = []; harness.effects = []; harness.index = 0; harness.request.mockReset();
  vi.stubGlobal("window", { setTimeout, clearTimeout, setInterval, clearInterval });
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("popup authentication recovery", () => {
  it("clears the boot warning when a delayed signed-out response finally arrives", async () => {
    let resolve!: (value: typeof SIGNED_OUT) => void;
    harness.request.mockReturnValue(new Promise(r => { resolve = r; }));
    useAuth(); const cleanup = harness.effects[0]!();
    await vi.advanceTimersByTimeAsync(5000);
    expect(harness.states[1]).toBe(true);
    resolve(SIGNED_OUT); await Promise.resolve();
    expect(harness.states[1]).toBe(false); expect(harness.states[0]).toEqual(SIGNED_OUT);
    cleanup?.();
  });
  it("clears an earlier warning when the signed-out poll recovers", async () => {
    harness.states = [SIGNED_OUT, true]; harness.request.mockResolvedValue(SIGNED_OUT);
    useAuth(); const cleanup = harness.effects[1]!();
    await vi.advanceTimersByTimeAsync(2000);
    expect(harness.states[1]).toBe(false); cleanup?.();
  });
  it("ignores a polling response after the popup unmounts", async () => {
    let resolve!: (value: typeof SIGNED_OUT) => void;
    harness.states = [SIGNED_OUT, true]; harness.request.mockReturnValue(new Promise(r => { resolve = r; }));
    useAuth(); const cleanup = harness.effects[1]!();
    await vi.advanceTimersByTimeAsync(2000); cleanup?.(); resolve(SIGNED_OUT); await Promise.resolve();
    expect(harness.states[1]).toBe(true);
  });
  it("gives separate-session Supabase guidance while preserving Clerk sync guidance", () => {
    expect(degradedAuthNote(true)).toContain("Reopen the popup");
    expect(degradedAuthNote(true)).not.toContain("syncs");
    expect(degradedAuthNote(false)).toContain("session still syncs");
  });
});
