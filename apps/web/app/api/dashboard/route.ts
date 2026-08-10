import { NextResponse, type NextRequest } from "next/server";
import { dashboardQuerySchema } from "@bookmark-ai/types";
import { getDashboard } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";

/**
 * GET /api/dashboard — the landing page's single aggregated read.
 *
 * A thin adapter over `getDashboard` in packages/engine (all logic lives there).
 *
 * AUTH: Clerk sessions only, by omission — `requireUser()` (via
 * getRequestApiContext) honors device tokens ONLY on the routes listed in
 * DEVICE_TOKEN_ROUTES, and this route is deliberately NOT one of them, so an
 * extension/device token 403s with `code: "token-scope"`. Don't add it there:
 * the dashboard is a whole-library read, exactly the capability those tokens are
 * scoped away from. MCP tokens are likewise confined to /api/mcp.
 *
 * `?device=<class>` is the caller's own device ("laptop", "mobile", …) and only
 * feeds `otherDeviceBookmarks` (the cross-device continue fallback).
 */
export async function GET(request: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;

  const parsed = dashboardQuerySchema.safeParse({
    device: request.nextUrl.searchParams.get("device") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  await ready;
  return NextResponse.json(await getDashboard(db, { device: parsed.data.device ?? null }));
}
