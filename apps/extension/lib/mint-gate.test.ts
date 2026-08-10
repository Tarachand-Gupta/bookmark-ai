import { describe, expect, it, vi } from "vitest";
import { MINT_RETRY_BACKOFF_MS, MintGate } from "./mint-gate";

/**
 * The regression this class exists to prevent: the old guard was a boolean set
 * BEFORE the mint request, so one transient failure blocked every re-mint for the
 * lifetime of the background context — and Firefox MV2's background page lives as
 * long as the browser, so "for the lifetime" meant forever. A user in that state
 * could only recover by reinstalling or opening the web app.
 */
vi.mock("./diag", () => ({ diag: vi.fn() }));

const T0 = 1_000_000;

describe("MintGate", () => {
  it("lets the first attempt through", () => {
    expect(new MintGate("mint").blocked(T0)).toBe(false);
  });

  it("latches permanently on SUCCESS — one mint per context is the point", () => {
    const gate = new MintGate("mint");
    gate.succeeded();
    expect(gate.blocked(T0)).toBe(true);
    expect(gate.blocked(T0 + 365 * 86_400_000)).toBe(true);
  });

  it("does NOT latch on failure — it backs off and recovers", () => {
    const gate = new MintGate("mint");
    gate.failed(T0);

    expect(gate.blocked(T0)).toBe(true);
    expect(gate.blocked(T0 + MINT_RETRY_BACKOFF_MS - 1)).toBe(true);
    // The whole fix in one assertion: a failed mint is retryable.
    expect(gate.blocked(T0 + MINT_RETRY_BACKOFF_MS)).toBe(false);
  });

  it("re-arms the backoff on each successive failure", () => {
    const gate = new MintGate("mint");
    gate.failed(T0);
    expect(gate.blocked(T0 + MINT_RETRY_BACKOFF_MS)).toBe(false);
    gate.failed(T0 + MINT_RETRY_BACKOFF_MS);
    expect(gate.blocked(T0 + MINT_RETRY_BACKOFF_MS + 1)).toBe(true);
    expect(gate.blocked(T0 + 2 * MINT_RETRY_BACKOFF_MS)).toBe(false);
  });

  it("clears the backoff once a mint finally succeeds", () => {
    const gate = new MintGate("mint");
    gate.failed(T0);
    gate.succeeded();
    expect(gate.blocked(T0)).toBe(true); // blocked by the success latch, not the backoff
    gate.reset();
    expect(gate.blocked(T0)).toBe(false);
  });

  it("reset() opens the gate for a forced 401-recovery re-mint", () => {
    const successLatched = new MintGate("mint");
    successLatched.succeeded();
    successLatched.reset();
    expect(successLatched.blocked(T0)).toBe(false);

    const backedOff = new MintGate("mint");
    backedOff.failed(T0);
    backedOff.reset();
    expect(backedOff.blocked(T0)).toBe(false);
  });
});
