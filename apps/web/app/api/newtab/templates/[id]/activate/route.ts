import { NextResponse, type NextRequest } from "next/server";
import { activateNewTabTemplate } from "@bookmark-ai/db";
import { getRequestApiContext } from "@/lib/server/api-context";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST — make one template THE tab. Runs the §4.2.1 transaction (deactivate
 * all → activate one → mirror into newtab_settings) in a single batch.
 * Unmetered (activation is a read-side choice, not a paid turn).
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { userId, db, ready } = ctx;
  await ready;

  const template = await activateNewTabTemplate(db, (await params).id, userId ?? "local");
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ template });
}
