import { after, type NextRequest } from "next/server";
import { propagateAttributes } from "@langfuse/tracing";
import { getMcpToken, getUserSettings, touchMcpToken, type Db } from "@bookmark-ai/db";
import { parseMcpToolAllowlist } from "@bookmark-ai/types";
import {
  getApiContext,
  getGemini,
  getTenantDb,
  isMultiTenant,
  MultiTenantConfigError,
  TenantNotProvisionedError,
} from "@/lib/server/context";
import {
  isMcpConfigured,
  MCP_TOKEN_PREFIX,
  verifyMcpToken,
} from "@/lib/server/mcp-token";
import { enforceMcpLimits } from "@/lib/server/mcp/limits";
import {
  dispatch,
  JSON_RPC,
  PREFERRED_PROTOCOL_VERSION,
  protocolError,
  SUPPORTED_PROTOCOL_VERSIONS,
  validateRpcBody,
} from "@/lib/server/mcp/protocol";
import { isClerkSubject } from "@/lib/server/mcp/subject";
import { enabledTools } from "@/lib/server/mcp/tools";
import { flushObservability } from "@/lib/server/observability/flush";
import { checkRateLimit } from "@/lib/server/rate-limit";

/**
 * POST /api/mcp — the Model Context Protocol endpoint (streamable HTTP,
 * stateless, plain JSON responses). See lib/server/mcp/protocol.ts for the wire
 * behavior and lib/server/mcp-token.ts for the credential.
 *
 * This route authenticates ITSELF and deliberately does NOT call requireUser():
 * an MCP client holds a `bkmcp_` token, not a Clerk session, and requireUser's
 * device-token scoping/allowlist semantics are a different policy. What it does
 * instead, in order: verify the token signature → resolve the caller's DB →
 * confirm the token's `jti` row exists and is not revoked → refresh last-used →
 * load the user's tool allowlist → tiered rate limit (inside tools/call only) →
 * dispatch.
 *
 * Node runtime: the token verifier uses node:crypto and the libSQL client is a
 * native-ish dependency.
 */
export const runtime = "nodejs";

/** Echo back a protocol version the client asked for if we speak it, else ours.
 * The spec wants this header on every response, including errors. */
function negotiatedVersion(req: NextRequest): string {
  const requested = req.headers.get("mcp-protocol-version");
  return requested && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : PREFERRED_PROTOCOL_VERSION;
}

function jsonResponse(
  body: unknown,
  status: number,
  version: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(body === null ? {} : { "content-type": "application/json" }),
      "mcp-protocol-version": version,
      ...extraHeaders,
    },
  });
}

/** 401 for a missing/invalid credential. `WWW-Authenticate` is what tells a
 * conforming MCP client this endpoint wants a bearer token at all. */
function unauthorized(version: string, message: string): Response {
  return jsonResponse({ error: message }, 401, version, {
    "www-authenticate": 'Bearer realm="bookmark-ai-mcp"',
  });
}

/** Rate-limit bucket key for the IP-level abuse guard. Mirrors require-user.ts:
 * Vercel's unspoofable header first, then the first XFF hop. */
