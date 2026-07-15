import * as SecureStore from "expo-secure-store";
import type { TokenCache } from "@clerk/clerk-expo";

/** Same Clerk PRODUCTION instance as the deployed web app and extension.
 * Publishable keys are public by design; override with
 * EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY (e.g. the dev pk_test key for local
 * development — see README). Inlined at bundle time, so rebuild after changing. */
export const CLERK_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ??
  "pk_live_Y2xlcmsuYm9va21hcmstYWkuY2xvdWQk";

/** Clerk session persistence in the iOS keychain / Android keystore. */
export const tokenCache: TokenCache = {
  getToken: (key) => SecureStore.getItemAsync(key),
  saveToken: (key, value) => SecureStore.setItemAsync(key, value),
  clearToken: (key) => void SecureStore.deleteItemAsync(key),
};
