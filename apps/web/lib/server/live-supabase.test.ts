import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
const state = vi.hoisted(() => ({ verify: vi.fn(), query: vi.fn() }));
vi.mock("@bookmark-ai/engine", async (original) => ({
  ...(await original<any>()),
  createSupabaseVerifier: () => state.verify,
}));
vi.mock("@bookmark-ai/db", async (original) => ({
  ...(await original<any>()),
  connectPostgres: () => ({ query: state.query }),
}));
import { InvalidSessionError, AuthUnavailableError } from "@bookmark-ai/engine";
import { makeAuthPreHandler } from "../../../../apps/live-server/src/auth";
import { registerStream } from "../../../../apps/live-server/src/routes/stream";
import { loadConfig } from "../../../../apps/live-server/src/config";

const config = {
  authProvider: "supabase",
  supabaseUrl: "https://qa.supabase.co",
  supabasePublishableKey: "qa",
  supabaseDatabaseUrl: "postgres://qa.invalid/test",
  supabaseExtensionClientIds: ["trusted"],
  allowedUserIds: [],
  authorizedParties: [],
  allowedOrigins: [],
  ttlHours: 24,
} as any;
beforeEach(() => {
  state.verify
    .mockReset()
    .mockResolvedValue({
      providerUserId: "provider",
      sessionId: "native",
      aal: "aal1",
      user: { id: "provider" },
    });
  state.query.mockReset().mockResolvedValue([{ id: "canonical" }]);
});
afterEach(() => vi.useRealTimers());
function reply() {
  const r = { status: 200, body: null as any, code: vi.fn(), send: vi.fn() };
  r.code.mockImplementation((n) => {
    r.status = n;
    return r;
  });
  r.send.mockImplementation((body) => {
    r.body = body;
    return r;
  });
  return r;
}
describe("Supabase Live request and stream gate", () => {
  it("maps the same canonical namespace and rechecks copied tokens on each request", async () => {
    const gate = makeAuthPreHandler(config),
      req = { headers: { authorization: "Bearer fake" }, ip: "qa-ip-one" } as any;
    await gate(req, reply() as any);
    expect(req.userId).toBe("canonical");
    expect(await req.revalidateSession()).toBe(true);
    state.verify.mockRejectedValueOnce(new InvalidSessionError());
    const denied = reply();
    await gate(req, denied as any);
    expect(denied.status).toBe(401);
    expect(state.verify).toHaveBeenCalledTimes(3);
  });
  it("distinguishes outage, denies unknown OAuth clients and never touches content routing", async () => {
    const gate = makeAuthPreHandler(config),
      req = { headers: { authorization: "Bearer fake" }, ip: "qa-ip-two" } as any;
    state.verify.mockRejectedValueOnce(new AuthUnavailableError());
    let r = reply();
    await gate(req, r as any);
    expect(r.status).toBe(503);
    expect(state.query).not.toHaveBeenCalled();
    state.verify.mockResolvedValueOnce({
      providerUserId: "provider",
      user: { id: "provider" },
      clientId: "untrusted",
    });
    r = reply();
    await gate(req, r as any);
    expect(r.status).toBe(401);
    expect(state.query).not.toHaveBeenCalled();
  });
  it("limits trusted extension to own publication/teardown and explicit account Live opt-in", async () => {
    const session = "d7bd59e9-47bc-4cf6-ac89-1bc3e6dc4bc7";
    state.verify.mockResolvedValue({
      providerUserId: "provider",
      sessionId: session,
      clientId: "trusted",
      aal: "aal1",
      user: { id: "provider" },
    });
    const gate = makeAuthPreHandler(config);
    for (const [method, url, body] of [
      ["GET", "/live", undefined],
      ["GET", "/live/stream", undefined],
      ["DELETE", "/live", undefined],
      ["DELETE", "/live/foreign-device", undefined],
      ["PATCH", `/live/${session}/settings`, { newWindowsShared: true }],
      ["POST", "/live", { deviceId: "another-device" }],
    ]) {
      state.query.mockClear();
      const r = reply();
      await gate(
        { headers: { authorization: "Bearer fake" }, ip: "qa-scope", method, url, body } as any,
        r as any,
      );
      expect(r.status).toBe(403);
      expect(state.query).not.toHaveBeenCalled();
    }
    for (const [method, url, body] of [
      ["POST", "/live", { deviceId: session }],
      ["DELETE", `/live/${session}`, undefined],
      ["POST", "/live/settings", { enabled: false }],
    ]) {
      const req = {
        headers: { authorization: "Bearer fake" },
        ip: "qa-scope",
        method,
        url,
        body,
      } as any;
      const r = reply();
      await gate(req, r as any);
      expect(r.status).toBe(200);
      expect(req.userId).toBe("canonical");
    }
  });
  it("closes a stream within 15 seconds of failed native validation and cleans up once", async () => {
    vi.useFakeTimers();
    let handler: any;
    const app = {
      get: (_path: any, _options: any, fn: any) => {
        handler = fn;
      },
    };
    const leave = vi.fn();
    registerStream(
      app as any,
      {
        config,
        auth: vi.fn(),
        store: { getEnabled: async () => true, listDevices: async () => [] },
        fanout: { join: () => leave },
      } as any,
    );
    const socket = new EventEmitter(),
      raw = { writeHead: vi.fn(), write: vi.fn(), end: vi.fn() };
    const validate = vi.fn().mockResolvedValue(false);
    await handler(
      { userId: "qa-stream-user", headers: {}, raw: socket, revalidateSession: validate },
      { hijack: vi.fn(), raw },
    );
    await vi.advanceTimersByTimeAsync(15000);
    expect(validate).toHaveBeenCalledOnce();
    expect(raw.end).toHaveBeenCalledOnce();
    expect(leave).toHaveBeenCalledOnce();
    socket.emit("close");
    expect(raw.end).toHaveBeenCalledOnce();
  });
  it("bounds stuck control-plane authorization to ten seconds", async () => {
    vi.useFakeTimers();
    state.query.mockImplementation(()=>new Promise(()=>{}));
    const r=reply();
    const pending=makeAuthPreHandler(config)({headers:{authorization:'Bearer fake'},ip:'deadline-test'} as any,r as any);
    await vi.advanceTimersByTimeAsync(10000);
    await pending;
    expect(r.status).toBe(503);
  });
  it.each([false,true])("closes never-resolving stream validation even when initial read hangs=%s", async(hangInitial)=>{
    vi.useFakeTimers();
    let handler:any;const leave=vi.fn(),join=vi.fn(()=>leave);
    registerStream({get:(_p:any,_o:any,fn:any)=>{handler=fn;}} as any,{
      config,auth:vi.fn(),store:{getEnabled:()=>hangInitial?new Promise(()=>{}):Promise.resolve(true),listDevices:async()=>[]},fanout:{join},
    } as any);
    const socket=new EventEmitter(),raw={writeHead:vi.fn(),write:vi.fn(),end:vi.fn()};
    const validate=vi.fn(()=>new Promise<boolean>(()=>{}));
    const pending=handler({userId:`stuck-${hangInitial}`,headers:{},raw:socket,revalidateSession:validate},{hijack:vi.fn(),raw});
    if(!hangInitial)await pending;
    await vi.advanceTimersByTimeAsync(25000);
    expect(validate).toHaveBeenCalledOnce();expect(raw.end).toHaveBeenCalledOnce();
    expect(join).toHaveBeenCalledTimes(hangInitial?0:1);
    socket.emit('close');expect(raw.end).toHaveBeenCalledOnce();
  });
  it("refuses QA open/Clerk fallback and missing native config at boot", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "test", BOOKMARK_BUILD_VARIANT: "supabase-qa", DEV_OPEN_API: "1" }),
    ).toThrow("native auth");
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        AUTH_PROVIDER: "supabase",
        BOOKMARK_BUILD_VARIANT: "supabase-qa",
        DEV_OPEN_API: "1",
      }),
    ).toThrow("configuration");
  });
});
