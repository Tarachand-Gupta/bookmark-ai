import { scheduleOrganizationIndexing } from "@/lib/server/organization-indexing";
import { NextResponse, type NextRequest } from "next/server";
import { organizationOperationSchema } from "@bookmark-ai/types";
import { executeOrganizationOperation, listOrganizationOperations } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";
import { organizationErrorResponse } from "@/lib/server/organization-response";
export async function GET(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  await ctx.ready;
  const q = new URL(req.url).searchParams;
  const limit = Number(q.get("limit") ?? 50),
    offset = Number(q.get("offset") ?? 0);
  if (
    !Number.isInteger(limit) ||
    !Number.isInteger(offset) ||
    limit < 1 ||
    limit > 100 ||
    offset < 0
  )
    return NextResponse.json({ error: "Invalid pagination" }, { status: 400 });
  try {
    return NextResponse.json({
      operations: await listOrganizationOperations(ctx.db, limit, offset),
    });
  } catch (e) {
    return organizationErrorResponse(e);
  }
}
export async function POST(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  await ctx.ready;
  const parsed = organizationOperationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid operation" },
      { status: 400 },
    );
  try {
    const operation = await executeOrganizationOperation(ctx.db, parsed.data);
    scheduleOrganizationIndexing(ctx.db, ctx.gemini, operation);
    return NextResponse.json({ operation });
  } catch (e) {
    return organizationErrorResponse(e);
  }
}

export const maxDuration = 60;
