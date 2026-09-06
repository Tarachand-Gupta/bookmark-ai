import { NextResponse, type NextRequest } from "next/server";
import {
  appPlatformSchema,
  APP_PLATFORMS,
  upsertAppReleaseSchema,
  type AppReleaseResponse,
} from "@bookmark-ai/types";
import { gateAdmin } from "@/lib/server/admin-gate";
import { publishRelease, ReleaseStoreUnavailableError, unpublishRelease } from "@/lib/server/releases";

// Authed admin control-plane endpoint — never statically cache.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ platform: string }> };

const UNKNOWN_PLATFORM = () =>
  NextResponse.json(
    { error: `Unknown platform — expected one of ${APP_PLATFORMS.join(", ")}` },
    { status: 400 },
  );

const STORE_UNAVAILABLE = () =>
  NextResponse.json(
    { error: "Release store unavailable (master DB not configured)" },
    { status: 503 },
  );

/**
 * PUT /api/admin/releases/:platform (body `upsertAppReleaseSchema`) → { release }.
 * Publishes (inserts or replaces) the platform's latest release; the public
 * GET /api/app/releases serves it within its 5-minute cache window.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const gate = await gateAdmin();
  if ("response" in gate) return gate.response;

  const platform = appPlatformSchema.safeParse((await params).platform);
  if (!platform.success) return UNKNOWN_PLATFORM();

  const parsed = upsertAppReleaseSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  try {
    const release = await publishRelease(platform.data, parsed.data);
    const body: AppReleaseResponse = { release };
    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof ReleaseStoreUnavailableError) return STORE_UNAVAILABLE();
    console.error("[admin/releases] publish failed:", (err as Error).message);
    return NextResponse.json({ error: "Could not save the release" }, { status: 500 });
  }
}

/** DELETE /api/admin/releases/:platform → 204 (idempotent: clearing an absent record is fine). */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const gate = await gateAdmin();
  if ("response" in gate) return gate.response;

  const platform = appPlatformSchema.safeParse((await params).platform);
  if (!platform.success) return UNKNOWN_PLATFORM();

  try {
    await unpublishRelease(platform.data);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof ReleaseStoreUnavailableError) return STORE_UNAVAILABLE();
    console.error("[admin/releases] delete failed:", (err as Error).message);
    return NextResponse.json({ error: "Could not clear the release" }, { status: 500 });
  }
}
