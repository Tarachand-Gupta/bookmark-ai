import { withRequestLogging } from "@/lib/server/observability/request-logging";
import { NextResponse } from "next/server";
import { getMeta } from "@bookmark-ai/db";
import { getRequestApiContext } from "@/lib/server/api-context";

async function GETHandler() {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;
  return NextResponse.json(await getMeta(db));
}

export const GET = withRequestLogging("/api/meta", "GET", GETHandler);
