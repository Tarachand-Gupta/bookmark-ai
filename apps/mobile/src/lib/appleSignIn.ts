export const appleSignInPresentation = (os: string): "native" | "browser" | null => os === "ios" ? "native" : os === "android" ? "browser" : null;
export const offersAppleSignIn = (os: string): boolean => appleSignInPresentation(os) !== null;
export const appleButtonStyle = (dark: boolean): "WHITE" | "BLACK" => dark ? "WHITE" : "BLACK";
export const hasAppleAccount = (accounts: readonly { provider: string }[]): boolean => accounts.some((account) => account.provider === "apple");
export type AppleSignInFailure = { kind: "cancelled" } | { kind: "apple" | "provider" | "unknown"; message: string };
export function describeAppleSignInError(error: unknown): AppleSignInFailure {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : null;
  if (code === "ERR_REQUEST_CANCELED") return { kind: "cancelled" };
  if (code?.startsWith("ERR_REQUEST_") || code === "ERR_INVALID_RESPONSE") return { kind: "apple", message: "Apple couldn't complete sign-in. Check the Apple Account in Settings, or continue with Google or email." };
  const message = error instanceof Error ? error.message : "Apple sign-in couldn't complete. Please retry.";
  if (/not available on this device/i.test(message)) return { kind: "apple", message: "Sign in with Apple isn't available on this device. Continue with Google or email." };
  return { kind: "unknown", message };
}
