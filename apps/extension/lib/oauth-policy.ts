/** Pure checks shared by the OAuth background and its tests. */
export function isApprovedOAuthApp(origin: string): boolean {
  return ["http://localhost:3100", "https://www.bookmark-ai.cloud"].includes(origin);
}
export function isOAuthBridgeCallback(url: string, app: string): boolean {
  if (!isApprovedOAuthApp(app)) return false;
  try {
    const actual = new URL(url);
    return actual.origin === app && actual.pathname === "/auth/extension-callback";
  } catch {
    return false;
  }
}
export function oauthCallback(url: string, expected: string, state: string): string {
  const actual = new URL(url);
  const target = new URL(expected);
  if (
    actual.origin !== target.origin ||
    actual.pathname !== target.pathname ||
    actual.hash ||
    actual.searchParams.getAll("state").length !== 1 ||
    actual.searchParams.get("state") !== state
  )
    throw new Error("Invalid authorization callback");
  if (actual.searchParams.has("error")) throw new Error("Authorization was cancelled");
  const codes = actual.searchParams.getAll("code");
  if (codes.length !== 1 || !codes[0] || codes[0].length > 4096)
    throw new Error("Invalid authorization code");
  return codes[0];
}
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
