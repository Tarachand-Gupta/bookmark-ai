import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { CredentialCipher, type PgExecutor } from '@bookmark-ai/db';
import { createClient } from '@supabase/supabase-js';
import type { VerifiedSupabaseSession } from '@bookmark-ai/engine';
import { assertNativeHandoffIdentity,assertNativeHandoffPair,challenge,NativeAuthHandoff } from './native-auth-handoff';
let pg:PGlite,store:NativeAuthHandoff;
const now=Date.now(),verifier='v'.repeat(43),state='s'.repeat(43);
const userId='00000000-0000-4000-8000-000000000001',sessionId='00000000-0000-4000-8000-000000000002';
const payload={access_token:'native-access',refresh_token:'native-refresh',user_id:userId,session_id:sessionId,expires_at:now/1000+3600};
const identity=(aal='aal2'):VerifiedSupabaseSession=>({providerUserId:userId,sessionId,accessToken:'access',expiresAt:now/1000+3600,aal,authenticatedAt:now/1000,user:{id:userId,factors:[{status:'verified'}]}});
beforeEach(async()=>{
  pg=new PGlite();await pg.exec('create schema bmai_qa;create role anon;create role authenticated;create role bmai_qa_backend;');
  await pg.exec(readFileSync(new URL('../../../../supabase/schemas/native_auth.sql',import.meta.url),'utf8'));
  const wrap=(db:any):PgExecutor=>({query:async(sql,args)=> (await db.query(sql,args)).rows,transaction:work=>db.transaction((tx:any)=>work(wrap(tx)))});
  store=new NativeAuthHandoff(wrap(pg),new CredentialCipher(Buffer.alloc(32,7).toString('base64')));
});
afterEach(()=>pg.close());
describe('native hosted session handoff',()=>{
  it('transfers a distinct AAL2 session with ciphertext at rest and a token-free fixed callback',async()=>{
    const flow=await store.start('macos',challenge(verifier),state,now);
    assertNativeHandoffIdentity(identity(),now);
    await store.reserve(flow.flowId,flow.browserNonce,now);
    const callback=await store.complete(flow.flowId,flow.browserNonce,payload,now);
    expect(new URL(callback).protocol).toBe('bookmarkai-macos-supabase-qa:');
    expect(new URL(callback).searchParams.get('state')).toBe(state);expect(callback).not.toContain('native-access');
    const rows=await pg.query('select payload_ciphertext from bmai_qa.native_auth_flows');
    expect(JSON.stringify(rows.rows)).not.toContain('native-refresh');
    await expect(store.exchange(flow.flowId,verifier,'w'.repeat(43),now)).rejects.toMatchObject({status:403});
    expect(await store.exchange(flow.flowId,verifier,new URL(callback).searchParams.get('code')!,now)).toEqual(payload);
    expect((await pg.query('select payload_ciphertext from bmai_qa.native_auth_flows')).rows[0]).toEqual({payload_ciphertext:null});
    await expect(store.exchange(flow.flowId,verifier,new URL(callback).searchParams.get('code')!,now)).rejects.toMatchObject({status:409});
  });
  it('wrong verifier and browser nonce cannot complete or consume; a second flow cannot decrypt another payload',async()=>{
    const flow=await store.start('ios',challenge(verifier),state,now);
    await expect(store.view(flow.flowId,'x'.repeat(43),now)).rejects.toMatchObject({status:410});
    await expect(store.exchange(flow.flowId,'w'.repeat(43),'c'.repeat(43),now)).rejects.toMatchObject({status:404});
    await store.reserve(flow.flowId,flow.browserNonce,now);
    const callback=await store.complete(flow.flowId,flow.browserNonce,payload,now);
    const second=await store.start('ios',challenge(verifier),state,now);
    await pg.query("update bmai_qa.native_auth_flows set state='ready',payload_ciphertext=(select payload_ciphertext from bmai_qa.native_auth_flows where flow_id=$1),completion_code_hash=(select completion_code_hash from bmai_qa.native_auth_flows where flow_id=$1) where flow_id=$2",[flow.flowId,second.flowId]);
    await expect(store.exchange(second.flowId,verifier,new URL(callback).searchParams.get('code')!,now)).rejects.toThrow();
    expect(await store.exchange(flow.flowId,verifier,new URL(callback).searchParams.get('code')!,now)).toEqual(payload);
  });
  it('cancellation, expiry and late completion fail closed',async()=>{
    const flow=await store.start('android',challenge(verifier),state,now);
    expect(await store.exchange(flow.flowId,verifier,'c'.repeat(43),now)).toBeNull();
    await store.cancel(flow.flowId,verifier);
    await expect(store.complete(flow.flowId,flow.browserNonce,payload,now)).rejects.toMatchObject({status:410});
    await expect(store.exchange(flow.flowId,verifier,'c'.repeat(43),now)).rejects.toMatchObject({status:410});
    const expired=await store.start('ios',challenge(verifier),state,now);
    await expect(store.exchange(expired.flowId,verifier,'c'.repeat(43),now+300_000)).rejects.toMatchObject({status:410});
  });
  it('rejects identity/session swaps, an old web session and an AAL1 downgrade',()=>{
    expect(()=>assertNativeHandoffIdentity(identity('aal1'),now)).toThrow();
    expect(()=>assertNativeHandoffIdentity({...identity(),authenticatedAt:now/1000-60},now)).toThrow();
    expect(()=>assertNativeHandoffPair(identity(),{...identity(),providerUserId:'other'})).toThrow();
    expect(()=>assertNativeHandoffPair(identity(),{...identity(),sessionId:'other'})).toThrow();
    expect(()=>assertNativeHandoffPair(identity(),identity('aal1'))).toThrow();
    expect(()=>assertNativeHandoffPair(identity(),identity())).not.toThrow();
  });
  it('imported provider session uses the normal SDK refresh endpoint and revoked sessions fail',async()=>{
    const jwt=(suffix:string)=>['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({sub:userId,session_id:sessionId,exp:Date.now()/1000+3600,aal:'aal2'})).toString('base64url'),suffix].join('.');
    let revoked=false;const paths:string[]=[];
    const user={id:userId,aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()};
    const sb=createClient('https://native-test.supabase.co','public-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
      const url=String(input);paths.push(url);
      if(revoked)return new Response(JSON.stringify({msg:'Session missing',code:'session_not_found'}),{status:401,headers:{'content-type':'application/json'}});
      if(url.includes('/token?grant_type=refresh_token'))return new Response(JSON.stringify({access_token:jwt('rotated'),refresh_token:'rotated-refresh',expires_in:3600,token_type:'bearer',user}),{headers:{'content-type':'application/json'}});
      if(url.endsWith('/user'))return new Response(JSON.stringify(user),{headers:{'content-type':'application/json'}});
      return new Response(null,{status:204});
    }}});
    expect((await sb.auth.setSession({access_token:jwt('imported'),refresh_token:'native-refresh'})).error).toBeNull();
    expect((await sb.auth.refreshSession()).data.session?.refresh_token).toBe('rotated-refresh');
    expect(paths.some(p=>p.includes('/auth/v1/token?grant_type=refresh_token'))).toBe(true);
    expect(paths.some(p=>p.includes('/oauth/token'))).toBe(false);
    revoked=true;expect((await sb.auth.getUser()).error).not.toBeNull();
  });
});
