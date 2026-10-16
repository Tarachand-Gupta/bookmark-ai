import { storage } from "#imports";
import { browser } from "wxt/browser";
import { fetchWithTimeout } from "./net";
import { base64url, oauthCallback, isApprovedOAuthApp } from "./oauth-policy";
import { detectOs } from "./detect";
import type { UserInfo } from "./messages";
import { diag } from "./diag";

export const SUPABASE_AUTH = import.meta.env.MODE === "supabase-qa" ||
  (import.meta.env.MODE === "production" && import.meta.env.WXT_AUTH_PROVIDER === "supabase");
const namespace = import.meta.env.MODE === "production" ? "bookmark-ai:supabase-production" : "bookmark-ai:supabase-qa";
const origin = import.meta.env.WXT_SUPABASE_URL?.replace(/\/$/, "") ?? "";
const app = import.meta.env.WXT_APP_URL?.replace(/\/$/, "") ?? "";
const clientId = import.meta.env.WXT_SUPABASE_OAUTH_CLIENT_ID ?? "";
type Credential = { accessToken: string; refreshToken: string; expiresAt: number };
type Pending = {
  state: string;
  verifier: string;
  redirect: string;
  expiresAt: number;
  tabId?: number;
};
const credential = storage.defineItem<Credential | null>(`local:${namespace}:oauth`, {
  fallback: null,
});
const pending = storage.defineItem<Pending | null>(`local:${namespace}:oauth-pending`, {
  fallback: null,
});
const cachedIdentity = storage.defineItem<UserInfo | null>(`local:${namespace}:identity`, {
  fallback: null,
});
let refreshing: Promise<string | null> | null = null;
let exchanging: Promise<void> | null = null;
let starting = false;
let epoch = 0;
// Storage calls are asynchronous. Serialize account writes so a delayed identity
// write/removal cannot land after a newer authorization or sign-out commits.
let accountWrites: Promise<unknown> = Promise.resolve();
function writeAccount<T>(write: () => Promise<T>): Promise<T> {
  const result = accountWrites.then(write);
  accountWrites = result.catch(() => undefined);
  return result;
}
export function oauthGeneration(): number {
  return epoch;
}
async function resetAccountCaches(): Promise<void> {
  await cachedIdentity.removeValue();
  await browser.storage.local.remove([
    "nativeSyncIds",
    "nativeSyncQueue",
    "nativeSyncEnabled",
    "nativeSyncFull",
    "liveEnabled",
    "liveDirty",
    "liveBackoffUntil",
    "liveBackoffStep",
    "liveWindowOverrides",
    "liveNewWindowsShared",
    "liveExcludedWindows",
    "lastIdentity",
  ]);
}
/** Chrome can deny content-script access to local refresh credentials. */
export async function initializeOAuthStorage(): Promise<void> {
  if (!SUPABASE_AUTH || import.meta.env.BROWSER !== "chrome") return;
  const local = browser.storage.local as unknown as {
    setAccessLevel?: (options: { accessLevel: "TRUSTED_CONTEXTS" }) => Promise<void>;
  };
  await local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
}
function configuration() {
  if (
    !SUPABASE_AUTH ||
    !origin.startsWith("https://") ||
    new URL(origin).hostname !== "xogqaqtyacmecdbmgqqd.supabase.co" ||
    !clientId ||
    (import.meta.env.MODE === "production" && app !== "https://www.bookmark-ai.cloud") ||
    !isApprovedOAuthApp(app)
  )
    throw new Error("Extension authentication is not configured");
}
async function exchange(body: URLSearchParams): Promise<Credential | null> {
  configuration();
  const response = await fetchWithTimeout(`${origin}/auth/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    credentials: "omit",
    redirect: "error",
  });
  diag("oauth", "token response", { grant: body.get("grant_type"), status: response.status });
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) return null;
    throw new Error("Authentication temporarily unavailable");
  }
  const result = await response.json();
  if (
    result.token_type?.toLowerCase() !== "bearer" ||
    typeof result.access_token !== "string" ||
    result.access_token.length > 16384 ||
    typeof result.refresh_token !== "string" ||
    result.refresh_token.length > 16384 ||
    !Number.isFinite(result.expires_in) ||
    result.expires_in <= 0 ||
    result.expires_in > 86400
  )
    throw new Error("Invalid authentication response");
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresAt: Date.now() + result.expires_in * 1000,
  };
}
export async function getOAuthToken(force = false): Promise<string | null> {
  // A callback owns the transition until its credential is committed. A cold
  // popup must not inspect the old/empty credential in the middle of that write.
  if (exchanging) await exchanging.catch(() => undefined);
  await accountWrites;
  if (refreshing) return refreshing;
  const generation = epoch;
  const current = await credential.getValue();
  if (generation !== epoch) return null;
  if (refreshing) return refreshing;
  if (!current) return null;
  if (!force && current.expiresAt > Date.now() + 60000) return current.accessToken;
  refreshing = (async () => {
    const next = await exchange(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: current.refreshToken,
      }),
    );
    return writeAccount(async () => {
      if (generation !== epoch) return null;
      await credential.setValue(next);
      return generation === epoch ? next?.accessToken ?? null : null;
    });
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}
export async function completeOAuth(url: string, tabId?: number): Promise<void> {
  if (exchanging) throw new Error("Authorization already in progress");
  const generation = epoch;
  let stage = "pending";
  exchanging = (async () => {
    const attempt = await pending.getValue();
    if (
      !attempt ||
      attempt.expiresAt < Date.now() ||
      (attempt.tabId !== undefined && attempt.tabId !== tabId)
    ) {
      diag("oauth", "callback rejected", {
        pending: !!attempt,
        expired: !!attempt && attempt.expiresAt < Date.now(),
        tabMatches: !!attempt && (attempt.tabId === undefined || attempt.tabId === tabId),
      });
      throw new Error("Authorization expired");
    }
    const code = oauthCallback(url, attempt.redirect, attempt.state);
    if (generation !== epoch) throw new Error("Authorization superseded");
    // Claim the transition before network/storage awaits, fencing probes of an
    // older credential while this single-use code is being exchanged.
    const completionGeneration = ++epoch;
    diag("oauth", "callback accepted");
    stage = "consume";
    await pending.removeValue();
    stage = "exchange";
    const next = await exchange(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: attempt.redirect,
        code_verifier: attempt.verifier,
      }),
    );
    if (!next) throw new Error("Authorization failed");
    stage = "commit";
    const committed = await writeAccount(async () => {
      if (completionGeneration !== epoch) return false;
      await resetAccountCaches();
      if (completionGeneration !== epoch) return false;
      await credential.setValue(next);
      return completionGeneration === epoch;
    });
    if (!committed) throw new Error("Authorization superseded");
    diag("oauth", "credential committed");
    stage = "registration";
    let registration: Response | undefined;
    try {
      registration = await fetchWithTimeout(`${app}/api/auth/sessions/current`, {
        method: "POST",
        headers: { Authorization: `Bearer ${next.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          clientType: `${import.meta.env.BROWSER}-extension`,
          deviceName: `${import.meta.env.BROWSER} extension`,
          browser: import.meta.env.BROWSER,
          os: typeof navigator !== "undefined" ? detectOs() : undefined,
        }),
        credentials: "omit",
        redirect: "error",
      });
      diag("oauth", "session registration", { status: registration.status });
    } catch {
      // Registration supplies display metadata; transport failure does not
      // undo an already persisted OAuth credential. Never retry the code.
      diag("oauth", "session registration unavailable");
    }
    if (registration?.status === 401) {
      await clearRejectedCredential(completionGeneration, next.accessToken, true);
      throw new Error("Authorization rejected");
    }
    if (completionGeneration !== epoch) throw new Error("Authorization superseded");
    diag("oauth", "callback complete");
  })();
  try {
    await exchanging;
  } catch (error) {
    diag("oauth", "callback failed", { stage });
    throw error;
  } finally {
    exchanging = null;
  }
}
/** Harmless readiness probe: never consumes state or exchanges a code. */
export async function oauthCallbackReady(tabId: number): Promise<boolean> {
  const attempt = await pending.getValue();
  return !!attempt && attempt.expiresAt >= Date.now() && attempt.tabId === tabId;
}
export async function startOAuth(): Promise<void> {
  if (starting) throw new Error("Authorization already in progress");
  starting = true;
  try {
    await beginOAuth();
  } finally {
    starting = false;
  }
}
async function beginOAuth(): Promise<void> {
  configuration();
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  const safari = import.meta.env.BROWSER === "safari";
  const redirect = safari
    ? `${app}/auth/extension-callback`
    : import.meta.env.BROWSER === "firefox"
      ? browser.identity.getRedirectURL()
      : browser.identity.getRedirectURL("supabase");
  const authorize = new URL(`${origin}/auth/v1/oauth/authorize`);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "openid email profile",
  }).toString();
  if (safari) {
    // Create inactive first so callback cannot outrun persistence of the tab binding.
    const tab = await browser.tabs.create({ url: "about:blank", active: false });
    await pending.setValue({
      verifier,
      state,
      redirect,
      expiresAt: Date.now() + 600000,
      tabId: tab.id,
    });
    await browser.tabs.update(tab.id!, { url: authorize.href, active: true });
  } else {
    await pending.setValue({ verifier, state, redirect, expiresAt: Date.now() + 600000 });
    try {
      const callback = await browser.identity.launchWebAuthFlow({
        url: authorize.href,
        interactive: true,
      });
      if (!callback) throw new Error("Authorization cancelled");
      await completeOAuth(callback);
    } catch {
      await pending.removeValue();
      throw new Error("Authorization was not completed");
    }
  }
}
export async function oauthIdentity(): Promise<UserInfo> {
  // Re-resolve superseded probes rather than publishing an old account result.
  // Bound restarts if the user repeatedly changes accounts while requests run.
  for (let attempt = 0; attempt < 3; attempt++) {
    await accountWrites;
    const generation = epoch;
    try {
      const token = await getOAuthToken();
      if (generation !== epoch) continue;
      if (!token) return { signedIn: false, name: null, email: null };
      const response = await fetchWithTimeout(`${app}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "omit",
        redirect: "error",
      });
      if (generation !== epoch) {
        diag("oauth", "identity superseded", { status: response.status });
        continue;
      }
      if (response.status === 401) {
        if (!await clearRejectedCredential(generation, token)) continue;
        return { signedIn: false, name: null, email: null };
      }
      if (!response.ok) throw new Error("Authentication temporarily unavailable");
      const identity = await response.json();
      const info: UserInfo = {
        signedIn: true,
        name: typeof identity.name === "string" ? identity.name.slice(0, 80) : null,
        email: typeof identity.email === "string" ? identity.email.slice(0, 254) : null,
      };
      const saved = await writeAccount(async () => {
        if (generation !== epoch) return false;
        await cachedIdentity.setValue(info);
        return generation === epoch;
      });
      if (saved) return info;
    } catch (error) {
      if (generation !== epoch) continue;
      const display = await cachedIdentity.getValue();
      const current = await credential.getValue();
      if (generation !== epoch) continue;
      if (display && current) return { ...display, stale: true };
      throw error;
    }
  }
  throw new Error("Authentication changed while resolving identity");
}
async function removeAccount(generation: number, removePending = true): Promise<boolean> {
  await resetAccountCaches();
  if (generation !== epoch) return false;
  await Promise.all([credential.removeValue(), ...(removePending ? [pending.removeValue()] : [])]);
  return generation === epoch;
}
async function clearRejectedCredential(generation: number, token: string, completing = false): Promise<boolean> {
  return writeAccount(async () => {
    // An old credential rejection must not cancel a callback that is still
    // validating its persisted state. Its reader will wait for the transition.
    if (exchanging && !completing) return false;
    const current = await credential.getValue();
    if (generation !== epoch || current?.accessToken !== token || (exchanging && !completing)) return false;
    // Invalid credentials and a pending new sign-in are independent. Only an
    // explicit logout cancels an unconsumed authorization attempt.
    return removeAccount(++epoch, false);
  });
}
export async function clearOAuth(): Promise<void> {
  const generation = ++epoch;
  await writeAccount(async () => {
    if (generation === epoch) await removeAccount(generation);
  });
}
export async function signOutOAuth(): Promise<{ ok: boolean }> {
  const token = await getOAuthToken();
  if (token) {
    const response = await fetchWithTimeout(`${app}/api/auth/sessions/sign-out`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "local" }),
      credentials: "omit",
      redirect: "error",
    });
    if (!response.ok && response.status !== 401) return { ok: false };
  }
  await clearOAuth();
  return { ok: true };
}

/** Used only to name Live device requests. Server compares its verified JWT claim. */
export async function getOAuthSessionId(): Promise<string | null> {
  const token = await getOAuthToken();
  if (!token) return null;
  try {
    const encodedPayload = token.split(".")[1];
    if (!encodedPayload) return null;
    const payload = JSON.parse(atob(encodedPayload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.session_id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        payload.session_id,
      )
      ? payload.session_id
      : null;
  } catch {
    return null;
  }
}
