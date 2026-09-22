import { withRequestLogging } from "@/lib/server/observability/request-logging";
import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimitWindow } from "@/lib/server/rate-limit";
import { trustedClientKey } from "@/lib/server/require-user";
import {
  MAC_AUTH_NO_STORE_HEADERS,
  MacAuthRequestError,
  MacAuthStoreUnavailableError,
  macAuthStartSchema,
  readLimitedJson,
  startMacAuthFlow,
} from "@/lib/server/macos-auth";

export const dynamic = "force-dynamic";

function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...MAC_AUTH_NO_STORE_HEADERS, ...extra } });
}

async function POSTHandler(request: NextRequest) {
  const rate = checkRateLimitWindow(`macos-auth:start:ip:${trustedClientKey(request.headers)}`, 10, 5 * 60_000);
  if (!rate.allowed) {
    return json({ error: "Too many requests" }, 429, { "retry-after": String(rate.retryAfterSeconds) });
  }

  try {
    const parsed = macAuthStartSchema.safeParse(await readLimitedJson(request, 1_024));
    if (!parsed.success) return json({ error: "Invalid request" }, 400);
    return json(await startMacAuthFlow(parsed.data.codeChallenge), 201);
  } catch (error) {
    if (error instanceof MacAuthRequestError) return json({ error: error.message }, error.status);
    if (error instanceof MacAuthStoreUnavailableError) return json({ error: "Sign-in service unavailable" }, 503);
    console.error("[macos-auth/start] request failed");
    return json({ error: "Sign-in service unavailable" }, 503);
  }
}

export const POST = withRequestLogging("/api/macos-auth/start", "POST", POSTHandler);
