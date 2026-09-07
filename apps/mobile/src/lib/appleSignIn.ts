/**
 * Pure decisions behind "Continue with Apple" — kept out of SignInScreen so
 * they can be unit-tested under node (the screen itself needs a device).
 *
 * The native flow is Clerk's `useSignInWithApple()` (`@clerk/expo/apple`): it
 * runs `expo-apple-authentication`'s `signInAsync` (the system sheet), hands the
 * identity token to Clerk as `strategy: "oauth_token_apple"`, and resolves the
 * sign-up ↔ sign-in transfer itself. What it hands back is a plain result
 * object, and a CANCEL is not an error — the hook swallows Apple's
 * `ERR_REQUEST_CANCELED` and resolves with `createdSessionId: null` and the
 * untouched resources. `resolveAppleFlow` below turns that result into the one
 * thing the screen has to do next.
 */

/** Native Sign in with Apple is an iOS feature; Android keeps Google + email. */
export const offersAppleSignIn = (os: string): boolean => os === "ios";

/**
 * Apple's HIG: a black button on light backgrounds, a white one on dark. These
 * are `AppleAuthenticationButtonStyle` values (typed as literals here so this
 * module stays free of native imports).
 */
export const appleButtonStyle = (dark: boolean): "WHITE" | "BLACK" => (dark ? "WHITE" : "BLACK");

/**
 * The parts of `startAppleAuthenticationFlow()`'s result this decision reads.
 * Structural on purpose: Clerk's `SignInResource`/`SignUpResource` satisfy it,
 * and tests can build literals.
 */
export interface AppleFlowResult {
  createdSessionId: string | null;
  signUp?: {
    status: string | null;
    missingFields: readonly string[];
    verifications: { externalAccount: { status: string | null } };
  } | null;
  signIn?: {
    status: string | null;
    firstFactorVerification: { status: string | null };
  } | null;
}

export type AppleFlowNext =
  /** Clerk minted a session — activate it. */
  | { kind: "activate"; sessionId: string }
  /** First Apple sign-in created the account and nothing is actually missing:
   * one empty `signUp.update({})` completes it (same as the Google path). */
  | { kind: "complete-signup" }
  /** No session and no verification ever ran: the user dismissed the sheet.
   * Say nothing — cancelling is a choice, not a failure. */
  | { kind: "cancelled" }
  /** Clerk stopped somewhere this screen cannot finish (a required field, a
   * second factor). Report the status so the user isn't left guessing. */
  | { kind: "unresolved"; status: string };

/** An untouched Clerk verification reports `null` or "unverified" — both mean
 * "nothing happened", and only a status past that counts as progress. */
const untouched = (status: string | null | undefined): boolean =>
  status == null || status === "unverified";

export function resolveAppleFlow(result: AppleFlowResult): AppleFlowNext {
  if (result.createdSessionId) {
    return { kind: "activate", sessionId: result.createdSessionId };
  }
  const signUp = result.signUp ?? null;
  const signIn = result.signIn ?? null;
  if (signUp?.status === "missing_requirements" && signUp.missingFields.length === 0) {
    return { kind: "complete-signup" };
  }
  if (
    untouched(signUp?.verifications.externalAccount.status) &&
    untouched(signIn?.firstFactorVerification.status)
  ) {
    return { kind: "cancelled" };
  }
  return { kind: "unresolved", status: signUp?.status ?? signIn?.status ?? "unknown" };
}

export type AppleSignInFailure =
  /** The user backed out — nothing to show. */
  | { kind: "cancelled" }
  /** Apple's `ASAuthorizationError` surfaced as an Expo error code — the sheet
   * could not complete on the DEVICE side (no Apple Account signed in, the
   * request failed or was not handled). */
  | { kind: "apple"; message: string }
  /** Clerk rejected or could not run the token exchange — its own message. */
  | { kind: "clerk"; message: string }
  /** Anything else, with the best message we have. */
  | { kind: "unknown"; message: string };

/** Apple's "not signed in to an Apple Account" case comes back as the generic
 * `ASAuthorizationError.unknown` (code 1000 → `ERR_REQUEST_UNKNOWN`) after the
 * system has shown its own "sign in to your Apple Account in Settings" alert, so
 * the copy points at Settings rather than at the user. */
const APPLE_ERROR_MESSAGES: Record<string, string> = {
  ERR_REQUEST_UNKNOWN:
    "Sign in with Apple couldn't start. Make sure this device is signed in to an Apple Account in Settings, or continue with Google or your email.",
  ERR_REQUEST_FAILED:
    "Apple couldn't complete the sign-in. Try again, or continue with Google or your email.",
  ERR_REQUEST_NOT_HANDLED:
    "Apple couldn't complete the sign-in. Try again, or continue with Google or your email.",
  ERR_REQUEST_NOT_INTERACTIVE:
    "Apple couldn't complete the sign-in. Try again, or continue with Google or your email.",
  ERR_INVALID_RESPONSE:
    "Apple returned an unexpected response. Try again, or continue with Google or your email.",
};

const codeOf = (err: unknown): string | null => {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
};

const clerkMessageOf = (err: unknown): string | null => {
  const errors = (err as { errors?: { longMessage?: string; message?: string }[] })?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  return errors[0]?.longMessage ?? errors[0]?.message ?? null;
};

/** Classify a `startAppleAuthenticationFlow()` rejection into what the screen
 * should show (if anything). */
export function describeAppleSignInError(err: unknown): AppleSignInFailure {
  const code = codeOf(err);
  if (code === "ERR_REQUEST_CANCELED") return { kind: "cancelled" };
  if (code && code in APPLE_ERROR_MESSAGES) {
    return { kind: "apple", message: APPLE_ERROR_MESSAGES[code] };
  }
  const clerk = clerkMessageOf(err);
  if (clerk) return { kind: "clerk", message: clerk };
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  // Clerk's own throws when the device can't offer the sheet at all.
  if (/not available on this device/i.test(message)) {
    return {
      kind: "apple",
      message: "Sign in with Apple isn't available on this device. Continue with Google or your email.",
    };
  }
  return {
    kind: "unknown",
    message: message || "Apple sign-in didn't finish. Try again, or use your email and password.",
  };
}

/**
 * Did this account come through Sign in with Apple? Decides whether the
 * account-deletion sheet shows Apple's manual-revocation step (TN3194: with no
 * refresh/access token on our side — Clerk's native flow verifies only the
 * identity token — the user has to remove the app under their Apple Account).
 */
export const hasAppleAccount = (accounts: readonly { provider: string }[]): boolean =>
  accounts.some((account) => account.provider === "apple");
