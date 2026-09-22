import { withRequestLogging } from "@/lib/server/observability/request-logging";
import { NextResponse, type NextRequest } from "next/server";
import { deleteLiveDevice } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";

type Params = { params: Promise<{ id: string }> };

/** Forget one device — idempotent: 204 whether or not a row existed (§4.3). */
async function DELETEHandler(_req: NextRequest, { params }: Params) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  await deleteLiveDevice(db, (await params).id);
  return new NextResponse(null, { status: 204 });
}

export const DELETE = withRequestLogging("/api/live/[id]", "DELETE", DELETEHandler);
