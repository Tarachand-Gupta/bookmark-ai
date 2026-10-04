import { isMasterRepository, type MasterStore } from "../master-repository";
import { timingSafeEqual } from "node:crypto";
import type { Row } from "@libsql/client";
import type { Db } from "../client";

export type MacAuthFlowState = "pending" | "approved" | "canceled" | "consumed";

export interface MacAuthFlow {
  flowId: string;
  codeChallenge: string;
  verificationCode: string;
  csrfHash: string | null;
  csrfUserId: string | null;
  csrfSessionId: string | null;
  clerkUserId: string | null;
  state: MacAuthFlowState;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface CreateMacAuthFlow {
  flowId: string;
  codeChallenge: string;
  verificationCode: string;
  createdAt: number;
  expiresAt: number;
}

export type AuthorizeMacAuthFlowResult =
  | "approved"
  | "canceled"
  | "invalid"
  | "auth-changed"
  | "expired"
  | "not-pending";
export type ConsumeMacAuthFlowResult =
  | { status: "ready"; clerkUserId: string }
  | { status: "pending" | "canceled" | "expired" | "replayed" | "invalid" };

function rowToMacAuthFlow(row: Row): MacAuthFlow {
  return {
    flowId: String(row.flow_id),
    codeChallenge: String(row.code_challenge),
    verificationCode: String(row.verification_code),
    csrfHash: row.csrf_hash == null ? null : String(row.csrf_hash),
    csrfUserId: row.csrf_user_id == null ? null : String(row.csrf_user_id),
    csrfSessionId: row.csrf_session_id == null ? null : String(row.csrf_session_id),
    clerkUserId: row.clerk_user_id == null ? null : String(row.clerk_user_id),
    state: String(row.state) as MacAuthFlowState,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    consumedAt: row.consumed_at == null ? null : Number(row.consumed_at),
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function createMacAuthFlow(db: MasterStore, input: CreateMacAuthFlow): Promise<void> {
  if (isMasterRepository(db)) return db.createMacAuthFlow(input);
  await db.execute({
    sql: `INSERT INTO macos_auth_flows
          (flow_id, code_challenge, verification_code, state, created_at, expires_at)
          VALUES (?, ?, ?, 'pending', ?, ?)`,
    args: [input.flowId, input.codeChallenge, input.verificationCode, input.createdAt, input.expiresAt],
  });
}

export async function getMacAuthFlow(db: MasterStore, flowId: string): Promise<MacAuthFlow | null> {
  if (isMasterRepository(db)) return db.getMacAuthFlow(flowId);
  const result = await db.execute({
    sql: "SELECT * FROM macos_auth_flows WHERE flow_id = ?",
    args: [flowId],
  });
  return result.rows[0] ? rowToMacAuthFlow(result.rows[0]) : null;
}

/** Rotate the browser form's CSRF token without changing authorization state. */
export async function issueMacAuthCsrf(
  db: MasterStore,
  flowId: string,
  csrfHash: string,
  clerkUserId: string,
  clerkSessionId: string,
  now: number,
): Promise<boolean> {
  if (isMasterRepository(db)) return db.issueMacAuthCsrf(flowId, csrfHash, clerkUserId, clerkSessionId, now);
  const result = await db.execute({
    sql: `UPDATE macos_auth_flows
          SET csrf_hash = ?, csrf_user_id = ?, csrf_session_id = ?
          WHERE flow_id = ? AND state = 'pending' AND expires_at > ?`,
    args: [csrfHash, clerkUserId, clerkSessionId, flowId, now],
  });
  return result.rowsAffected === 1;
}

/**
 * Bind the authenticated browser account, or cancel. The CSRF token is consumed
 * in the same guarded update, so a form replay cannot change the chosen account.
 */
export async function authorizeMacAuthFlow(
  db: MasterStore,
  input: {
    flowId: string;
    csrfHash: string;
    clerkUserId: string;
    clerkSessionId: string;
    action: "approve" | "cancel";
    now: number;
  },
): Promise<AuthorizeMacAuthFlowResult> {
  if (isMasterRepository(db)) return db.authorizeMacAuthFlow(input);
  const flow = await getMacAuthFlow(db, input.flowId);
  if (!flow || !flow.csrfHash || !constantTimeEqual(flow.csrfHash, input.csrfHash)) return "invalid";
  if (
    !flow.csrfUserId ||
    !flow.csrfSessionId ||
    !constantTimeEqual(flow.csrfUserId, input.clerkUserId) ||
    !constantTimeEqual(flow.csrfSessionId, input.clerkSessionId)
  ) return "auth-changed";
  if (flow.expiresAt <= input.now) return "expired";
  if (flow.state !== "pending") return "not-pending";

  const nextState = input.action === "approve" ? "approved" : "canceled";
  const userId = input.action === "approve" ? input.clerkUserId : null;
  const result = await db.execute({
    sql: `UPDATE macos_auth_flows
          SET state = ?, clerk_user_id = ?, csrf_hash = NULL,
              csrf_user_id = NULL, csrf_session_id = NULL
          WHERE flow_id = ? AND state = 'pending' AND expires_at > ?
            AND csrf_hash = ? AND csrf_user_id = ? AND csrf_session_id = ?`,
    args: [
      nextState,
      userId,
      input.flowId,
      input.now,
      input.csrfHash,
      input.clerkUserId,
      input.clerkSessionId,
    ],
  });
  if (result.rowsAffected !== 1) return "not-pending";
  return nextState;
}

/**
 * Verify the PKCE challenge, then atomically consume an approved flow. Only the
 * conditional UPDATE may return the user id, so concurrent callers cannot both
 * mint a ticket. The post-miss read classifies the losing caller as replayed.
 */
export async function consumeMacAuthFlow(
  db: MasterStore,
  input: { flowId: string; codeChallenge: string; now: number },
): Promise<ConsumeMacAuthFlowResult> {
  if (isMasterRepository(db)) return db.consumeMacAuthFlow(input);
  const flow = await getMacAuthFlow(db, input.flowId);
  if (!flow || !constantTimeEqual(flow.codeChallenge, input.codeChallenge)) return { status: "invalid" };
  if (flow.expiresAt <= input.now) return { status: "expired" };
  if (flow.state === "pending") return { status: "pending" };
  if (flow.state === "canceled") return { status: "canceled" };
  if (flow.state === "consumed") return { status: "replayed" };
  if (!flow.clerkUserId) return { status: "invalid" };

  const consumed = await db.execute({
    sql: `UPDATE macos_auth_flows
          SET state = 'consumed', consumed_at = ?
          WHERE flow_id = ? AND state = 'approved' AND expires_at > ? AND code_challenge = ?
          RETURNING clerk_user_id`,
    args: [input.now, input.flowId, input.now, input.codeChallenge],
  });
  const row = consumed.rows[0];
  if (row?.clerk_user_id) return { status: "ready", clerkUserId: String(row.clerk_user_id) };

  const current = await getMacAuthFlow(db, input.flowId);
  if (current?.state === "consumed") return { status: "replayed" };
  if (current?.state === "canceled") return { status: "canceled" };
  if (current && current.expiresAt <= input.now) return { status: "expired" };
  return { status: "invalid" };
}

/**
 * Opportunistic GC. Keep terminal/expired rows for 24 hours by default so a
 * recent second exchange is still recognizable as a replay rather than a miss.
 */
export async function purgeMacAuthFlows(
  db: MasterStore,
  now: number,
  retentionMs = 24 * 60 * 60 * 1_000,
): Promise<number> {
  if (isMasterRepository(db)) return db.purgeMacAuthFlows(now, retentionMs);
  const cutoff = now - retentionMs;
  const result = await db.execute({
    sql: `DELETE FROM macos_auth_flows
          WHERE (state IN ('pending', 'approved') AND expires_at < ?)
             OR (state = 'canceled' AND expires_at < ?)
             OR (state = 'consumed' AND consumed_at IS NOT NULL AND consumed_at < ?)`,
    args: [cutoff, cutoff, cutoff],
  });
  return result.rowsAffected;
}
