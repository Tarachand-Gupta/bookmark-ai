import { beforeEach, describe, expect, it, vi } from "vitest";

const diag = vi.fn();
vi.mock("./diag", () => ({ diag: (...args: unknown[]) => diag(...args) }));

const { PerfTrace, timed } = await import("./perf");

/** A controllable clock so phase math is asserted, not sampled. */
function fakeClock(start = 1000) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("PerfTrace", () => {
  beforeEach(() => diag.mockClear());

  it("records each phase as the delta since the previous mark", () => {
    const clock = fakeClock();
    const trace = new PerfTrace("save", clock.now);
    clock.advance(20);
    expect(trace.mark("gatherTabs")).toBe(20);
    clock.advance(300);
    expect(trace.mark("save")).toBe(300);
    expect(trace.snapshot()).toEqual({ gatherTabs: 20, save: 300 });
  });

  it("totalMs is the wall clock since construction", () => {
    const clock = fakeClock();
    const trace = new PerfTrace("save", clock.now);
    clock.advance(75);
    trace.mark("a");
    clock.advance(25);
    expect(trace.totalMs).toBe(100);
  });

  it("phases sum to the total even when a label repeats (a retry)", () => {
    const clock = fakeClock();
    const trace = new PerfTrace("save", clock.now);
    clock.advance(10);
    trace.mark("attempt");
    clock.advance(30);
    trace.mark("attempt");
    const { totalMs, phases } = trace.end();
    expect(phases).toEqual({ attempt: 40 });
    expect(totalMs).toBe(40);
  });

  it("end() emits ONE diag breadcrumb carrying the phases and the extra context", () => {
    const clock = fakeClock();
    const trace = new PerfTrace("session save (bg)", clock.now);
    clock.advance(5);
    trace.mark("gatherTabs");
    clock.advance(400);
    trace.mark("save");
    trace.end({ tabs: 37, keepOpen: true });
    expect(diag).toHaveBeenCalledTimes(1);
    expect(diag).toHaveBeenCalledWith("perf", "session save (bg)", {
      totalMs: 405,
      phases: { gatherTabs: 5, save: 400 },
      tabs: 37,
      keepOpen: true,
    });
  });

  it("snapshot() is a copy — later marks don't mutate an earlier snapshot", () => {
    const clock = fakeClock();
    const trace = new PerfTrace("save", clock.now);
    clock.advance(10);
    trace.mark("a");
    const snap = trace.snapshot();
    clock.advance(10);
    trace.mark("b");
    expect(snap).toEqual({ a: 10 });
  });
});

describe("timed", () => {
  beforeEach(() => diag.mockClear());

  it("returns the wrapped value", async () => {
    await expect(timed("x", 0, async () => "value")).resolves.toBe("value");
  });

  it("stays silent below the reporting threshold", async () => {
    await timed("token resolve", 10_000, async () => "fast");
    expect(diag).not.toHaveBeenCalled();
  });

  it("reports with the caller's detail once the step is slow enough", async () => {
    await timed(
      "token resolve",
      0,
      async () => "tok",
      (value) => ({ hasToken: !!value }),
    );
    expect(diag).toHaveBeenCalledTimes(1);
    const [scope, msg, data] = diag.mock.calls[0]!;
    expect(scope).toBe("perf");
    expect(msg).toBe("token resolve");
    expect(data).toMatchObject({ hasToken: true });
    expect(typeof (data as { ms: number }).ms).toBe("number");
  });

  it("does not swallow a rejection", async () => {
    await expect(
      timed("boom", 0, async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
    expect(diag).not.toHaveBeenCalled();
  });
});
