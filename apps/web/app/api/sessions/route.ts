import { after, NextResponse, type NextRequest } from "next/server";
import { createSessionSchema } from "@bookmark-ai/types";
import { listSessions } from "@bookmark-ai/db";
import { enrichSessionSummary, saveSession } from "@bookmark-ai/engine";
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
  const { userId, db, gemini, ready } = ctx;
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

  // Instant save → 201. The AI title + description are generated AFTER the
  // response is sent (same pattern as bookmark enrichment), because an extension
  // session save is a ~50ms interaction and an LLM round-trip in the request
  // path would make the user wait seconds with their window about to close.
  // `enrichSessionSummary` never overwrites a name the user typed.
  const session = await saveSession(db, parsed.data);
  after(async () => {
    try {
      await enrichSessionSummary(db, gemini, session.id);
    } catch (err) {
      console.warn(
        `[session-summary] ${session.id}: ${(err as Error).message} — keeping the saved name`,
      );
    }
  });
  return NextResponse.json({ session }, { status: 201 });
}
