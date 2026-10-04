import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { CredentialCipher, isPostgresMasterRepository } from '@bookmark-ai/db';
import { createSupabaseVerifier, withAuthDeadline } from '@bookmark-ai/engine';
import { getMasterContext } from '@/lib/server/context';
import { readLimitedJson } from '@/lib/server/macos-auth';
import { NativeAuthHandoff, HandoffError, opaque, assertNativeHandoffIdentity, assertNativeHandoffPair } from '@/lib/server/native-auth-handoff';
import { checkRateLimitWindow } from '@/lib/server/rate-limit';
import { trustedClientKey } from '@/lib/server/require-user';
import { withRequestLogging } from '@/lib/server/observability/request-logging';
export const dynamic = 'force-dynamic';
const id = z.string().regex(opaque);
const pair = z.object({ flowId: id, verifier: id }).strict();
const exchange = pair.extend({completionCode:id}).strict();
const browser = z.object({ flowId: id, browserNonce: id }).strict();
const start = z.object({ clientType: z.enum(['macos','ios','android']), codeChallenge: id, state: id }).strict();
const complete = browser.extend({ accessToken: z.string().min(1).max(16384), refreshToken: z.string().min(1).max(16384) }).strict();
const json = (body: unknown, status=200) => NextResponse.json(body,{status,headers:{'cache-control':'no-store, max-age=0','pragma':'no-cache'}});
async function handler(request: NextRequest, context: {params: Promise<{action:string}>}) {
  const { action } = await context.params;
  try {
    const rate = checkRateLimitWindow(`native-auth:${action}:${trustedClientKey(request.headers)}`, action==='exchange'?180:20, 5*60_000);
    if(!rate.allowed) return json({error:'Too many requests'},429);
    const master = getMasterContext();
    if(!master || !isPostgresMasterRepository(master.db)) return json({error:'Sign-in unavailable'},503);
    await master.ready;
    const store = new NativeAuthHandoff(master.db.connection, new CredentialCipher(process.env.MASTER_CREDENTIAL_ENCRYPTION_KEY!));
    const input = await readLimitedJson(request, 36_000);
    if(action==='start') {
      const parsed=start.safeParse(input); if(!parsed.success) return json({error:'Invalid request'},400);
      const value=await store.start(parsed.data.clientType,parsed.data.codeChallenge,parsed.data.state);
      const origin=new URL(request.url).origin;
      const next='/auth/native/complete?'+new URLSearchParams({flow:value.flowId,browser_nonce:value.browserNonce});
      return json({flowId:value.flowId,browserUrl:origin+'/sign-in?'+new URLSearchParams({next}),expiresAt:value.expiresAt,state:parsed.data.state},201);
    }
    if(action==='view'||action==='complete') {
      if(request.headers.get('origin')!==new URL(request.url).origin || request.headers.get('sec-fetch-site')==='cross-site') return json({error:'Invalid request origin'},403);
      if(action==='view') {const parsed=browser.safeParse(input);if(!parsed.success)return json({error:'Invalid request'},400);return json(await store.view(parsed.data.flowId,parsed.data.browserNonce));}
      const parsed=complete.safeParse(input); if(!parsed.success)return json({error:'Invalid request'},400);
      const {flowId,browserNonce,accessToken,refreshToken}=parsed.data;
      if(request.headers.get('authorization')!==`Bearer ${accessToken}`)return json({error:'Invalid session'},401);
      const flow=await store.view(flowId,browserNonce);
      const config={url:process.env.SUPABASE_URL!,publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY!};
      const verify=createSupabaseVerifier(config);
      const identity=await withAuthDeadline(()=>verify(accessToken));
      // Only this fresh native context can be transferred; OAuth/client or old web sessions cannot be imported.
      assertNativeHandoffIdentity(identity,flow.createdAt);
      const liveRows=await master.db.connection.query("select bmai_qa.manage_sessions($1::uuid,$2::uuid,'list') as sessions",[identity.providerUserId,identity.sessionId]);
      const live=(liveRows[0]?.sessions as Array<{id:string;createdAt:string}>|undefined)?.find(s=>s.id===identity.sessionId);
      if(!live||Date.parse(live.createdAt)<flow.createdAt-5_000)return json({error:'A fresh app session is required'},403);
      const regularCookie = await (await import('@/lib/auth/server')).getCookieAccessToken();
      if(regularCookie) {
        const regular=await withAuthDeadline(()=>verify(regularCookie)).catch(()=>null);
        if(regular?.sessionId===identity.sessionId)return json({error:'A separate app session is required'},403);
      }
      // Rotate through the provider to validate the supplied refresh/access pair belongs to this exact session.
      await store.reserve(flowId,browserNonce);
      const sb=createClient(config.url,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      const {data,error}=await sb.auth.refreshSession({refresh_token:refreshToken});
      if(error||!data.session)return json({error:'Invalid session'},401);
      try {
        const rotated=await withAuthDeadline(()=>verify(data.session!.access_token));
        assertNativeHandoffPair(identity,rotated);
        return json({callbackUrl:await store.complete(flowId,browserNonce,{access_token:data.session.access_token,refresh_token:data.session.refresh_token,user_id:rotated.providerUserId,session_id:rotated.sessionId,expires_at:rotated.expiresAt})});
      } catch(error) {await sb.auth.signOut({scope:'local'});throw error;}
    }
    if(action==='exchange'||action==='cancel') {
      const parsed=(action==='exchange'?exchange:pair).safeParse(input);if(!parsed.success)return json({error:'Invalid request'},400);
      if(action==='exchange') {
        const session=await store.exchange(parsed.data.flowId,parsed.data.verifier,(parsed.data as z.infer<typeof exchange>).completionCode);
        return session?json({status:'complete',session}):json({status:'pending',retryAfterSeconds:2},202);
      }
      const session=await store.cancel(parsed.data.flowId,parsed.data.verifier);
      if(session) {
        const sb=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
        await sb.auth.setSession(session);await sb.auth.signOut({scope:'local'});
      }
      return json({status:'canceled'});
    }
    return json({error:'Invalid request'},404);
  } catch(error) {
    if(error instanceof HandoffError)return json({error:error.message},error.status);
    return json({error:'Sign-in temporarily unavailable. Try again.'},503);
  }
}
export const POST=withRequestLogging('/api/auth/native/[action]','POST',handler);