function clientKey(req: NextRequest): string {
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim() || "unknown";
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * The DB a verified MCP subject reads/writes — the same routing api-context.ts
 * applies to a signed-in request, minus the Clerk gate (already done by the token
 * signature). Multi-tenant + a real Clerk subject → that user's tenant DB;
 * otherwise the shared/local DB.
 */
async function resolveDb(subject: string): Promise<{ db: Db; ready: Promise<void> }> {
  if (isMultiTenant() && isClerkSubject(subject)) return getTenantDb(subject);
  const { db, ready } = getApiContext();
  return { db, ready };
}

/** Refresh `last_used_at` at most once an hour: an agent can call this endpoint
 * dozens of times a minute and a write per call would cost far more than the
 * "last used" line in Settings is worth. */
const LAST_USED_REFRESH_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const version = negotiatedVersion(req);

  // Coarse per-IP abuse guard, before any DB work. Shared with the REST API's
  // limiter (per-instance, 120/60s) — the real per-user limits are below.
  if (!checkRateLimit(clientKey(req))) {
    return jsonResponse({ error: "Too many requests" }, 429, version);
  }

  if (!isMcpConfigured()) {
    // No signing secret → no token could ever be minted OR verified here. A 503
    // (not a 401) so a self-hoster sees a config problem, not a bad credential.
    return jsonResponse({ error: "MCP not configured" }, 503, version);
  }

  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!bearer.startsWith(MCP_TOKEN_PREFIX)) {
    return unauthorized(version, "Missing MCP bearer token");
  }
  const verified = verifyMcpToken(bearer);
  if (!verified) return unauthorized(version, "Invalid or expired token");

  let db: Db;
  let ready: Promise<void>;
  try {
    ({ db, ready } = await resolveDb(verified.userId));
  } catch (err) {
    if (err instanceof TenantNotProvisionedError) {
      return jsonResponse({ error: "Account not provisioned yet", code: "provisioning" }, 503, version);
    }
    if (err instanceof MultiTenantConfigError) {
      console.error("[mcp]", err.message);
      return jsonResponse({ error: "Account not provisioned yet", code: "provisioning" }, 503, version);
    }
    throw err;
  }
  await ready;

  // REVOCATION: a signature-valid token is not enough — its registry row must
  // still exist and be un-revoked. This is the only way to kill a leaked token
  // before its 365-day expiry.
  const record = await getMcpToken(db, verified.tokenId);
  if (!record || record.revokedAt) {
    return unauthorized(version, "This token has been revoked");
  }
  after(async () => {
    await touchMcpToken(
      db,
      verified.tokenId,
      new Date(Date.now() - LAST_USED_REFRESH_MS).toISOString(),
    ).catch((err: unknown) => {
      console.warn(`[mcp] last-used refresh failed: ${(err as Error).message}`);
    });
  });

  const settings = await getUserSettings(db, verified.userId);
  const tools = enabledTools(parseMcpToolAllowlist(settings?.mcpToolsJson ?? null));

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      protocolError(JSON_RPC.PARSE_ERROR, "Request body is not valid JSON"),
      200,
      version,
    );
  }

  const validated = validateRpcBody(body);
  if ("error" in validated) return jsonResponse(validated.error, 200, version);

  // In-request tool AI (search_bookmarks -> performSearch) is traced under the
  // same user; flush after the response for those spans.
  after(() => flushObservability());
  const outcome = await propagateAttributes(
    { userId: verified.userId, metadata: { route: "/api/mcp" } },
    () =>
      dispatch(validated.request, {
        tools,
        toolContext: {
          db,
          gemini: getGemini(),
          ready,
          // Post-response work (OG scrape, categorize, embed) rides Next's after()
          // exactly as POST /api/bookmarks does it — wrapped so any AI traces it
          // produces carry the token's user and reach Langfuse before a freeze.
          schedule: (work) =>
            after(async () => {
              await propagateAttributes(
                { userId: verified.userId, metadata: { route: "/api/mcp" } },
                work,
              );
              await flushObservability();
            }),
        },
        checkLimit: async () => {
          const verdict = await enforceMcpLimits(db);
          if (verdict.allowed) return { allowed: true };
          return {
            allowed: false,
            message: `Rate limit exceeded (${verdict.kind}): retry after ${verdict.retryAfterSeconds} seconds`,
          };
        },
      }),
  );

  // A notification gets 202 + empty body; everything else is a 200 JSON-RPC
  // response, INCLUDING protocol errors (JSON-RPC carries its own error object —
  // an HTTP error status would just confuse a client that reads the body).
  if (outcome.kind === "accepted") return jsonResponse(null, 202, version);
  return jsonResponse(outcome.body, 200, version);
}

/** This server is stateless: there is no SSE stream to open (GET) and no session
 * to terminate (DELETE). Both are refused with the methods that do exist. */
function methodNotAllowed(req: NextRequest): Response {
  return jsonResponse(
    { error: "Method not allowed — this MCP endpoint is stateless JSON-RPC over POST" },
    405,
    negotiatedVersion(req),
    { allow: "POST, OPTIONS" },
  );
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
