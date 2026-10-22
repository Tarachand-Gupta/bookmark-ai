import type { OrganizationOperation, OrganizationOperationInput, UpdateBookmarkInput } from "@bookmark-ai/types";
import { applyOrganizationOperation, getOrganizationOperation, retryOrganizationOperation, undoOrganizationOperation, updateBookmark } from "./api";
import { onExplicitSignOut } from "./account-private-state";
export type OrganizationRequest = { kind: "organization"; input: OrganizationOperationInput } | { kind: "bookmark"; bookmarkId: string; input: UpdateBookmarkInput } | { kind: "undo" | "retry"; targetId: string; input: { operationId: string } };
export const organizationRequestKey = (accountId: string) => `bmai:organization-request:v1:${accountId}`;
export function readOrganizationRequests(storage: Pick<Storage, "getItem">, accountId: string): OrganizationRequest[] {
  try { const value = JSON.parse(storage.getItem(organizationRequestKey(accountId)) ?? "null"); return value?.accountId === accountId && Array.isArray(value.requests) ? value.requests.filter((r: OrganizationRequest) => ["organization", "bookmark", "undo", "retry"].includes(r.kind) && typeof r.input?.operationId === "string") : []; } catch { return []; }
}
export function persistOrganizationRequest(storage: Pick<Storage, "getItem" | "setItem">, accountId: string, request: OrganizationRequest) {
  const requests = readOrganizationRequests(storage, accountId).filter(r => r.input.operationId !== request.input.operationId); requests.push(request);
  storage.setItem(organizationRequestKey(accountId), JSON.stringify({ accountId, requests }));
}
function removeRequest(accountId: string, request: OrganizationRequest) {
  const requests = readOrganizationRequests(localStorage, accountId).filter(r => r.input.operationId !== request.input.operationId);
  if (requests.length) localStorage.setItem(organizationRequestKey(accountId), JSON.stringify({ accountId, requests })); else localStorage.removeItem(organizationRequestKey(accountId));
}
/** Persist before send. A retry reuses the original identity and frozen values. */
export async function runOrganizationRequest(accountId: string, request: OrganizationRequest): Promise<OrganizationOperation> {
  let revoked = false; const unsubscribe = onExplicitSignOut(accountId, () => { revoked = true; });
  try {
    persistOrganizationRequest(localStorage, accountId, request);
    let operation: OrganizationOperation;
    try {
      const result = request.kind === "organization" ? await applyOrganizationOperation(request.input, accountId)
        : request.kind === "bookmark" ? await updateBookmark(request.bookmarkId, request.input, accountId)
        : await (request.kind === "undo" ? undoOrganizationOperation : retryOrganizationOperation)(request.targetId, request.input.operationId, accountId);
      operation = result.operation;
    } catch (error) {
      if (revoked) throw new Error("This account signed out. Its private pending requests were cleared.");
      if (error instanceof Error && "status" in error && [400, 403, 404, 409, 410, 413, 422].includes(Number(error.status))) { removeRequest(accountId, request); throw error; }
      try { operation = (await getOrganizationOperation(request.input.operationId, accountId)).operation; }
      catch { throw new Error(`${(error as Error).message}. Result unconfirmed. Retry the same request here or in Recent changes.`); }
    }
    if (revoked) throw new Error("This account signed out. Its private pending requests were cleared.");
    removeRequest(accountId, request); return operation;
  } finally { unsubscribe(); window.dispatchEvent(new Event("bookmark-organization-request-changed")); }
}
