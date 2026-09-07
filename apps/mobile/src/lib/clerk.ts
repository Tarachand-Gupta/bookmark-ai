import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import type { TokenCache } from "@clerk/expo";
import { SERVER_TARGET, type ServerTarget } from "../api";

/**
 * Clerk publishable keys per server target — the key MUST follow the API the app
 * is talking to, since a session minted by one instance is meaningless to the
 * other. Publishable keys are public by design, so shipping both is fine.
 *
 *  - `production` → the PROD instance (FAPI clerk.bookmark-ai.cloud, Native API
 *    enabled) that backs the deployed API at bookmark-ai.cloud, the web app, and
 *    the extension.
 *  - `local` → the dev instance (darling-baboon-13, *.accounts.dev) used against
 *    the local Next dev server.
 *
 * The target is a BUILD-TIME constant now (see SERVER_TARGET in ../api), so this
 * resolves to exactly one key inlined at bundle time — ClerkProvider mounts once
 * with it and never remounts (no in-app server switch anymore).
 */
const CLERK_PUBLISHABLE_KEYS: Record<ServerTarget, string> = {
  production: "pk_live_Y2xlcmsuYm9va21hcmstYWkuY2xvdWQk",
  local: "pk_test_ZGFybGluZy1iYWJvb24tMTMuY2xlcmsuYWNjb3VudHMuZGV2JA",
};

/**
 * Publishable key for this build's server target.
 * `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, when set, overrides it (an escape hatch
 * for a throwaway/staging Clerk instance) — normally left unset. Inlined at
 * bundle time, so rebuild after changing the target or this env var.
 */
export const CLERK_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? CLERK_PUBLISHABLE_KEYS[SERVER_TARGET];

/**
 * The app's URI scheme — `expo.scheme` in app.json, which prebuild turns into the
 * native CFBundleURLSchemes / Android intent filter. Kept here as a constant
 * because SSO_REDIRECT_URL below must be byte-identical to a Clerk allowlist
 * entry, so it cannot be derived at runtime (see below).
 */
export const APP_SCHEME = "bookmarkai";

/**
 * Native OAuth/SSO callback handed to Clerk's `startSSOFlow`. A LITERAL on
 * purpose — this string has to match an entry in the Clerk instance's native
 * redirect allowlist (`/v1/redirect_urls`: `bookmarkai://` and
 * `bookmarkai://sso-callback` are registered on both the prod and dev
 * instances) EXACTLY, and every runtime way of producing it is conditional on
 * how the app was launched:
 *
 *  - `AuthSession.makeRedirectUri({ path: "sso-callback" })` (Clerk's Expo
 *    docs snippet, and clerk-expo's own default) resolves through
 *    `expo-linking`'s `createURL`, which splices in `Constants.expoConfig.hostUri`
 *    whenever a dev server is attached → `bookmarkai://192.168.x.x:8081sso-callback`,
 *    which Clerk's FAPI rejects outright (`redirect_url must be a url`).
 *  - the same call THROWS ("expo-linking needs access to the expo-constants
 *    manifest") in any build whose embedded `EXConstants.bundle/app.config` is
 *    missing or unreadable — a release-only failure mode invisible in dev.
 *  - a mismatch is not a clean error either: clerk-expo reads the callback URL
 *    back off the sign-in resource and, when FAPI didn't hand one over, throws
 *    the opaque "Missing external verification redirect URL for SSO flow".
 *
 * So: one constant, identical in dev runs and release builds, on iOS and
 * Android. If `expo.scheme` in app.json ever changes, change it here too and
 * re-register the URL with Clerk — the dev-only assertion below shouts if the
 * two drift apart.
 */
export const SSO_REDIRECT_URL = `${APP_SCHEME}://sso-callback`;

if (__DEV__) {
  // The scheme the NATIVE app actually registered (read from the embedded Expo
  // config) — if app.json's `scheme` is renamed without updating APP_SCHEME,
  // SSO_REDIRECT_URL keeps looking right while nothing can open it any more.
  try {
    const registered = Linking.createURL("").split(":")[0];
    if (registered !== APP_SCHEME) {
      console.warn(
        `[clerk] app scheme drift: native app registers "${registered}" but ` +
          `SSO_REDIRECT_URL uses "${APP_SCHEME}". Google/SSO sign-in will not ` +
          `return to the app until they match (and the URL is registered with Clerk).`,
      );
    }
  } catch {
    // createURL throws without an expo-constants manifest — nothing to compare.
  }
}

/** Clerk session persistence in the iOS keychain / Android keystore. Clerk
 * namespaces its stored keys by publishable key, so each instance's session is
 * kept separately — switching back to a target can restore its prior session. */
export const tokenCache: TokenCache = {
  getToken: (key) => SecureStore.getItemAsync(key),
  saveToken: (key, value) => SecureStore.setItemAsync(key, value),
  clearToken: (key) => void SecureStore.deleteItemAsync(key),
};
