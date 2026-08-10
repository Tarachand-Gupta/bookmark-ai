import { NextResponse, type NextRequest } from "next/server";
import {
  parseMcpToolAllowlist,
  updateUserSettingsSchema,
  type UserSettings,
} from "@bookmark-ai/types";
import { getUserSettings, upsertUserSettings, type UserSettingsRow } from "@bookmark-ai/db";
import { assertSafeUrl } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";
import { decryptApiKey, encryptApiKey } from "@/lib/server/ai-key-crypto";

/**
 * Settings key. `getRequestApiContext` resolves `userId` to null in the open/
 * self-host modes (no Clerk user) — collapse that to the `"local"` sentinel so a
 * single-user local install still gets one persistent settings row.
 */
function settingsKey(userId: string | null): string {
  return userId ?? "local";
}

/** Mask a stored row (or its absence) into the key-free client view. Defaults to
 * provider "google" / no key when the user has never saved settings. The stored
 * key is encrypted at rest, so decrypt before deriving the masked last-4. */
function toApiSettings(row: UserSettingsRow | null): UserSettings {
  const key = decryptApiKey(row?.aiApiKey ?? null);
  return {
    provider: (row?.aiProvider as UserSettings["provider"]) ?? "google",
    baseUrl: row?.aiBaseUrl ?? null,
    model: row?.aiModel ?? null,
    apiKeySet: !!key,
    apiKeyLast4: key ? key.slice(-4) : null,
    liveServerUrl: row?.liveServerUrl ?? null,
    onboardedAt: row?.onboardedAt ?? null,
    // Defaults (sync on / full sync off) come from the row mapper for existing
    // rows; absent row = fresh account, so restate them here.
    nativeSyncEnabled: row?.nativeSyncEnabled ?? true,
    nativeSyncFull: row?.nativeSyncFull ?? false,
    mcpTools: parseMcpToolAllowlist(row?.mcpToolsJson ?? null),
  };
}

export async function GET() {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready, userId } = ctx;
  await ready;
  const row = await getUserSettings(db, settingsKey(userId));
  return NextResponse.json({ settings: toApiSettings(row) });
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
  const { provider, apiKey, baseUrl, model, liveServerUrl, onboarded, nativeSyncEnabled, nativeSyncFull, mcpTools } = parsed.data;

  // SECURITY (SSRF): a custom provider's base URL is user-supplied and later used
  // by resolveChatModel to build an outbound AI request. Validate it HERE at write
  // time against the same net-guard policy the models test route uses (scheme/port
  // check + DNS resolution rejecting loopback/private/link-local/metadata hosts),
  // so a hostile base URL never reaches the stored settings. `assertSafeUrl` is
  // async (it resolves DNS) and throws on a malformed or blocked URL.
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

  const patch: Parameters<typeof upsertUserSettings>[2] = {};
  // The Settings form always sends provider/baseUrl/model, so those overwrite
  // together. A single-field PATCH (e.g. mark-onboarded) omits provider and must
  // NOT touch the AI config. A base URL only makes sense for a custom provider —
  // clear it otherwise.
  if (provider !== undefined) {
    patch.aiProvider = provider;
    patch.aiBaseUrl = provider === "custom" ? (baseUrl ?? null) : null;
    patch.aiModel = model ?? null;
  }
  // apiKey: absent → keep (omit from patch); "" → clear (store null); else
  // encrypt-at-rest before storing (AES-256-GCM `enc:v1:` envelope). Writing here
  // is also the lazy re-encryption path for any legacy plaintext row.
  if (apiKey !== undefined) patch.aiApiKey = apiKey === "" ? null : encryptApiKey(apiKey);
  // liveServerUrl: absent → keep (omit); "" or null → clear (store null); else set.
  if (liveServerUrl !== undefined) patch.liveServerUrl = liveServerUrl ? liveServerUrl : null;
  // onboarded: true → stamp onboarded_at to now (marks the tour seen for this
  // account). Absent/false → leave the marker untouched (never un-set it).
  if (onboarded) patch.onboardedAt = new Date().toISOString();
  // Native-sync toggles: absent → keep; the Sync section PATCHes exactly one.
  if (nativeSyncEnabled !== undefined) patch.nativeSyncEnabled = nativeSyncEnabled;
  if (nativeSyncFull !== undefined) patch.nativeSyncFull = nativeSyncFull;
  // mcpTools: absent → keep; null → reset to the default (all tools enabled);
  // an array (including []) → store that exact allowlist. The enum already
  // rejected unknown names, so the stored JSON is always a valid subset.
  if (mcpTools !== undefined) patch.mcpToolsJson = mcpTools === null ? null : JSON.stringify(mcpTools);

  const row = await upsertUserSettings(db, settingsKey(userId), patch);
  return NextResponse.json({ settings: toApiSettings(row) });
}
