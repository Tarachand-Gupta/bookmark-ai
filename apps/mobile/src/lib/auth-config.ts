import { assertAuthEndpoints } from "./native-endpoints";
export const BUILD_VARIANT = process.env.EXPO_PUBLIC_BUILD_VARIANT ?? "supabase-production";
export const AUTH_NAMESPACE = process.env.EXPO_PUBLIC_AUTH_STORAGE_NAMESPACE ?? `bookmark-ai:${BUILD_VARIANT}`;
export const AUTH_CALLBACK_URL = process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL ?? "bookmarkai://sso-callback";
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
export const SUPABASE_PUBLIC_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!["supabase-qa", "supabase-production"].includes(BUILD_VARIANT)) throw new Error("Unknown Supabase mobile build variant");
if (BUILD_VARIANT === "supabase-production") {
  if (process.env.EXPO_PUBLIC_AUTH_PROVIDER !== "supabase" || process.env.EXPO_PUBLIC_SERVER_TARGET !== "production" || process.env.EXPO_PUBLIC_HOSTED_TARGET !== "production") throw new Error("Production mobile builds require the explicit Supabase production wrapper");
  if (AUTH_NAMESPACE !== "bookmark-ai:supabase-production" || AUTH_CALLBACK_URL !== "bookmarkai://sso-callback") throw new Error("Supabase production auth namespace/callback mismatch");
  if (SUPABASE_URL !== "https://xogqaqtyacmecdbmgqqd.supabase.co" || !SUPABASE_PUBLIC_KEY) throw new Error("Production mobile Supabase configuration is required");
}
if (BUILD_VARIANT === "supabase-qa") {
  if (AUTH_NAMESPACE !== "bookmark-ai:supabase-qa" || AUTH_CALLBACK_URL !== "bookmarkai-supabase-qa://sso-callback") throw new Error("Supabase QA auth namespace/callback mismatch");
  if (!process.env.EXPO_PUBLIC_API_URL || !process.env.EXPO_PUBLIC_LIVE_API_URL || SUPABASE_URL !== "https://xogqaqtyacmecdbmgqqd.supabase.co") throw new Error("Supabase QA must use its isolated build wrapper");
}

assertAuthEndpoints(process.env.EXPO_PUBLIC_HOSTED_TARGET,process.env.EXPO_PUBLIC_API_URL!,process.env.EXPO_PUBLIC_LIVE_API_URL!);
