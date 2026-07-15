import { NextResponse, type NextRequest } from "next/server";
import { createSessionSchema } from "@bookmark-ai/types";
import { listSessions } from "@bookmark-ai/db";
import { saveSession } from "@bookmark-ai/engine";
import { enforceQuota, getRequestApiContext } from "@/lib/server/api-context";

export async function GET() {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;
  return NextResponse.json({ sessions: await listSessions(db) });
}

export async function POST(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { userId, db, ready } = ctx;
  await ready;

  const parsed = createSessionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const overQuota = await enforceQuota(userId, "sessions");
  if (overQuota) return overQuota;

  const session = await saveSession(db, parsed.data);
  return NextResponse.json({ session }, { status: 201 });
}
