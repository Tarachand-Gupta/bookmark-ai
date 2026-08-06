import { NextResponse, type NextRequest } from "next/server";
import { updateNewTabSettingsSchema } from "@bookmark-ai/types";
import { getNewTabSettings, upsertNewTabSettings } from "@bookmark-ai/db";
import { getRequestApiContext } from "@/lib/server/api-context";

export const dynamic = "force-dynamic";

/**
 * The new-tab page's own settings (launcher corner, sidebar collapse). The row
 * doubles as the "seen the wizard" marker: GET returns null while none exists,
 * and the extension renders the first-run wizard in that state (§4.6).
 */
export async function GET() {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { userId, db, ready } = ctx;
  await ready;

  return NextResponse.json({ settings: await getNewTabSettings(db, userId ?? "local") });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { userId, db, ready } = ctx;
  await ready;

  const parsed = updateNewTabSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const settings = await upsertNewTabSettings(db, userId ?? "local", parsed.data);
  return NextResponse.json({ settings });
}
