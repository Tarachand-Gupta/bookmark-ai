import { assertAuthEndpoints } from "./native-endpoints";
export const BUILD_VARIANT = process.env.EXPO_PUBLIC_BUILD_VARIANT ?? "production";
export const AUTH_NAMESPACE = process.env.EXPO_PUBLIC_AUTH_STORAGE_NAMESPACE ?? `bookmark-ai:${BUILD_VARIANT}:supabase`;
export const AUTH_CALLBACK_URL = process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL ?? "bookmarkai://sso-callback";
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
export const SUPABASE_PUBLIC_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (BUILD_VARIANT !== "supabase-qa") throw new Error("This Supabase migration branch permits isolated supabase-qa mobile builds only");
if (BUILD_VARIANT === "supabase-qa") {
  if (AUTH_NAMESPACE !== "bookmark-ai:supabase-qa" || AUTH_CALLBACK_URL !== "bookmarkai-supabase-qa://sso-callback") throw new Error("Supabase QA auth namespace/callback mismatch");
  if (!process.env.EXPO_PUBLIC_API_URL || !process.env.EXPO_PUBLIC_LIVE_API_URL || SUPABASE_URL !== "https://xogqaqtyacmecdbmgqqd.supabase.co") throw new Error("Supabase QA must use its isolated build wrapper");
}

assertAuthEndpoints(process.env.EXPO_PUBLIC_HOSTED_TARGET,process.env.EXPO_PUBLIC_API_URL!,process.env.EXPO_PUBLIC_LIVE_API_URL!);
