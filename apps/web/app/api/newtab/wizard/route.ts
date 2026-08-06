import { NextResponse } from "next/server";
import { getWizardData } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";

export const dynamic = "force-dynamic";

/**
 * GET — all six "wizard features" in one round trip (docs/features/
 * newtab-canvas.md §4.5.1): favorites / recent / continue where you left off /
 * what am I working on / mostly used / time spent. All read-only derivations
 * over existing tables. Unmetered — a cold-open fan-out read like /api/meta.
 */
export async function GET() {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { userId, db, ready } = ctx;
  await ready;

  return NextResponse.json(await getWizardData(db, userId));
}
