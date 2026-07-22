import { NextResponse, type NextRequest } from "next/server";
import { updateUserSettingsSchema, type UserSettings } from "@bookmark-ai/types";
import { getUserSettings, upsertUserSettings, type UserSettingsRow } from "@bookmark-ai/db";
import { getRequestApiContext } from "@/lib/server/api-context";

/**
 * Settings key. `getRequestApiContext` resolves `userId` to null in the open/
 * self-host modes (no Clerk user) — collapse that to the `"local"` sentinel so a
 * single-user local install still gets one persistent settings row.
 */
function settingsKey(userId: string | null): string {
  return userId ?? "local";
}

/** Mask a stored row (or its absence) into the key-free client view. Defaults to
 * provider "google" / no key when the user has never saved settings. */
function toApiSettings(row: UserSettingsRow | null): UserSettings {
  const key = row?.aiApiKey ?? null;
  return {
    provider: (row?.aiProvider as UserSettings["provider"]) ?? "google",
    baseUrl: row?.aiBaseUrl ?? null,
    model: row?.aiModel ?? null,
    apiKeySet: !!key,
    apiKeyLast4: key ? key.slice(-4) : null,
    liveServerUrl: row?.liveServerUrl ?? null,
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
  const { provider, apiKey, baseUrl, model, liveServerUrl } = parsed.data;

  // The form always sends provider/baseUrl/model, so those always overwrite. A
  // base URL only makes sense for a custom provider — clear it otherwise.
  const patch: Parameters<typeof upsertUserSettings>[2] = {
    aiProvider: provider,
    aiBaseUrl: provider === "custom" ? (baseUrl ?? null) : null,
    aiModel: model ?? null,
  };
  // apiKey: absent → keep (omit from patch); "" → clear (store null); else set.
  if (apiKey !== undefined) patch.aiApiKey = apiKey === "" ? null : apiKey;
  // liveServerUrl: absent → keep (omit); "" or null → clear (store null); else set.
  if (liveServerUrl !== undefined) patch.liveServerUrl = liveServerUrl ? liveServerUrl : null;

  const row = await upsertUserSettings(db, settingsKey(userId), patch);
  return NextResponse.json({ settings: toApiSettings(row) });
}
