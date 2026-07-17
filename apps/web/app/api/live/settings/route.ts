import { NextResponse, type NextRequest } from "next/server";
import { updateLiveSettingsSchema } from "@bookmark-ai/types";
import { setLiveEnabled } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";

/**
 * Set the account-wide opt-in flag. POST (not PUT/PATCH) because middleware
 * hardcodes CORS methods to GET,POST,DELETE,OPTIONS. Turning it off purges every
 * device in the same request (§5.7); the web Settings toggle and the extension
 * both call this.
 */
export async function POST(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready, userId } = ctx;
  await ready;

  const parsed = updateLiveSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  await setLiveEnabled(db, userId, parsed.data.enabled);
  return NextResponse.json({ enabled: parsed.data.enabled });
}
