/** Cookie-authenticated mutations require the page's exact origin. Native
 * clients use bearer authentication and are not subject to browser CSRF. */
export function authMutationOriginAllowed(request: Request): boolean {
  if (request.headers.has("authorization")) return true;
  return (
    request.headers.get("origin") === new URL(request.url).origin &&
    request.headers.get("sec-fetch-site") !== "cross-site"
  );
}

/** Middleware stamps target origin/method; callers cannot choose these headers. */
export function apiCookieMutationAllowed(headers: Headers): boolean {
  if (headers.has("authorization")) return true;
  const method = headers.get("x-bkm-route")?.split(" ")[0];
  if (method && ["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  const target = headers.get("x-bkm-origin");
  return (
    !!target && headers.get("origin") === target && headers.get("sec-fetch-site") !== "cross-site"
  );
}
