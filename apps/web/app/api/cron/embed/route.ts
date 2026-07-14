import { NextResponse, type NextRequest } from "next/server";
import { embedPending } from "@bookmark-ai/engine";
import { getApiContext } from "@/lib/server/context";

export const maxDuration = 300;

/**
 * Daily straggler sweep (Vercel cron, see vercel.json): embeds bookmarks the
 * post-save hook missed (transient Gemini failures, deploys mid-save). Gated
 * by CRON_SECRET, which Vercel attaches to cron invocations automatically.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { db, gemini, ready } = getApiContext();
  await ready;
  if (!gemini) return NextResponse.json({ embedded: 0, ai: false });

  // Drain in batches with a generous daily cap — a sweep should never rack
  // up unbounded Gemini calls if something upstream loops.
  let total = 0;
  let batch: number;
  do {
    batch = await embedPending(gemini, db, 10);
    total += batch;
  } while (batch === 10 && total < 200);
  return NextResponse.json({ embedded: total });
}
