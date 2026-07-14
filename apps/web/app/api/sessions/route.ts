import { NextResponse, type NextRequest } from "next/server";
import { createSessionSchema } from "@bookmark-ai/types";
import { listSessions } from "@bookmark-ai/db";
import { saveSession } from "@bookmark-ai/engine";
import { getApiContext } from "@/lib/server/context";
import { requireUser } from "@/lib/server/require-user";

export async function GET() {
  const denied = await requireUser();
  if (denied) return denied;
  const { db, ready } = getApiContext();
  await ready;
  return NextResponse.json({ sessions: await listSessions(db) });
}

export async function POST(req: NextRequest) {
  const denied = await requireUser();
  if (denied) return denied;
  const { db, ready } = getApiContext();
  await ready;

  const parsed = createSessionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }
  const session = await saveSession(db, parsed.data);
  return NextResponse.json({ session }, { status: 201 });
}
