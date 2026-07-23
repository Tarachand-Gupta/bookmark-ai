import { clerkClient } from "@clerk/nextjs/server";
import { getUserSettings, type Db } from "@bookmark-ai/db";

/**
 * Server-side helpers for reaching the Live Sessions server (a DIFFERENT origin
 * than this app — no cookie/same-origin bridge reaches it). Shared by the
 * `/api/live-token` route (which hands a token to the Safari extension) and the
 * chat agent's `listLiveTabs` tool (which mints the caller's token and reads
 * their live tabs on their behalf).
 */

/** Short-lived by design; never cached server-side. */
export const LIVE_TOKEN_EXPIRES_IN_SECONDS = 60;

/**
 * Mint a fresh STANDARD Clerk session JWT for a given session — the exact token
 * `session.getToken()` returns client-side (no JWT template, so no dashboard
 * template is required). The live server verifies these offline (azp absent =
 * pass). Throws if Clerk can't mint (no session / not configured) — callers that
 * must degrade should guard first.
 */
export async function mintLiveSessionToken(
  sessionId: string,
): Promise<{ token: string; expiresInSeconds: number }> {
  const client = await clerkClient();
  // No template arg → default session token (standard session JWT).
  const { jwt } = await client.sessions.getToken(sessionId, undefined, LIVE_TOKEN_EXPIRES_IN_SECONDS);
  return { token: jwt, expiresInSeconds: LIVE_TOKEN_EXPIRES_IN_SECONDS };
}

/**
 * Resolve the live server base URL for a user the SAME way the web client does
 * (see `getLiveBaseUrl` in lib/api.ts): the user's saved `liveServerUrl`
 * override wins, else the build-time `NEXT_PUBLIC_LIVE_API_URL` env default.
 * Empty string when neither is set — callers treat that as "live off / not
 * configured". Mirrors `settingsKey` (open/self-host mode → the "local"
 * sentinel row).
 */
export async function resolveLiveBaseUrl(db: Db, userId: string | null): Promise<string> {
  const envBase = process.env.NEXT_PUBLIC_LIVE_API_URL ?? "";
  const settings = await getUserSettings(db, userId ?? "local").catch(() => null);
  return settings?.liveServerUrl || envBase;
}
