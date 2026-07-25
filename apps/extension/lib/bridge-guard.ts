/**
 * Whitelist for BRIDGE_FETCH paths (Path D content-script bridge). The bridge
 * performs CREDENTIALED same-origin fetches on the app page's behalf, so it must
 * never become an open proxy: allow only relative `/api/...` paths, and reject
 * anything that could point off-path or off-origin (absolute URLs, scheme-
 * relative `//host`, or `..` traversal). Standalone (no `wxt/browser` import) so
 * it is unit-testable in plain node.
 *
 * The `/api/...` prefix intentionally covers `/api/device-token` — the Clerk-
 * authed device-token MINT is proxied through the bridge the one moment an app
 * tab is open (see lib/device-token.ts), so it must be a permitted bridge path.
 */
export function isAllowedBridgePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.startsWith("/api/") &&
    !path.startsWith("//") &&
    !path.includes("://") &&
    !path.includes("..")
  );
}
