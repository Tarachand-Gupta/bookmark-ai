import { NextResponse, type NextRequest } from "next/server";
import { updateObservabilitySchema, type ObservabilityResponse } from "@bookmark-ai/types";
import { gateAdmin } from "@/lib/server/admin-gate";
import {
  getObservabilityConfig,
  isObservabilityConfigured,
  setObservabilityConfig,
} from "@/lib/server/observability/config";

// Authed admin control-plane endpoint — never statically cache.
export const dynamic = "force-dynamic";

/** Host the traces go to — never the URL's credentials/path, never the keys. */
function baseUrlHost(): string | null {
  if (!isObservabilityConfigured()) return null;
  const raw = process.env.LANGFUSE_BASE_URL;
  if (!raw) return "cloud.langfuse.com"; // the SDK's default target
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

async function payload(): Promise<ObservabilityResponse> {
  return {
    configured: isObservabilityConfigured(),
    baseUrl: baseUrlHost(),
    surfaces: await getObservabilityConfig(),
  };
}

/** GET /api/admin/observability → { configured, baseUrl, surfaces }. */
export async function GET() {
  const gate = await gateAdmin();
  if ("response" in gate) return gate.response;
  return NextResponse.json(await payload());
}

/**
 * PATCH /api/admin/observability { surfaces subset } → the updated payload.
 * Persists to the master control-plane DB; other instances pick the change up
 * within the ~60s read cache. 503 when no master DB is configured (mirrors
 * /api/admin/ai-limit).
 */
export async function PATCH(req: NextRequest) {
  const gate = await gateAdmin();
  if ("response" in gate) return gate.response;

  const parsed = updateObservabilitySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  try {
    await setObservabilityConfig(parsed.data);
  } catch (err) {
    console.error("[admin/observability]", (err as Error).message);
    return NextResponse.json(
      { error: "Config store unavailable (master DB not configured)" },
      { status: 503 },
    );
  }
  return NextResponse.json(await payload());
}
