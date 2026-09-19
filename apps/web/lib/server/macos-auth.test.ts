import { createClient } from "@libsql/client";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeMacAuthFlow,
  consumeMacAuthFlow,
  createMacAuthFlow,
  getMacAuthFlow,
  issueMacAuthCsrf,
  MASTER_MIGRATIONS,
  purgeMacAuthFlows,
  runMigrations,
  type Db,
} from "@bookmark-ai/db";
import {
  configuredMacAuthOrigin,
  hashMacAuthValue,
  prepareMacAuthBrowser,
  readLimitedJson,
  verifierChallenge,
} from "./macos-auth";
import { checkRateLimitWindow } from "./rate-limit";
import { trustedClientKey } from "./require-user";

let db: Db;
let masterCtx: { db: Db; ready: Promise<void> } | null = null;
let browserAuth: { userId: string | null; sessionId: string | null; sessionClaims?: { azp?: string } | null } = {
  userId: "user_a",
  sessionId: "sess_a",
  sessionClaims: { azp: "http://localhost:3000" },
};
let ticketMint: (input: { userId: string; expiresInSeconds: number }) => Promise<{ token: string }> = async () => ({
  token: "ticket_test",
});

vi.mock("@/lib/server/context", () => ({ getMasterContext: () => masterCtx }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => browserAuth,
  clerkClient: async () => ({
    signInTokens: { createSignInToken: (input: { userId: string; expiresInSeconds: number }) => ticketMint(input) },
  }),
}));

const startRoute = await import("@/app/api/macos-auth/start/route");
const authorizeRoute = await import("@/app/api/macos-auth/authorize/route");
const exchangeRoute = await import("@/app/api/macos-auth/exchange/route");

const NOW = 1_790_000_000_000;
const FLOW = "f".repeat(43);
const VERIFIER = "v".repeat(43);
const CHALLENGE = verifierChallenge(VERIFIER);
const CSRF = "c".repeat(43);

beforeAll(async () => {
  db = createClient({ url: ":memory:" }) as unknown as Db;
  await runMigrations(db, MASTER_MIGRATIONS);
});

afterAll(() => (db as unknown as { close(): void }).close());

beforeEach(async () => {
  masterCtx = { db, ready: Promise.resolve() };
  browserAuth = { userId: "user_a", sessionId: "sess_a", sessionClaims: { azp: "http://localhost:3000" } };
  ticketMint = async () => ({ token: "ticket_test" });
  vi.stubEnv("MACOS_AUTH_APP_ORIGIN", "http://localhost:3000");
  vi.stubEnv("CLERK_ALLOWED_USER_IDS", "");
  await db.execute("DELETE FROM macos_auth_flows");
});

afterEach(() => vi.unstubAllEnvs());

