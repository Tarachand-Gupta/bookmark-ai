import { NextResponse, type NextRequest } from "next/server";
import { getOrganizationOperation } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  await ctx.ready;
  const operation = await getOrganizationOperation(ctx.db, (await params).id);
  return operation
    ? NextResponse.json({ operation })
    : NextResponse.json(
        { error: "Operation not found", code: "operation-not-found" },
        { status: 404 },
      );
}
