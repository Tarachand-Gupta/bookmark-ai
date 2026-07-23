import * as SecureStore from "expo-secure-store";
import type { TokenCache } from "@clerk/clerk-expo";
import type { ServerTarget } from "../api";

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
 * ClerkProvider reads its key once at mount, so App.tsx remounts the provider
 * (key={target}) when the target changes — see App.tsx. Switching targets drops
 * the old instance's session (you're signed out), which is correct: the other
 * API wouldn't accept that token anyway.
 */
export const CLERK_PUBLISHABLE_KEYS: Record<ServerTarget, string> = {
  production: "pk_live_Y2xlcmsuYm9va21hcmstYWkuY2xvdWQk",
  local: "pk_test_ZGFybGluZy1iYWJvb24tMTMuY2xlcmsuYWNjb3VudHMuZGV2JA",
};

/**
 * Publishable key for a server target. `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, when
 * set, overrides BOTH targets (an escape hatch for a throwaway/staging Clerk
 * instance) — but note it defeats the follow-the-target behavior, so it's
 * normally left unset now that the prod instance has the Native API enabled.
 * Inlined at bundle time, so rebuild after changing it.
 */
export function clerkPublishableKey(target: ServerTarget): string {
  return process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? CLERK_PUBLISHABLE_KEYS[target];
}

/** Clerk session persistence in the iOS keychain / Android keystore. Clerk
 * namespaces its stored keys by publishable key, so each instance's session is
 * kept separately — switching back to a target can restore its prior session. */
export const tokenCache: TokenCache = {
  getToken: (key) => SecureStore.getItemAsync(key),
  saveToken: (key, value) => SecureStore.setItemAsync(key, value),
  clearToken: (key) => void SecureStore.deleteItemAsync(key),
};
