import { withRequestLogging } from "@/lib/server/observability/request-logging";
import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { AUTHORIZED_PARTIES } from "@/lib/authorized-parties";
import { checkRateLimitWindow } from "@/lib/server/rate-limit";
import { trustedClientKey } from "@/lib/server/require-user";
import {
  MAC_AUTH_NO_STORE_HEADERS,
  MacAuthRequestError,
  MacAuthStoreUnavailableError,
  hashMacAuthValue,
  isTrustedMacAuthBrowserRequest,
  macAuthAuthorizeSchema,
  readLimitedJson,
  submitMacAuthBrowser,
} from "@/lib/server/macos-auth";

export const dynamic = "force-dynamic";

function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...MAC_AUTH_NO_STORE_HEADERS, ...extra } });
}

function allowedUser(userId: string): boolean {
  const allowed = (process.env.CLERK_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.length === 0 || allowed.includes(userId);
}

async function POSTHandler(request: NextRequest) {
  if(process.env.AUTH_PROVIDER === "supabase") return NextResponse.json({error:"Use native Supabase OAuth/PKCE",code:"native-auth-required"},{status:410});
  try {
    if (!isTrustedMacAuthBrowserRequest(request)) return json({ error: "Invalid request origin" }, 403);
    if (request.headers.has("authorization")) return json({ error: "Browser session required" }, 401);

    const ipRate = checkRateLimitWindow(
      `macos-auth:authorize:ip:${trustedClientKey(request.headers)}`,
      30,
      5 * 60_000,
    );
    if (!ipRate.allowed) {
      return json({ error: "Too many requests" }, 429, { "retry-after": String(ipRate.retryAfterSeconds) });
    }

    const parsed = macAuthAuthorizeSchema.safeParse(await readLimitedJson(request, 2_048));
    if (!parsed.success) return json({ error: "Invalid request" }, 400);
    const flowRate = checkRateLimitWindow(
      `macos-auth:authorize:flow:${hashMacAuthValue(parsed.data.flowId)}`,
      10,
      5 * 60_000,
    );
    if (!flowRate.allowed) {
      return json({ error: "Too many requests" }, 429, { "retry-after": String(flowRate.retryAfterSeconds) });
    }

    const { userId, sessionId, sessionClaims } = await auth();
    if (!userId || !sessionId) return json({ error: "Sign in before confirming" }, 401);
    const azp = (sessionClaims as { azp?: string } | null)?.azp;
    if (azp && !AUTHORIZED_PARTIES.includes(azp)) return json({ error: "Unauthorized token origin" }, 403);
    if (!allowedUser(userId)) return json({ error: "This account may not use this service" }, 403);

    const result = await submitMacAuthBrowser({
      ...parsed.data,
      clerkUserId: userId,
      clerkSessionId: sessionId,
    });
    switch (result) {
      case "approved":
        return json({ status: "approved" }, 200);
      case "canceled":
        return json({ status: "canceled" }, 200);
      case "expired":
        return json({ error: "This sign-in request expired" }, 410);
      case "not-pending":
        return json({ error: "This sign-in request is no longer pending" }, 409);
      case "invalid":
        return json({ error: "Invalid confirmation" }, 403);
      case "auth-changed":
        return json({ error: "The browser account changed. Reload this page and confirm the account again." }, 409);
    }
  } catch (error) {
    if (error instanceof MacAuthRequestError) return json({ error: error.message }, error.status);
    if (error instanceof MacAuthStoreUnavailableError) return json({ error: "Sign-in service unavailable" }, 503);
    console.error("[macos-auth/authorize] request failed");
    return json({ error: "Sign-in service unavailable" }, 503);
  }
}

export const POST = withRequestLogging("/api/macos-auth/authorize", "POST", POSTHandler);
