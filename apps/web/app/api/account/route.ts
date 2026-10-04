import { authMutationOriginAllowed } from "@/lib/server/auth-request-origin";
import { startAccountDeletion } from "@/lib/server/account-deletion";
import { withRequestLogging } from "@/lib/server/observability/request-logging";
import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { AccountResponse } from "@bookmark-ai/types";
import { resolveAccountPlan } from "@/lib/server/plan";
import { requireUser } from "@/lib/server/require-user";

// Authed, per-user — never statically cache.
export const dynamic = "force-dynamic";

/**
 * GET /api/account → { plan }. The caller's plan from the master `tenants.plan`
 * column; `"free"` (the only plan) in single-tenant/open mode. The feature copy
 * for a plan is `PLAN_FEATURES[plan]` in @bookmark-ai/types — clients render
 * from that, not from this response, so it can't drift between surfaces.
 */
async function GETHandler() {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  const body: AccountResponse = { plan: await resolveAccountPlan(gate.userId) };
  return NextResponse.json(body);
}

/**
 * Account deletion — the Apple-required primitive (mobile/web UI wires this up
 * later). Authed via the gate (needs a real Clerk user). Deleting the Clerk user
 * fires a `user.deleted` webhook, which is what actually tears down the tenant's
 * DB — this route only removes the identity.
 */
async function DELETEHandler(request:Request) {
  if(process.env.AUTH_PROVIDER==="supabase"&&!authMutationOriginAllowed(request))return NextResponse.json({error:"Invalid request origin"},{status:403});
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  // Open modes (keyless self-host / dev bypass) have no Clerk user to delete.
  if (!gate.userId) {
    return NextResponse.json({ error: "Not available in local mode" }, { status: 400 });
  }

  if (gate.identity) {
    if (Date.now()/1000 - gate.identity.authenticatedAt > 600) return NextResponse.json({error:"Sign in again before deleting your account",code:"reauth-required"},{status:403});
    try { await startAccountDeletion(gate.userId,gate.identity.providerUserId,gate.identity.sessionId); return NextResponse.json({ok:true},{status:202}); }
    catch { return NextResponse.json({error:"Account deletion pending; service temporarily unavailable",code:"deletion-pending"},{status:503}); }
  }
  const client = await clerkClient();
  await client.users.deleteUser(gate.userId);
  return NextResponse.json({ ok: true }, { status: 202 });
}

export const GET = withRequestLogging("/api/account", "GET", GETHandler);
export const DELETE = withRequestLogging("/api/account", "DELETE", DELETEHandler);