function request(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": `test-${crypto.randomUUID()}`,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function browserRequest(body: unknown, headers: Record<string, string> = {}) {
  return request("/api/macos-auth/authorize", body, {
    origin: "http://localhost:3000",
    "sec-fetch-site": "same-origin",
    ...headers,
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
  expect(response.headers.get("pragma")).toBe("no-cache");
}

async function seed(state: "pending" | "approved" = "pending", now = NOW) {
  await createMacAuthFlow(db, {
    flowId: FLOW,
    codeChallenge: CHALLENGE,
    verificationCode: "ABCD-EFGH",
    createdAt: now,
    expiresAt: now + 600_000,
  });
  if (state === "approved") {
    await issueMacAuthCsrf(db, FLOW, hashMacAuthValue(CSRF), "user_a", "sess_a", now);
    expect(
      await authorizeMacAuthFlow(db, {
        flowId: FLOW,
        csrfHash: hashMacAuthValue(CSRF),
        clerkUserId: "user_a",
        clerkSessionId: "sess_a",
        action: "approve",
        now,
      }),
    ).toBe("approved");
  }
}

describe("durable macOS auth flow", () => {
  it("runs the additive migration and binds approval to the rendered user and session", async () => {
    await seed();
    await issueMacAuthCsrf(db, FLOW, hashMacAuthValue(CSRF), "user_a", "sess_a", NOW);

    const stale = await authorizeMacAuthFlow(db, {
      flowId: FLOW,
      csrfHash: hashMacAuthValue(CSRF),
      clerkUserId: "user_b",
      clerkSessionId: "sess_b",
      action: "approve",
      now: NOW,
    });
    expect(stale).toBe("auth-changed");
    expect((await getMacAuthFlow(db, FLOW))?.state).toBe("pending");

    const approved = await authorizeMacAuthFlow(db, {
      flowId: FLOW,
      csrfHash: hashMacAuthValue(CSRF),
      clerkUserId: "user_a",
      clerkSessionId: "sess_a",
      action: "approve",
      now: NOW,
    });
    expect(approved).toBe("approved");
    expect((await getMacAuthFlow(db, FLOW))?.csrfHash).toBeNull();
  });

  it("rejects wrong verifiers and expiry without consuming", async () => {
    await seed("approved");
    expect(await consumeMacAuthFlow(db, { flowId: FLOW, codeChallenge: "x".repeat(43), now: NOW })).toEqual({
      status: "invalid",
    });
    expect(await consumeMacAuthFlow(db, { flowId: FLOW, codeChallenge: CHALLENGE, now: NOW + 600_000 })).toEqual({
      status: "expired",
    });
    expect((await getMacAuthFlow(db, FLOW))?.state).toBe("approved");
  });

  it("allows exactly one concurrent consume and classifies the loser as replay", async () => {
    await seed("approved");
    const results = await Promise.all([
      consumeMacAuthFlow(db, { flowId: FLOW, codeChallenge: CHALLENGE, now: NOW + 1 }),
      consumeMacAuthFlow(db, { flowId: FLOW, codeChallenge: CHALLENGE, now: NOW + 1 }),
    ]);
    expect(results.filter((result) => result.status === "ready")).toHaveLength(1);
    expect(results.filter((result) => result.status === "replayed")).toHaveLength(1);
  });

  it("retains recent terminal evidence while purging rows outside retention", async () => {
    await seed("approved", NOW - 1_000);
    await consumeMacAuthFlow(db, { flowId: FLOW, codeChallenge: CHALLENGE, now: NOW });
    expect(await purgeMacAuthFlows(db, NOW + 60_000, 86_400_000)).toBe(0);
    expect((await getMacAuthFlow(db, FLOW))?.state).toBe("consumed");
    expect(await purgeMacAuthFlows(db, NOW + 86_400_001, 86_400_000)).toBe(1);
  });
});

describe("strict public request handling", () => {
  it("uses a bounded sliding window with an actionable Retry-After", () => {
    const key = `macos-auth:test:${crypto.randomUUID()}`;
    expect(checkRateLimitWindow(key, 2, 10_000, 1_000)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(checkRateLimitWindow(key, 2, 10_000, 2_000)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(checkRateLimitWindow(key, 2, 10_000, 3_000)).toEqual({ allowed: false, retryAfterSeconds: 8 });
  });

  it("ignores spoofable forwarding headers for production rate-limit keys", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(trustedClientKey(new Headers({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.10" }))).toBe(
      "unknown",
    );
    expect(trustedClientKey(new Headers({ "x-vercel-forwarded-for": "198.51.100.7, 10.0.0.1" }))).toBe(
      "198.51.100.7",
    );
  });

  it("stops a streamed JSON body at the byte cap before buffering the remainder", async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{\"padding\":\""));
        controller.enqueue(new Uint8Array(32));
        controller.enqueue(new Uint8Array(10_000));
      },
      cancel() {
        canceled = true;
      },
    });
    const streamed = new Request("http://localhost/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      // Node's Request requires this for streaming uploads; it is not part of
      // the browser RequestInit type used by Next.
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readLimitedJson(streamed, 16)).rejects.toMatchObject({ status: 413 });
    expect(canceled).toBe(true);
  });

  it("derives the browser URL from configured allowlisted origin, never Host", async () => {
    const response = await startRoute.POST(
      request("/api/macos-auth/start", { codeChallenge: CHALLENGE }, { host: "attacker.example" }),
    );
    expect(response.status).toBe(201);
    expectNoStore(response);
    const body = (await response.json()) as { browserUrl: string; flowId: string; verificationCode: string };
    const url = new URL(body.browserUrl);
    expect(url.origin).toBe("http://localhost:3000");
    expect(url.hostname).not.toBe("attacker.example");
    expect(url.searchParams.get("flow")).toBe(body.flowId);
    expect(body.verificationCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("preparing the browser GET only issues confirmation state and never approves", async () => {
    await seed("pending", Date.now());
    const prepared = await prepareMacAuthBrowser(FLOW, "user_a", "sess_a");
    expect(prepared.status).toBe("pending");
    const stored = await getMacAuthFlow(db, FLOW);
    expect(stored?.state).toBe("pending");
    expect(stored?.clerkUserId).toBeNull();
    expect(stored?.csrfUserId).toBe("user_a");
    expect(stored?.csrfSessionId).toBe("sess_a");
  });

  it("rejects bearer authorization and unauthenticated or cross-origin approval", async () => {
    await seed();
    await issueMacAuthCsrf(db, FLOW, hashMacAuthValue(CSRF), "user_a", "sess_a", NOW);
    const body = { flowId: FLOW, csrfToken: CSRF, action: "approve" };

    for (const authorization of ["Bearer bkd_extension", "Bearer clerk_session_jwt"]) {
      const bearer = await authorizeRoute.POST(browserRequest(body, { authorization }));
      expect(bearer.status).toBe(401);
      expectNoStore(bearer);
    }

    browserAuth = { userId: null, sessionId: null };
    const anonymous = await authorizeRoute.POST(browserRequest(body));
    expect(anonymous.status).toBe(401);

    const crossOrigin = await authorizeRoute.POST(
      browserRequest(body, { origin: "https://attacker.example", "sec-fetch-site": "cross-site" }),
    );
    expect(crossOrigin.status).toBe(403);
    expect((await getMacAuthFlow(db, FLOW))?.state).toBe("pending");
  });

  it("preserves the existing Clerk azp allowlist", async () => {
    await seed("pending", Date.now());
    await issueMacAuthCsrf(db, FLOW, hashMacAuthValue(CSRF), "user_a", "sess_a", Date.now());
    browserAuth = { userId: "user_a", sessionId: "sess_a", sessionClaims: { azp: "https://attacker.example" } };

    const response = await authorizeRoute.POST(
      browserRequest({ flowId: FLOW, csrfToken: CSRF, action: "approve" }),
    );
    expect(response.status).toBe(403);
    expectNoStore(response);
    expect((await getMacAuthFlow(db, FLOW))?.state).toBe("pending");
  });

  it("rejects a stale confirmation after the browser account changes", async () => {
    await seed();
    await issueMacAuthCsrf(db, FLOW, hashMacAuthValue(CSRF), "user_a", "sess_a", Date.now());
    browserAuth = { userId: "user_b", sessionId: "sess_b" };

    const response = await authorizeRoute.POST(
      browserRequest({ flowId: FLOW, csrfToken: CSRF, action: "approve" }),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "The browser account changed. Reload this page and confirm the account again.",
    });
    expect((await getMacAuthFlow(db, FLOW))?.state).toBe("pending");
  });

  it("rejects a wrong CSRF token without changing the flow", async () => {
    await seed("pending", Date.now());
    await issueMacAuthCsrf(db, FLOW, hashMacAuthValue(CSRF), "user_a", "sess_a", Date.now());

    const response = await authorizeRoute.POST(
      browserRequest({ flowId: FLOW, csrfToken: "z".repeat(43), action: "approve" }),
    );
    expect(response.status).toBe(403);
    expectNoStore(response);
    expect((await getMacAuthFlow(db, FLOW))?.state).toBe("pending");
  });
});

describe("route exchange", () => {
  it("returns pending with Retry-After and no-store", async () => {
    await seed("pending", Date.now());
    const response = await exchangeRoute.POST(request("/api/macos-auth/exchange", { flowId: FLOW, verifier: VERIFIER }));
    expect(response.status).toBe(202);
    expect(response.headers.get("retry-after")).toBe("2");
    expectNoStore(response);
  });

  it("mints one 60-second Clerk ticket and rejects replay", async () => {
    await seed("approved", Date.now());
    const calls: Array<{ userId: string; expiresInSeconds: number }> = [];
    ticketMint = async (input) => {
      calls.push(input);
      return { token: "ticket_once" };
    };
    const body = { flowId: FLOW, verifier: VERIFIER };

    const completed = await exchangeRoute.POST(request("/api/macos-auth/exchange", body));
    expect(completed.status).toBe(200);
    expectNoStore(completed);
    await expect(completed.json()).resolves.toMatchObject({ status: "complete", ticket: "ticket_once" });
    expect(calls).toEqual([{ userId: "user_a", expiresInSeconds: 60 }]);

    const replay = await exchangeRoute.POST(request("/api/macos-auth/exchange", body));
    expect(replay.status).toBe(409);
    expectNoStore(replay);
    expect(calls).toHaveLength(1);
  });

  it("fails closed when Clerk ticket minting fails", async () => {
    await seed("approved", Date.now());
    ticketMint = async () => {
      throw new Error("Clerk unavailable");
    };
    const body = { flowId: FLOW, verifier: VERIFIER };
    const failed = await exchangeRoute.POST(request("/api/macos-auth/exchange", body));
    expect(failed.status).toBe(502);
    expectNoStore(failed);

    const replay = await exchangeRoute.POST(request("/api/macos-auth/exchange", body));
    expect(replay.status).toBe(409);
  });
});

describe("configuredMacAuthOrigin", () => {
  it("requires an exact allowlisted HTTPS origin in production", () => {
    expect(
      configuredMacAuthOrigin({ NODE_ENV: "production", MACOS_AUTH_APP_ORIGIN: "https://www.bookmark-ai.cloud" }),
    ).toBe("https://www.bookmark-ai.cloud");
    expect(() =>
      configuredMacAuthOrigin({ NODE_ENV: "production", MACOS_AUTH_APP_ORIGIN: "http://localhost:3000" }),
    ).toThrow(/HTTPS/);
    expect(() =>
      configuredMacAuthOrigin({ NODE_ENV: "production", MACOS_AUTH_APP_ORIGIN: "https://attacker.example" }),
    ).toThrow(/allowlisted/);
  });
});
