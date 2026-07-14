import { NextResponse } from "next/server";
import { getApiContext } from "@/lib/server/context";

export const dynamic = "force-dynamic";

/** Public liveness check (the one /api route that skips auth). */
export function GET() {
  const { gemini } = getApiContext();
  return NextResponse.json({ ok: true, ai: gemini !== null });
}
