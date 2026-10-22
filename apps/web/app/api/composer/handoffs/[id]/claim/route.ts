import { NextResponse, type NextRequest } from "next/server";
import { claimComposerHandoff } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";
import { organizationErrorResponse } from "@/lib/server/organization-response";
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  await ctx.ready;
  try {
    return NextResponse.json({
      handoff: await claimComposerHandoff(ctx.db, ctx.userId ?? "local", (await params).id),
    });
  } catch (e) {
    return organizationErrorResponse(e);
  }
}
