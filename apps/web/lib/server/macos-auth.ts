import { createHash, randomBytes, randomInt } from "node:crypto";
import {
  authorizeMacAuthFlow,
  consumeMacAuthFlow,
  createMacAuthFlow,
  getMacAuthFlow,
  issueMacAuthCsrf,
  purgeMacAuthFlows,
  type MasterStore,
  type MacAuthFlow,
} from "@bookmark-ai/db";
import { z } from "zod";
import { AUTHORIZED_PARTIES } from "@/lib/authorized-parties";
import { getMasterContext } from "@/lib/server/context";

export const MAC_AUTH_TTL_MS = 10 * 60 * 1_000;
export const MAC_AUTH_TICKET_TTL_SECONDS = 60;
export const MAC_AUTH_PENDING_RETRY_SECONDS = 2;
export const MAC_AUTH_NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
} as const;

const OPAQUE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const macAuthStartSchema = z.object({ codeChallenge: z.string().regex(CHALLENGE_PATTERN) }).strict();
export const macAuthAuthorizeSchema = z
  .object({
    flowId: z.string().regex(OPAQUE_PATTERN),
    csrfToken: z.string().regex(OPAQUE_PATTERN),
    action: z.enum(["approve", "cancel"]),
  })
  .strict();
export const macAuthExchangeSchema = z
  .object({ flowId: z.string().regex(OPAQUE_PATTERN), verifier: z.string().regex(OPAQUE_PATTERN) })
  .strict();
export const macAuthFlowIdSchema = z.string().regex(OPAQUE_PATTERN);

export class MacAuthStoreUnavailableError extends Error {}

function base64url(value: Buffer): string {
  return value.toString("base64url");
}

export function hashMacAuthValue(value: string): string {
  return base64url(createHash("sha256").update(value, "utf8").digest());
}

export function verifierChallenge(verifier: string): string {
  return hashMacAuthValue(verifier);
}

export function configuredMacAuthOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const fallback = env.NODE_ENV === "production" ? "https://www.bookmark-ai.cloud" : "http://localhost:3000";
  const candidate = env.MACOS_AUTH_APP_ORIGIN?.trim() || fallback;
  const url = new URL(candidate);
  const normalized = url.origin;
  if (candidate !== normalized || !AUTHORIZED_PARTIES.includes(normalized)) {
    throw new Error("MACOS_AUTH_APP_ORIGIN must be an exact allowlisted web origin");
  }
  if (env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("MACOS_AUTH_APP_ORIGIN must use HTTPS in production");
  }
  return normalized;
}

export function macAuthBrowserURL(flowId: string, env: NodeJS.ProcessEnv = process.env): string {
  const url = new URL("/macos-auth", configuredMacAuthOrigin(env));
  url.searchParams.set("flow", flowId);
  return url.toString();
}

/** Same-origin form fetch plus an unguessable per-flow CSRF token. */
export function isTrustedMacAuthBrowserRequest(request: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    request.headers.get("origin") === configuredMacAuthOrigin(env) &&
    request.headers.get("sec-fetch-site") === "same-origin"
  );
}

export async function readLimitedJson(request: Request, maxBytes: number): Promise<unknown> {
  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new MacAuthRequestError(415, "Expected application/json");
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw new MacAuthRequestError(413, "Request body too large");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The body is already rejected; a source-level cancel failure must
          // not turn a deterministic 413 into a generic server error.
        }
        throw new MacAuthRequestError(413, "Request body too large");
      }
      chunks.push(value);
    }
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    throw new MacAuthRequestError(400, "Invalid JSON");
  }
}

export class MacAuthRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function verificationCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `${part()}-${part()}`;
}

async function masterDb(): Promise<MasterStore> {
  const master = getMasterContext();
  if (!master) throw new MacAuthStoreUnavailableError("Mac sign-in store is not configured");
  await master.ready;
  return master.db;
}

export async function startMacAuthFlow(codeChallenge: string, now = Date.now()) {
  const db = await masterDb();
  await purgeMacAuthFlows(db, now);
  const flowId = base64url(randomBytes(32));
  const code = verificationCode();
  const expiresAt = now + MAC_AUTH_TTL_MS;
  await createMacAuthFlow(db, { flowId, codeChallenge, verificationCode: code, createdAt: now, expiresAt });
  return {
    flowId,
    browserUrl: macAuthBrowserURL(flowId),
    verificationCode: code,
    expiresAt,
    expiresInSeconds: MAC_AUTH_TTL_MS / 1_000,
  };
}

export type BrowserFlowView =
  | { status: "pending"; flow: MacAuthFlow; csrfToken: string }
  | { status: "approved" | "canceled" | "consumed" | "expired" | "invalid"; flow?: MacAuthFlow };

export async function prepareMacAuthBrowser(
  flowId: string,
  clerkUserId: string,
  clerkSessionId: string,
  now = Date.now(),
): Promise<BrowserFlowView> {
  const db = await masterDb();
  const flow = await getMacAuthFlow(db, flowId);
  if (!flow) return { status: "invalid" };
  if (flow.expiresAt <= now) return { status: "expired", flow };
  if (flow.state !== "pending") return { status: flow.state, flow };

  const csrfToken = base64url(randomBytes(32));
  const issued = await issueMacAuthCsrf(
    db,
    flowId,
    hashMacAuthValue(csrfToken),
    clerkUserId,
    clerkSessionId,
    now,
  );
  return issued ? { status: "pending", flow, csrfToken } : { status: "invalid" };
}

export async function submitMacAuthBrowser(input: {
  flowId: string;
  csrfToken: string;
  clerkUserId: string;
  clerkSessionId: string;
  action: "approve" | "cancel";
  now?: number;
}) {
  const db = await masterDb();
  return authorizeMacAuthFlow(db, {
    flowId: input.flowId,
    csrfHash: hashMacAuthValue(input.csrfToken),
    clerkUserId: input.clerkUserId,
    clerkSessionId: input.clerkSessionId,
    action: input.action,
    now: input.now ?? Date.now(),
  });
}

export async function consumeMacAuthBrowserFlow(flowId: string, verifier: string, now = Date.now()) {
  const db = await masterDb();
  return consumeMacAuthFlow(db, { flowId, codeChallenge: verifierChallenge(verifier), now });
}
