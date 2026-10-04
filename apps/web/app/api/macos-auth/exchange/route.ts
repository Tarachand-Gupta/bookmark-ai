import { withRequestLogging } from "@/lib/server/observability/request-logging";
import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimitWindow } from "@/lib/server/rate-limit";
import { trustedClientKey } from "@/lib/server/require-user";
import {
  MAC_AUTH_NO_STORE_HEADERS,
  MAC_AUTH_PENDING_RETRY_SECONDS,
  MAC_AUTH_TICKET_TTL_SECONDS,
  MacAuthRequestError,
  MacAuthStoreUnavailableError,
  consumeMacAuthBrowserFlow,
  hashMacAuthValue,
  macAuthExchangeSchema,
  readLimitedJson,
} from "@/lib/server/macos-auth";

export const dynamic = "force-dynamic";

function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...MAC_AUTH_NO_STORE_HEADERS, ...extra } });
}

async function POSTHandler(request: NextRequest) {
  if(process.env.AUTH_PROVIDER === "supabase") return NextResponse.json({error:"Use native Supabase OAuth/PKCE",code:"native-auth-required"},{status:410});
  const ipRate = checkRateLimitWindow(
    `macos-auth:exchange:ip:${trustedClientKey(request.headers)}`,
    600,
    10 * 60_000,
  );
  if (!ipRate.allowed) {
    return json({ error: "Too many requests" }, 429, { "retry-after": String(ipRate.retryAfterSeconds) });
  }

  try {
    const parsed = macAuthExchangeSchema.safeParse(await readLimitedJson(request, 2_048));
    if (!parsed.success) return json({ error: "Invalid request" }, 400);
    const flowRate = checkRateLimitWindow(
      `macos-auth:exchange:flow:${hashMacAuthValue(parsed.data.flowId)}`,
      180,
      10 * 60_000,
    );
    if (!flowRate.allowed) {
      return json({ error: "Too many requests" }, 429, { "retry-after": String(flowRate.retryAfterSeconds) });
    }

    const result = await consumeMacAuthBrowserFlow(parsed.data.flowId, parsed.data.verifier);
    switch (result.status) {
      case "pending":
        return json(
          { status: "pending", retryAfterSeconds: MAC_AUTH_PENDING_RETRY_SECONDS },
          202,
          { "retry-after": String(MAC_AUTH_PENDING_RETRY_SECONDS) },
        );
      case "invalid":
        return json({ error: "Invalid sign-in request" }, 404);
      case "expired":
        return json({ error: "This sign-in request expired" }, 410);
      case "canceled":
        return json({ error: "This sign-in request was canceled" }, 410);
      case "replayed":
        return json({ error: "This sign-in request was already used" }, 409);
      case "ready": {
        // The flow is consumed BEFORE this call. Any Clerk failure therefore
        // fails closed and cannot mint twice on a retry or concurrent exchange.
        try {
          const client = await clerkClient();
          const signInToken = await client.signInTokens.createSignInToken({
            userId: result.clerkUserId,
            expiresInSeconds: MAC_AUTH_TICKET_TTL_SECONDS,
          });
          return json(
            {
              status: "complete",
              ticket: signInToken.token,
              expiresAt: Date.now() + MAC_AUTH_TICKET_TTL_SECONDS * 1_000,
            },
            200,
          );
        } catch {
          console.error("[macos-auth/exchange] Clerk ticket mint failed after one-use consume");
          return json({ error: "Could not complete sign-in; start a new request" }, 502);
        }
      }
    }
  } catch (error) {
    if (error instanceof MacAuthRequestError) return json({ error: error.message }, error.status);
    if (error instanceof MacAuthStoreUnavailableError) return json({ error: "Sign-in service unavailable" }, 503);
    console.error("[macos-auth/exchange] request failed");
    return json({ error: "Sign-in service unavailable" }, 503);
  }
}

export const POST = withRequestLogging("/api/macos-auth/exchange", "POST", POSTHandler);
