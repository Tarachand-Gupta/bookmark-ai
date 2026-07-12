import * as SecureStore from "expo-secure-store";
import type { TokenCache } from "@clerk/clerk-expo";

/** Same Clerk dev instance as the web app and extension. Publishable keys
 * are public by design; override with EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
 * (e.g. the pk_live key once a production instance exists). */
export const CLERK_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ??
  "pk_test_ZGFybGluZy1iYWJvb24tMTMuY2xlcmsuYWNjb3VudHMuZGV2JA";

/** Clerk session persistence in the iOS keychain / Android keystore. */
export const tokenCache: TokenCache = {
  getToken: (key) => SecureStore.getItemAsync(key),
  saveToken: (key, value) => SecureStore.setItemAsync(key, value),
  clearToken: (key) => void SecureStore.deleteItemAsync(key),
};
