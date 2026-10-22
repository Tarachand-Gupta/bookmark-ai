import type { Bookmark, OrganizationResponse } from "@bookmark-ai/types";
import { authFetch, getApiBaseUrl } from "./api";
import { SUPABASE_AUTH, getOAuthToken, oauthGeneration } from "./supabase-oauth";
import { fetchWithTimeout } from "./net";
import {
  DefinitiveReleaseError,
  type ReleaseJob,
  type ReleaseResult,
  type ReleaseScope,
} from "./release-state";

export type ReleaseSession = { scope: ReleaseScope; generation: number; token: string | null };
export async function sessionCurrent(session: ReleaseSession): Promise<boolean> {
  return (
    session.generation === oauthGeneration() &&
    new URL(await getApiBaseUrl()).origin === session.scope.origin
  );
}
async function response(
  session: ReleaseSession,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<Response> {
  if (!(await sessionCurrent(session)))
    throw new Error("Account or server changed. Reopen the popup.");
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "omit",
    redirect: "error",
  };
  const result = SUPABASE_AUTH
    ? await fetchWithTimeout(session.scope.origin + path, init)
    : await authFetch(session.scope.origin + path, init, { authGeneration: session.generation });
  if (!(await sessionCurrent(session)))
    throw new Error("Account or server changed. Reopen the popup.");
  return result;
}
export async function releaseJson<T>(
  session: ReleaseSession,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await response(session, path, method, body);
  const result = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      res.status === 401
        ? "Sign in again to resume this account's saved draft."
        : typeof result?.error === "string"
          ? result.error
          : `Request failed (${res.status}).`;
    // Auth/network/5xx can follow an accepted write. Preserve the operation identity.
    if ([400, 403, 404, 409, 410, 422, 429].includes(res.status))
      throw new DefinitiveReleaseError(message);
    throw new Error(message);
  }
  return result as T;
}
export async function releaseSession(expected?: ReleaseScope): Promise<ReleaseSession> {
  const generation = oauthGeneration();
  const origin = new URL(await getApiBaseUrl()).origin;
  const token = SUPABASE_AUTH ? await getOAuthToken() : null;
  if (SUPABASE_AUTH && !token)
    throw new Error("Sign in again. Your pending draft is kept for the same account.");
  const session = { scope: { origin, accountId: "" }, generation, token };
  const me = await releaseJson<{ accountId?: string; signedIn?: boolean }>(session, "/api/me");
  if (typeof me.accountId !== "string" || !me.accountId || me.signedIn === false)
    throw new Error("A verified account is required. Sign in again.");
  session.scope.accountId = me.accountId;
  if (expected && (expected.accountId !== me.accountId || expected.origin !== origin))
    throw new Error("Account or server changed. Start a new request for this account.");
  return session;
}
export async function lookupPage(
  session: ReleaseSession,
  url: string,
): Promise<Bookmark | undefined> {
  const result = await releaseJson<{ bookmarks: Bookmark[] }>(
    session,
    `/api/bookmarks?url=${encodeURIComponent(url)}`,
  );
  return result.bookmarks[0];
}
export function readOrganization(session: ReleaseSession): Promise<OrganizationResponse> {
  return releaseJson(session, "/api/organization");
}
export async function executeReleaseJob(
  session: ReleaseSession,
  job: ReleaseJob,
): Promise<ReleaseResult> {
  const request = job.request;
  // Every accepted save/edit/create first checks the durable server receipt. A
  // missing receipt permits replay of exactly the admitted payload and ID.
  if (request.kind !== "handoff") {
    const receipt = await response(
      session,
      `/api/organization/operations/${encodeURIComponent(request.input.operationId)}`,
    );
    if (receipt.ok) {
      const result = (await receipt.json()) as ReleaseResult;
      if (request.kind === "save") {
        result.bookmark = await lookupPage(session, request.input.url);
        result.existing = result.operation?.existing;
      }
      if (request.kind === "edit")
        Object.assign(
          result,
          await releaseJson(session, `/api/bookmarks/${encodeURIComponent(request.bookmarkId)}`),
        );
      return result;
    }
    if (receipt.status !== 404)
      throw new Error(
        receipt.status === 401
          ? "Sign in again to check the saved request."
          : "Could not check the previous result. Retry when connected.",
      );
  }
  switch (request.kind) {
    case "save":
      return releaseJson(session, "/api/bookmarks", "POST", request.input);
    case "edit":
      return releaseJson(
        session,
        `/api/bookmarks/${encodeURIComponent(request.bookmarkId)}`,
        "PATCH",
        request.input,
      );
    case "create":
      return releaseJson(session, "/api/organization/operations", "POST", request.input);
    case "handoff":
      return releaseJson(session, "/api/composer/handoffs", "POST", request.input);
  }
}
