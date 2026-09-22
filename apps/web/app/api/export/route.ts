import { scheduleProductEvent } from "../product-analytics";
import { withRequestLogging } from "@/lib/server/observability/request-logging";
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
async function GETHandler(req: Request) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready, userId } = ctx;
  await ready;

  const bundle = await exportUserData(db, new Date().toISOString());
  scheduleProductEvent(req, {
    event: "export_completed", userId,
    properties: { item_count: bundle.bookmarks.length + bundle.sessions.length + bundle.conversations.length + bundle.skills.length },
  });
  return NextResponse.json(bundle, {
    headers: {
      "content-disposition": 'attachment; filename="bookmark-ai-export.json"',
    },
  });
}

export const GET = withRequestLogging("/api/export", "GET", GETHandler);
