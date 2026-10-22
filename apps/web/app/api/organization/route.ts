import { NextResponse } from "next/server";
import { getOrganization } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";
import { organizationErrorResponse } from "@/lib/server/organization-response";
export async function GET() {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  await ctx.ready;
  try {
    return NextResponse.json(await getOrganization(ctx.db));
  } catch (e) {
    return organizationErrorResponse(e);
  }
}
