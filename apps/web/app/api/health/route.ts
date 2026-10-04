import { withRequestLogging } from "@/lib/server/observability/request-logging";
import { NextResponse } from "next/server";
import { getGemini } from "@/lib/server/context";

export const dynamic = "force-dynamic";

/** Public liveness check (the one /api route that skips auth). */
function GETHandler() {
  // Liveness must not open any legacy, master or tenant database. `ai` keeps
  // its existing meaning: the shared Gemini client is configured, not probed.
  const gemini = getGemini();
  return NextResponse.json({ ok: true, ai: gemini !== null });
}

export const GET = withRequestLogging("/api/health", "GET", GETHandler);
