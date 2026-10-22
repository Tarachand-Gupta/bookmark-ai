import { NextResponse, type NextRequest } from "next/server";
import { composerHandoffSchema } from "@bookmark-ai/types";
import { createComposerHandoff } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";
import { organizationErrorResponse } from "@/lib/server/organization-response";
export async function POST(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  await ctx.ready;
  const p = composerHandoffSchema.safeParse(await req.json().catch(() => null));
  if (!p.success)
    return NextResponse.json(
      { error: p.error.issues[0]?.message ?? "Invalid draft" },
      { status: 400 },
    );
  try {
    return NextResponse.json({
      handoff: await createComposerHandoff(ctx.db, ctx.userId ?? "local", p.data),
    });
  } catch (e) {
    return organizationErrorResponse(e);
  }
}
