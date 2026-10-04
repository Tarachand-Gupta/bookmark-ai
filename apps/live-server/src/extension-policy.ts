/** Explicit extension grants: publishing, account Live opt-in, own teardown. */
export function extensionLiveRequestAllowed(
  method: string,
  url: string,
  sessionId: string,
  body: unknown,
): boolean {
  let path: string;
  try {
    path = new URL(url, "http://live.invalid").pathname;
  } catch {
    return false;
  }
  if (method === "POST" && path === "/live/settings") return true;
  if (method === "POST" && path === "/live")
    return (
      typeof body === "object" &&
      body !== null &&
      !Array.isArray(body) &&
      (body as { deviceId?: unknown }).deviceId === sessionId
    );
  return method === "DELETE" && path === `/live/${sessionId}`;
}
