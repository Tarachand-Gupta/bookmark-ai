import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authReportKey,
  buildAuthStateReport,
  NATIVE_APP_ID,
  NATIVE_REPORT_TIMEOUT_MS,
  reportAuthState,
  resetAuthReportDedupe,
  type AuthStateReport,
} from "./native-auth-report";

vi.mock("./diag", () => ({ diag: vi.fn() }));

const SAFARI = { browserName: "safari" } as const;

function recordingSender() {
  const calls: { app: string; msg: AuthStateReport }[] = [];
  const send = vi.fn(async (app: string, msg: AuthStateReport) => {
    calls.push({ app, msg });
    return { ok: true };
  });
  return { send, calls };
}

beforeEach(() => resetAuthReportDedupe());
afterEach(() => {
  vi.useRealTimers();
});

describe("native-auth-report: Safari only", () => {
  it("is a no-op on Chrome and Firefox — the sender is never touched", async () => {
    const { send } = recordingSender();
    expect(await reportAuthState({ signedIn: true, email: "a@b.c" }, {}, { browserName: "chrome", send })).toBe(
      "unsupported",
    );
    expect(await reportAuthState({ signedIn: true, email: "a@b.c" }, {}, { browserName: "firefox", send })).toBe(
      "unsupported",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("is a no-op when the browser exposes no sendNativeMessage (nativeMessaging absent)", async () => {
    expect(await reportAuthState({ signedIn: true, email: "a@b.c" }, {}, { ...SAFARI, send: null })).toBe(
      "unsupported",
    );
  });
});

describe("native-auth-report: dedupe", () => {
  it("sends once per boot, then skips identical state", async () => {
    const { send, calls } = recordingSender();
    const state = { signedIn: true, email: "tara@example.com", name: "Tara" };
    expect(await reportAuthState(state, {}, { ...SAFARI, send })).toBe("sent");
    expect(await reportAuthState(state, {}, { ...SAFARI, send })).toBe("skipped");
    expect(await reportAuthState({ ...state, name: "T." }, {}, { ...SAFARI, send })).toBe("skipped"); // name alone is not a state change
    expect(calls).toHaveLength(1);
    expect(calls[0]?.app).toBe(NATIVE_APP_ID);
    expect(calls[0]?.msg).toMatchObject({ type: "authState", signedIn: true, email: "tara@example.com", name: "Tara" });
  });

  it("re-sends when the state or the e-mail changes", async () => {
    const { send, calls } = recordingSender();
    expect(await reportAuthState({ signedIn: true, email: "a@x.io" }, {}, { ...SAFARI, send })).toBe("sent");
    expect(await reportAuthState({ signedIn: false }, {}, { ...SAFARI, send })).toBe("sent");
    expect(await reportAuthState({ signedIn: false, email: "ignored@x.io" }, {}, { ...SAFARI, send })).toBe(
      "skipped",
    ); // signed-out is one state
    expect(await reportAuthState({ signedIn: true, email: "b@x.io" }, {}, { ...SAFARI, send })).toBe("sent");
    expect(await reportAuthState({ signedIn: true, email: "B@X.IO " }, {}, { ...SAFARI, send })).toBe("skipped"); // case/space-insensitive
    expect(calls.map((c) => c.msg.signedIn)).toEqual([true, false, true]);
  });

  it("a signed-in report that later learns the e-mail goes out again", async () => {
    const { send, calls } = recordingSender();
    expect(await reportAuthState({ signedIn: true }, {}, { ...SAFARI, send })).toBe("sent"); // mint-success path
    expect(await reportAuthState({ signedIn: true, email: "a@x.io" }, {}, { ...SAFARI, send })).toBe("sent");
    expect(calls[0]?.msg.email).toBeUndefined();
    expect(calls[1]?.msg.email).toBe("a@x.io");
  });

  it("`force` re-sends an unchanged state (the 6h heartbeat)", async () => {
    const { send } = recordingSender();
    const state = { signedIn: true, email: "a@x.io" };
    await reportAuthState(state, {}, { ...SAFARI, send });
    expect(await reportAuthState(state, { force: true }, { ...SAFARI, send })).toBe("sent");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("dedupe memory is per boot", async () => {
    const { send } = recordingSender();
    await reportAuthState({ signedIn: true, email: "a@x.io" }, {}, { ...SAFARI, send });
    resetAuthReportDedupe();
    expect(await reportAuthState({ signedIn: true, email: "a@x.io" }, {}, { ...SAFARI, send })).toBe("sent");
  });
});

describe("native-auth-report: wire shape", () => {
  it("carries only type/signedIn/email/name/at — never a token or extra fields", () => {
    const at = new Date("2026-09-07T10:00:00.000Z");
    const leaky = {
      signedIn: true,
      email: "a@x.io",
      name: "A",
      token: "bkd_secret",
      deviceToken: { token: "bkd_secret" },
    } as unknown as Parameters<typeof buildAuthStateReport>[0];
    const report = buildAuthStateReport(leaky, at);
    expect(Object.keys(report).sort()).toEqual(["at", "email", "name", "signedIn", "type"]);
    expect(JSON.stringify(report)).not.toContain("bkd_");
    expect(report.at).toBe("2026-09-07T10:00:00.000Z");
  });

  it("a signed-out report carries no identity", () => {
    const report = buildAuthStateReport({ signedIn: false, email: "a@x.io", name: "A" });
    expect(Object.keys(report).sort()).toEqual(["at", "signedIn", "type"]);
  });

  it("omits null/empty e-mail and name", () => {
    const report = buildAuthStateReport({ signedIn: true, email: null, name: "" });
    expect(report).toEqual({ type: "authState", signedIn: true, at: report.at });
  });

  it("keys signed-out as one state and signed-in by e-mail", () => {
    expect(authReportKey({ signedIn: false })).toBe("out");
    expect(authReportKey({ signedIn: false, email: "x@y.z" })).toBe("out");
    expect(authReportKey({ signedIn: true, email: "X@Y.Z" })).toBe("in|x@y.z");
    expect(authReportKey({ signedIn: true })).toBe("in|");
  });
});

describe("native-auth-report: bounded and harmless", () => {
  it("a rejecting native host resolves 'failed' and does not latch the dedupe", async () => {
    const send = vi.fn(async () => {
      throw new Error("no native host");
    });
    expect(await reportAuthState({ signedIn: true, email: "a@x.io" }, {}, { ...SAFARI, send })).toBe("failed");
    expect(await reportAuthState({ signedIn: true, email: "a@x.io" }, {}, { ...SAFARI, send })).toBe("failed"); // retried, not skipped
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("a hung native host is cut off after the timeout", async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => new Promise<never>(() => {}));
    const pending = reportAuthState({ signedIn: true, email: "a@x.io" }, {}, { ...SAFARI, send });
    await vi.advanceTimersByTimeAsync(NATIVE_REPORT_TIMEOUT_MS + 1);
    expect(await pending).toBe("failed");
  });
});
