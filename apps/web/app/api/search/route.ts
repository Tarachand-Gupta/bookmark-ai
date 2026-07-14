import { NextResponse, type NextRequest } from "next/server";
import { searchQuerySchema } from "@bookmark-ai/types";
import { performSearch } from "@bookmark-ai/engine";
import { getApiContext } from "@/lib/server/context";
import { requireUser } from "@/lib/server/require-user";

export async function GET(req: NextRequest) {
  const denied = await requireUser();
  if (denied) return denied;
  const { db, gemini, ready } = getApiContext();
  await ready;

  const parsed = searchQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query" },
      { status: 400 },
    );
  }
  return NextResponse.json(await performSearch(db, gemini, parsed.data));
}
