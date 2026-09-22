import { withRequestLogging } from "@/lib/server/observability/request-logging";
import { NextResponse } from "next/server";
import { getApiContext } from "@/lib/server/context";

export const dynamic = "force-dynamic";

/** Public liveness check (the one /api route that skips auth). */
function GETHandler() {
  const { gemini } = getApiContext();
  return NextResponse.json({ ok: true, ai: gemini !== null });
}

export const GET = withRequestLogging("/api/health", "GET", GETHandler);
