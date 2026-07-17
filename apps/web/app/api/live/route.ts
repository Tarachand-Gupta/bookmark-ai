import { NextResponse, type NextRequest } from "next/server";
import { pushLiveStateSchema } from "@bookmark-ai/types";
import { applyDeviceSnapshot, listLiveDevices } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";

export async function GET() {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready, userId } = ctx;
  await ready;
  return NextResponse.json(await listLiveDevices(db, userId));
}

export async function POST(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready, userId } = ctx;
  await ready;

  const parsed = pushLiveStateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const result = await applyDeviceSnapshot(db, userId, parsed.data);
  if (!result.ok) {
    // Off → 403 carrying enabled:false so the extension knows to stop (§5.2), not a
    // transient error. Over quota → 429.
    if (result.reason === "disabled") {
      return NextResponse.json({ ok: false, enabled: false }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Daily push limit reached for this device." },
      { status: 429 },
    );
  }
  return NextResponse.json({ ok: true, enabled: true });
}
