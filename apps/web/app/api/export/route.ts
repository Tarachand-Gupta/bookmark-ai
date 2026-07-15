import { NextResponse } from "next/server";
import { exportUserData } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";

// Authed, per-user data — never statically cache.
export const dynamic = "force-dynamic";

/**
 * Export the caller's full library as a versioned, lossless JSON bundle
 * (every bookmark + session, minus regenerable embeddings). The bundle is the
 * response body; the Content-Disposition header lets a plain browser navigation
 * save it directly, while the in-app button reads the JSON and builds its own
 * dated download.
 */
export async function GET() {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  const bundle = await exportUserData(db, new Date().toISOString());
  return NextResponse.json(bundle, {
    headers: {
      "content-disposition": 'attachment; filename="bookmark-ai-export.json"',
    },
  });
}
