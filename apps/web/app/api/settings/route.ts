import { NextResponse, type NextRequest } from "next/server";
import {
  parseMcpToolAllowlist,
  updateUserSettingsSchema,
  type AiUsage,
  type UserSettings,
} from "@bookmark-ai/types";
import { getUserSettings, upsertUserSettings, type Db, type UserSettingsRow } from "@bookmark-ai/db";
import { assertSafeUrl, getWeeklyUsage } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";
import { getFreeAiWeeklyLimit } from "@/lib/server/ai-limit";
import { nextWeeklyResetUtc } from "@/lib/ai-credits";
import { decryptApiKey, encryptApiKey } from "@/lib/server/ai-key-crypto";
import { deriveAiMode } from "@/lib/server/ai-mode";
import { isOwnKeyReady } from "@/lib/server/ai-model";
import { buildSettingsPatch } from "@/lib/server/settings-patch";

/**
 * Settings key. `getRequestApiContext` resolves `userId` to null in the open/
 * self-host modes (no Clerk user) — collapse that to the `"local"` sentinel so a
 * single-user local install still gets one persistent settings row.
 */
function settingsKey(userId: string | null): string {
  return userId ?? "local";
}

/**
 * The caller's free-tier weekly AI meter, or null if it can't be read.
 *
 * Same two inputs the chat route's 402 wall compares (live weekly usage from the
 * tenant DB + the admin-adjustable global limit from the master DB), so the meter
 * the user sees and the limit that actually stops them can't drift. `resetsAt` is
 * the next Monday 00:00 UTC — the week key usage is stored under.
 *
 * NEVER throws: settings is the payload the whole AI UI boots from, and a slow or
 * missing master DB must degrade to "no meter shown", not a failed GET.
 */
async function readAiUsage(db: Db): Promise<AiUsage | null> {
  try {
    const [usedTokens, limitTokens] = await Promise.all([
      getWeeklyUsage(db),
      getFreeAiWeeklyLimit(),
    ]);
    return { usedTokens, limitTokens, resetsAt: nextWeeklyResetUtc() };
  } catch (err) {
    console.warn("[settings] ai usage read failed:", (err as Error).message);
    return null;
  }
}

/** Mask a stored row (or its absence) into the key-free client view. Defaults to
 * provider "google" / no key when the user has never saved settings. The stored
 * key is encrypted at rest, so decrypt before deriving the masked last-4. */
function toApiSettings(row: UserSettingsRow | null, aiUsage: AiUsage | null): UserSettings {
  const key = decryptApiKey(row?.aiApiKey ?? null);
  return {
    provider: (row?.aiProvider as UserSettings["provider"]) ?? "google",
    baseUrl: row?.aiBaseUrl ?? null,
    model: row?.aiModel ?? null,
    apiKeySet: !!key,
    apiKeyLast4: key ? key.slice(-4) : null,
    // The explicit mode (v14), or the legacy derivation for a NULL column — the
    // SAME rule the chat model resolver applies, so the badge matches reality.
    aiMode: deriveAiMode(row?.aiMode, !!key),
    // The SAME completeness rule the chat resolver applies (google needs no
    // model; the others do) — so "ready" here means chat WILL run on the key.
    ownKeyReady: isOwnKeyReady(row, !!key),
    liveServerUrl: row?.liveServerUrl ?? null,
    onboardedAt: row?.onboardedAt ?? null,
    // Defaults (sync on / full sync off) come from the row mapper for existing
    // rows; absent row = fresh account, so restate them here.
    nativeSyncEnabled: row?.nativeSyncEnabled ?? true,
    nativeSyncFull: row?.nativeSyncFull ?? false,
    mcpTools: parseMcpToolAllowlist(row?.mcpToolsJson ?? null),
    aiUsage,
  };
}

export async function GET() {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready, userId } = ctx;
  await ready;
  // Both reads are independent — the settings row is the tenant DB, the meter is
  // the tenant DB + master config — so pay for one round trip, not two.
  const [row, aiUsage] = await Promise.all([
    getUserSettings(db, settingsKey(userId)),
    readAiUsage(db),
  ]);
  return NextResponse.json({ settings: toApiSettings(row, aiUsage) });
}

export async function PUT(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready, userId } = ctx;
  await ready;

  const parsed = updateUserSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }
  const { provider, baseUrl } = parsed.data;

  // SECURITY (SSRF): a custom provider's base URL is user-supplied and later used
  // by the chat model resolver to build an outbound AI request. Validate it HERE
  // at write time against the same net-guard policy the models test route uses
  // (scheme/port check + DNS resolution rejecting loopback/private/link-local/
  // metadata hosts), so a hostile base URL never reaches the stored settings.
  // `assertSafeUrl` is async (it resolves DNS) and throws on a malformed or
  // blocked URL.
  if (provider === "custom" && baseUrl) {
    try {
      await assertSafeUrl(baseUrl);
    } catch {
      return NextResponse.json(
        { error: "Base URL must be a reachable public http(s) endpoint" },
        { status: 400 },
      );
    }
  }

  // The field semantics (absent = keep; apiKey "" = remove + included; a new key
  // = own; aiMode never touches the key; provider never nulls the model) live in
  // the pure, unit-tested builder. `aiMode: "own"` needs a stored key — read the
  // existing row so the check sees what is ACTUALLY there. encryptApiKey fails
  // closed (throws) rather than storing plaintext; the builder turns that into a
  // clean 500 instead of an uncaught crash / leaked stack.
  const existing = await getUserSettings(db, settingsKey(userId));
  const built = buildSettingsPatch(parsed.data, {
    hasStoredKey: !!decryptApiKey(existing?.aiApiKey ?? null),
    encrypt: encryptApiKey,
  });
  if (!built.ok) {
    if (built.status === 500) console.warn("[settings] ai key encryption failed");
    return NextResponse.json({ error: built.error }, { status: built.status });
  }

  const row = await upsertUserSettings(db, settingsKey(userId), built.patch);
  // PUT returns the meter too, so a client that re-renders straight from the save
  // response (the setup card does) keeps a live meter instead of blanking it.
  return NextResponse.json({ settings: toApiSettings(row, await readAiUsage(db)) });
}
