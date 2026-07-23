import * as SecureStore from "expo-secure-store";
import type { TokenCache } from "@clerk/clerk-expo";
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

/** Clerk session persistence in the iOS keychain / Android keystore. Clerk
 * namespaces its stored keys by publishable key, so each instance's session is
 * kept separately — switching back to a target can restore its prior session. */
export const tokenCache: TokenCache = {
  getToken: (key) => SecureStore.getItemAsync(key),
  saveToken: (key, value) => SecureStore.setItemAsync(key, value),
  clearToken: (key) => void SecureStore.deleteItemAsync(key),
};
