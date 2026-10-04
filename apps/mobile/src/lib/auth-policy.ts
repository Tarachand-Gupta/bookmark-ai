export type NativeFlow = "google" | "recovery" | "signup" | "email-change";
export interface PendingNativeFlow { state: string; createdAt: number; flow: NativeFlow }

export function nativeCallback(url: string, redirect: string, pending: PendingNativeFlow | null, now: number): string {
  const received = new URL(url), expected = new URL(redirect);
  if (received.protocol !== expected.protocol || received.hostname !== expected.hostname || received.pathname !== expected.pathname || received.username || received.password || received.hash) throw new Error("Unexpected sign-in callback");
  if (!pending || now - pending.createdAt > 15 * 60_000 || now < pending.createdAt || received.searchParams.getAll("bmai_state").length !== 1 || received.searchParams.get("bmai_state") !== pending.state) throw new Error("Sign-in expired or belongs to another attempt. Please try again.");
  if (received.searchParams.has("access_token") || received.searchParams.has("refresh_token")) throw new Error("Only PKCE authorization codes are accepted");
  if (received.searchParams.has("error")) throw new Error("The sign-in provider could not complete this request. Please try again.");
  const codes = received.searchParams.getAll("code");
  if (codes.length !== 1 || !codes[0] || codes[0].length > 4096) throw new Error("Sign-in callback is missing its authorization code");
  return codes[0];
}

export function displayLabel(value: string, fallback: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) || fallback;
}
export function profileName(metadata: Record<string, unknown> | undefined): string {
  const clean = (value: unknown) => typeof value === "string" ? displayLabel(value, "") : "";
  return clean(metadata?.full_name) || clean(metadata?.display_name);
}
export function profileNameUpdate(value: string) {
  const name = displayLabel(value, "Bookmark AI user");
  return { full_name: name, display_name: name };
}

export async function nativeAppleExchange(options: {
  nonce: string; state: string; hash: (value: string) => Promise<string>;
  signIn: (request: { nonce: string; state: string }) => Promise<{ identityToken: string | null; state: string | null; fullName?: { givenName?: string | null; familyName?: string | null } | null }>;
  exchange: (token: string, rawNonce: string) => Promise<void>;
  saveName: (name: string) => Promise<void>;
}) {
  const credential = await options.signIn({ nonce: await options.hash(options.nonce), state: options.state });
  if (credential.state !== options.state || !credential.identityToken) throw new Error("Apple returned an invalid sign-in response");
  await options.exchange(credential.identityToken, options.nonce);
  const name = displayLabel([credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(" "), "");
  if (name) await options.saveName(name);
}
