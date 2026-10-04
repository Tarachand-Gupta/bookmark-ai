import { createHash, randomBytes } from 'node:crypto';
import type { VerifiedSupabaseSession } from '@bookmark-ai/engine';
import { CredentialCipher, type PgExecutor } from '@bookmark-ai/db';

export const NATIVE_AUTH_TTL = 5 * 60_000;
export const opaque = /^[A-Za-z0-9_-]{43}$/;
export const NATIVE_CALLBACKS = {
  macos: 'bookmarkai-macos-supabase-qa://auth/callback',
  ios: 'bookmarkai-supabase-qa://sso-callback',
  android: 'bookmarkai-supabase-qa://sso-callback',
} as const;
export type NativeClient = keyof typeof NATIVE_CALLBACKS;
export type HandoffSession = { access_token: string; refresh_token: string; user_id: string; session_id: string; expires_at: number };
const random = () => randomBytes(32).toString('base64url');
export const challenge = (value: string) => createHash('sha256').update(value).digest('base64url');
export class HandoffError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function assertNativeHandoffIdentity(identity: VerifiedSupabaseSession, createdAt: number) {
  if(identity.clientId || identity.authenticatedAt*1000 < createdAt-5_000 || (identity.user.factors?.some(f=>f.status==='verified')&&identity.aal!=='aal2'))throw new HandoffError(403,'Complete fresh sign-in verification first');
}
export function assertNativeHandoffPair(before: VerifiedSupabaseSession, after: VerifiedSupabaseSession) {
  if(before.providerUserId!==after.providerUserId||before.sessionId!==after.sessionId||before.aal!==after.aal)throw new HandoffError(403,'Session identity changed');
}
export class NativeAuthHandoff {
  constructor(private db: PgExecutor, private cipher: CredentialCipher) {}
  async start(client: NativeClient, codeChallenge: string, state: string, now = Date.now()) {
    const flow = random(), nonce = random(), expiresAt = now + NATIVE_AUTH_TTL;
    const abandoned=await this.db.query("select provider_user_id,session_id from bmai_qa.native_auth_flows where expires_at<$1 and state='ready'",[now]);
    for(const row of abandoned)await this.db.query("select bmai_qa.manage_sessions($1::uuid,$2::uuid,'local')",[row.provider_user_id,row.session_id]);
    await this.db.query('delete from bmai_qa.native_auth_flows where expires_at<$1', [now]);
    await this.db.query('insert into bmai_qa.native_auth_flows(flow_id,code_challenge,browser_nonce_hash,native_state,client_type,callback_url,created_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8)', [flow, codeChallenge, challenge(nonce), state, client, NATIVE_CALLBACKS[client], now, expiresAt]);
    return { flowId: flow, browserNonce: nonce, expiresAt };
  }
  async view(flow: string, nonce: string, now = Date.now()) {
    const rows = await this.db.query('select * from bmai_qa.native_auth_flows where flow_id=$1 and browser_nonce_hash=$2 and expires_at>$3', [flow, challenge(nonce), now]);
    const row = rows[0];
    if (!row || row.state !== 'pending') throw new HandoffError(410, 'This sign-in request ended. Start again in the app.');
    return { clientType: row.client_type as NativeClient, callbackUrl: row.callback_url as string, createdAt: Number(row.created_at), expiresAt: Number(row.expires_at) };
  }
  async reserve(flow: string, nonce: string, now = Date.now()) {
    const rows=await this.db.query("update bmai_qa.native_auth_flows set state='completing' where flow_id=$1 and browser_nonce_hash=$2 and state='pending' and expires_at>$3 returning flow_id",[flow,challenge(nonce),now]);
    if(!rows.length)throw new HandoffError(409,'Sign-in request already completing or ended');
  }
  async complete(flow: string, nonce: string, session: HandoffSession, now = Date.now()) {
    const code = random();
    const encrypted = this.cipher.encrypt(JSON.stringify(session), `native-auth:${flow}`);
    const rows = await this.db.query("update bmai_qa.native_auth_flows set state='ready',payload_ciphertext=$3,provider_user_id=$4,session_id=$5,completion_code_hash=$7 where flow_id=$1 and browser_nonce_hash=$2 and state='completing' and expires_at>$6 returning callback_url,native_state", [flow, challenge(nonce), encrypted, session.user_id, session.session_id, now, challenge(code)]);
    if (!rows[0]) throw new HandoffError(410, 'This sign-in request ended. Start again in the app.');
    const url = new URL(rows[0].callback_url);
    url.search = new URLSearchParams({ flow, state: rows[0].native_state, code }).toString();
    return url.href;
  }
  async exchange(flow: string, verifier: string, completionCode: string, now = Date.now()): Promise<HandoffSession | null> {
    return this.db.transaction(async db => {
      const rows = await db.query('select * from bmai_qa.native_auth_flows where flow_id=$1 for update', [flow]);
      const row = rows[0];
      if (!row || row.code_challenge !== challenge(verifier)) throw new HandoffError(404, 'Invalid sign-in request');
      if (Number(row.expires_at) <= now || row.state === 'canceled') throw new HandoffError(410, 'Sign-in expired or canceled');
      if (row.state === 'consumed') throw new HandoffError(409, 'Sign-in request already used');
      if (row.state === 'pending' || row.state === 'completing') return null;
      if(row.completion_code_hash!==challenge(completionCode))throw new HandoffError(403,'Invalid app completion code');
      const session = JSON.parse(this.cipher.decrypt(row.payload_ciphertext, `native-auth:${flow}`)) as HandoffSession;
      if (session.user_id !== row.provider_user_id || session.session_id !== row.session_id || session.expires_at * 1000 <= now) throw new HandoffError(410, 'Invalid sign-in session');
      await db.query("update bmai_qa.native_auth_flows set state='consumed',payload_ciphertext=null,completion_code_hash=null where flow_id=$1", [flow]);
      return session;
    });
  }
  async cancel(flow: string, verifier: string): Promise<HandoffSession | null> {
    return this.db.transaction(async db => {
      const rows = await db.query("select * from bmai_qa.native_auth_flows where flow_id=$1 and code_challenge=$2 for update", [flow, challenge(verifier)]);
      const row = rows[0];
      if (!row || row.state === 'consumed' || row.state === 'canceled') return null;
      const session = row.payload_ciphertext ? JSON.parse(this.cipher.decrypt(row.payload_ciphertext, `native-auth:${flow}`)) as HandoffSession : null;
      await db.query("update bmai_qa.native_auth_flows set state='canceled',payload_ciphertext=null where flow_id=$1", [flow]);
      return session;
    });
  }
}
