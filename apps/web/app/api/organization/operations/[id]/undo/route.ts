import { scheduleOrganizationIndexing } from "@/lib/server/organization-indexing";
import { NextResponse, type NextRequest } from "next/server";
import { operationIdSchema } from "@bookmark-ai/types";
import { undoOrganizationOperation } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";
import { organizationErrorResponse } from "@/lib/server/organization-response";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  await ctx.ready;
  const body = await req.json().catch(() => null);
  const parsed = operationIdSchema.safeParse(body?.operationId);
  if (!parsed.success)
    return NextResponse.json({ error: "An operation ID is required" }, { status: 400 });
  try {
    const operation = await undoOrganizationOperation(ctx.db, (await params).id, parsed.data);
    scheduleOrganizationIndexing(ctx.db, ctx.gemini, operation);
    return NextResponse.json({ operation });
  } catch (e) {
    return organizationErrorResponse(e);
  }
}

export const maxDuration = 60;
