import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import {CredentialCipher,PostgresMasterRepository,type PgExecutor} from '@bookmark-ai/db';
import { challenge } from './native-auth-handoff';
let pg:PGlite;
let context:any;
const uid='00000000-0000-4000-8000-000000000021',sid='00000000-0000-4000-8000-000000000022';
const user={id:uid,aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString(),factors:[{status:'verified'}]};
let aal='aal2',refreshSid=sid;
vi.mock('@/lib/server/context',()=>({getMasterContext:()=>context}));
vi.mock('@/lib/auth/server',()=>({getCookieAccessToken:async()=>null}));
vi.mock('@bookmark-ai/engine',async importOriginal=>({...await importOriginal<any>(),createSupabaseVerifier:()=>async(token:string)=>({providerUserId:uid,sessionId:token==='rotated'?refreshSid:sid,accessToken:token,expiresAt:Date.now()/1000+3600,aal,authenticatedAt:Date.now()/1000,user})}));
const route=await import('@/app/api/auth/native/[action]/route');
const key=Buffer.alloc(32,9).toString('base64');
const verifier='v'.repeat(43),state='s'.repeat(43);
async function call(action:string,body:unknown,token?:string){
  return route.POST(new NextRequest(`https://www.bookmark-ai.cloud/api/auth/native/${action}`,{method:'POST',headers:{origin:'https://www.bookmark-ai.cloud','sec-fetch-site':'same-origin','content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)}),{params:Promise.resolve({action})});
}
it('production native starts persist only fixed callbacks and preserve legacy QA requests',async()=>{
  for(const [clientType,callback] of [['macos','bookmarkai-macos://auth/callback'],['ios','bookmarkai://sso-callback'],['android','bookmarkai://sso-callback']]) {
    const response=await call('start',{clientType,buildVariant:'supabase-production',codeChallenge:challenge(verifier),state});
    expect(response.status).toBe(201);
    const flow=await response.json();
    const rows=await pg.query('select client_type,callback_url from bmai_qa.native_auth_flows where flow_id=$1',[flow.flowId]);
    expect(rows.rows[0]).toEqual({client_type:clientType,callback_url:callback});
  }
  const legacy=await (await call('start',{clientType:'macos',codeChallenge:challenge(verifier),state})).json();
  const rows=await pg.query<{callback_url:string}>('select callback_url from bmai_qa.native_auth_flows where flow_id=$1',[legacy.flowId]);
  expect(rows.rows[0].callback_url).toBe('bookmarkai-macos-supabase-qa://auth/callback');
  expect((await call('start',{clientType:'macos',buildVariant:'anything',codeChallenge:challenge(verifier),state})).status).toBe(400);
  expect((await call('start',{clientType:'macos',buildVariant:'supabase-production',callbackUrl:'evil://callback',codeChallenge:challenge(verifier),state})).status).toBe(400);
});
beforeEach(async()=>{
  aal='aal2';refreshSid=sid;pg=new PGlite();
  await pg.exec('create schema bmai_qa;create role anon;create role authenticated;create role bmai_qa_backend;');
  await pg.exec(readFileSync(new URL('../../../../supabase/schemas/native_auth.sql',import.meta.url),'utf8'));
  const wrap=(db:any):PgExecutor=>({query:async(sql,args)=>sql.includes('manage_sessions')?[{sessions:[{id:sid,createdAt:new Date().toISOString()}]}]:(await db.query(sql,args)).rows,transaction:work=>db.transaction((tx:any)=>work(wrap(tx)))});
  context={db:new PostgresMasterRepository(wrap(pg),new CredentialCipher(key)),ready:Promise.resolve()};
  vi.stubEnv('MASTER_CREDENTIAL_ENCRYPTION_KEY',key);vi.stubEnv('SUPABASE_URL','https://native-test.supabase.co');vi.stubEnv('SUPABASE_PUBLISHABLE_KEY','public-key');
  vi.stubGlobal('fetch',async(input:any)=>String(input).includes('/token?grant_type=refresh_token')?new Response(JSON.stringify({access_token:'rotated',refresh_token:'rotated-refresh',expires_in:3600,token_type:'bearer',user}),{headers:{'content-type':'application/json'}}):new Response(null,{status:204}));
});
afterEach(async()=>{await pg.close();vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('actual start→hosted AAL2 complete→native PKCE exchange creates one isolated session and consumes once',async()=>{
  const start=await call('start',{clientType:'ios',codeChallenge:challenge(verifier),state});expect(start.status).toBe(201);
  const flow=await start.json();const next=new URL(new URL(flow.browserUrl).searchParams.get('next')!,'https://www.bookmark-ai.cloud');
  const nonce=next.searchParams.get('browser_nonce');
  const completed=await call('complete',{flowId:flow.flowId,browserNonce:nonce,accessToken:'native-access',refreshToken:'native-refresh'},'native-access');
  expect(completed.status).toBe(200);const result=await completed.json();expect(JSON.stringify(result)).not.toContain('rotated-refresh');const completionCode=new URL(result.callbackUrl).searchParams.get('code');
  expect((await call('exchange',{flowId:flow.flowId,verifier:'x'.repeat(43),completionCode})).status).toBe(404);
  expect((await call('exchange',{flowId:flow.flowId,verifier,completionCode:'c'.repeat(43)})).status).toBe(403);
  expect((await call('exchange',{flowId:flow.flowId,verifier})).status).toBe(400);
  const imported=await call('exchange',{flowId:flow.flowId,verifier,completionCode});expect(imported.status).toBe(200);
  expect((await imported.json()).session).toMatchObject({session_id:sid,user_id:uid,refresh_token:'rotated-refresh'});
  expect((await call('exchange',{flowId:flow.flowId,verifier,completionCode})).status).toBe(409);
});
it('actual completion refuses AAL1 and a refresh credential from another signed session',async()=>{
  const flow=await (await call('start',{clientType:'macos',codeChallenge:challenge(verifier),state})).json();
  const next=new URL(new URL(flow.browserUrl).searchParams.get('next')!,'https://www.bookmark-ai.cloud');
  const body={flowId:flow.flowId,browserNonce:next.searchParams.get('browser_nonce'),accessToken:'native-access',refreshToken:'native-refresh'};
  aal='aal1';expect((await call('complete',body,'native-access')).status).toBe(403);
  aal='aal2';refreshSid='00000000-0000-4000-8000-000000000099';expect((await call('complete',body,'native-access')).status).toBe(403);
  expect((await call('exchange',{flowId:flow.flowId,verifier,completionCode:'c'.repeat(43)})).status).toBe(202);
});

it('concurrent completion claims the flow before rotating; the loser cannot revoke the winner',async()=>{
  const flow=await (await call('start',{clientType:'ios',codeChallenge:challenge(verifier),state})).json();
  const next=new URL(new URL(flow.browserUrl).searchParams.get('next')!,'https://www.bookmark-ai.cloud');
  const body={flowId:flow.flowId,browserNonce:next.searchParams.get('browser_nonce'),accessToken:'native-access',refreshToken:'native-refresh'};
  let release!:()=>void,entered!:()=>void,rotations=0,revocations=0;
  const barrier=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
  vi.stubGlobal('fetch',async(input:any)=>{
    if(String(input).includes('/token?grant_type=refresh_token')){rotations++;entered();await barrier;return new Response(JSON.stringify({access_token:'rotated',refresh_token:'rotated-refresh',expires_in:3600,token_type:'bearer',user}),{headers:{'content-type':'application/json'}});}
    if(String(input).includes('/logout'))revocations++;
    return new Response(null,{status:204});
  });
  const first=call('complete',body,'native-access');await started;
  const loser=await call('complete',body,'native-access');expect([409,410]).toContain(loser.status);
  release();expect((await first).status).toBe(200);expect(rotations).toBe(1);expect(revocations).toBe(0);
});
