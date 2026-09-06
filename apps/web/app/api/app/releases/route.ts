import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { listPublishedReleases } from "@/lib/server/releases";
import { clientKey } from "@/lib/server/require-user";

// Public, but the payload changes when an admin publishes — never statically
// cache at build time; the CDN/browser cache below is the intended cache.
export const dynamic = "force-dynamic";

// Five minutes: a fresh release reaches every polling client within one interval.
// Not exported — Next's route-module type check only allows handler/config exports.
const RELEASES_CACHE_CONTROL = "public, max-age=300";

/**
 * GET /api/app/releases → { releases: { macos?, ios?, android? } }.
 * PUBLIC — like /api/health it skips auth (the native apps poll it before any
 * sign-in), but it still pays the per-IP rate limit. `{ releases: {} }` when no
 * master DB is configured (single-tenant / self-host) or the read fails.
 */
export async function GET(req: NextRequest) {
  if (!checkRateLimit(clientKey(req.headers))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const body = await listPublishedReleases();
  return NextResponse.json(body, { headers: { "cache-control": RELEASES_CACHE_CONTROL } });
}
