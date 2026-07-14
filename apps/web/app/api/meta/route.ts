import { NextResponse } from "next/server";
import { getMeta } from "@bookmark-ai/db";
import { getApiContext } from "@/lib/server/context";
import { requireUser } from "@/lib/server/require-user";

export async function GET() {
  const denied = await requireUser();
  if (denied) return denied;
  const { db, ready } = getApiContext();
  await ready;
  return NextResponse.json(await getMeta(db));
}
