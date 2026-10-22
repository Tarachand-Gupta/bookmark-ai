import { NextResponse, type NextRequest } from "next/server";
import { chatContextSchema } from "@bookmark-ai/types";
import { resolveChatContext } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";
import { organizationErrorResponse } from "@/lib/server/organization-response";
export async function POST(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  await ctx.ready;
  const p = chatContextSchema.safeParse((await req.json().catch(() => null))?.context);
  if (!p.success) return NextResponse.json({ error: "Invalid context" }, { status: 400 });
  try {
    return NextResponse.json({ resolved: await resolveChatContext(ctx.db, p.data) });
  } catch (e) {
    return organizationErrorResponse(e);
  }
}
