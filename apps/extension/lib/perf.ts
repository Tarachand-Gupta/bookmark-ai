import { diag } from "./diag";

/**
 * Phase timing for one user-visible operation (a session save, a bookmark save).
 *
 * Latency complaints ("Save session takes a lot of time") are unfixable without a
 * breakdown: the same 4s wait can be token resolution, tab collection, the POST,
 * or the window close, and each has a different cure. A trace marks each phase as
 * it completes and emits ONE `diag("perf", …)` breadcrumb at the end — so the
 * numbers land in the dev log (lib/diag.ts) next to the auth breadcrumbs with no
 * browser console needed.
 *
 * `mark()` records the delta since the previous mark (not since the start), so a
 * trace reads as "where did the time go", and `totalMs` is the wall clock the user
 * actually felt. The clock is injectable so this is unit-testable.
 */
export class PerfTrace {
  private readonly t0: number;
  private last: number;
  private readonly phases: Record<string, number> = {};

  constructor(
    private readonly name: string,
    private readonly now: () => number = Date.now,
  ) {
    this.t0 = now();
    this.last = this.t0;
  }

  /** Close the phase that just finished; returns its duration in ms. */
  mark(label: string): number {
    const at = this.now();
    const delta = at - this.last;
    // A repeated label (a retry loop) accumulates rather than overwriting, so the
    // phases always sum to the total.
    this.phases[label] = (this.phases[label] ?? 0) + delta;
    this.last = at;
    return delta;
  }

  /** Wall clock since the trace started. */
  get totalMs(): number {
    return this.now() - this.t0;
  }

  /** Snapshot of the phases recorded so far. */
  snapshot(): Record<string, number> {
    return { ...this.phases };
  }

  /** Emit the breadcrumb. `extra` carries context (tab count, HTTP status, …). */
  end(extra?: Record<string, unknown>): { totalMs: number; phases: Record<string, number> } {
    const totalMs = this.totalMs;
    const phases = this.snapshot();
    diag("perf", this.name, { totalMs, phases, ...(extra ?? {}) });
    return { totalMs, phases };
  }
}

/** Time one awaited step and report its duration, without a whole trace. Only
 * logs when the step took at least `minMs` — the token path runs on every live
 * push too, and a 1ms storage read is not worth a breadcrumb. */
export async function timed<T>(
  name: string,
  minMs: number,
  fn: () => Promise<T>,
  detail?: (value: T, ms: number) => Record<string, unknown>,
): Promise<T> {
  const started = Date.now();
  const value = await fn();
  const ms = Date.now() - started;
  if (ms >= minMs) diag("perf", name, { ms, ...(detail?.(value, ms) ?? {}) });
  return value;
}
