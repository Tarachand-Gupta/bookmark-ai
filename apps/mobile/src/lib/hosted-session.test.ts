import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {adoptHostedSession,createHostedCallbackFlight} from './hosted-session';
const uid='user',sid='session',issuer='https://test.supabase.co/auth/v1';
const jwt=(id=sid)=>`e30.${Buffer.from(JSON.stringify({session_id:id})).toString('base64url')}.sig`;
const payload={user_id:uid,session_id:sid,access_token:jwt(),refresh_token:'refresh',expires_at:Date.now()/1000+3600};
function fixture() {
  let current:any=null,revoked=0,signedOut=0;
  const auth={getClaims:async()=>({data:{claims:{session_id:sid,sub:uid,iss:issuer}},error:null}),getUser:async()=>({data:{user:{id:uid}},error:null}),setSession:async()=>{current={user:{id:uid},access_token:jwt(),refresh_token:'rotated'};return {data:{session:current},error:null};},getSession:async()=>({data:{session:current},error:null}),signOut:async()=>{signedOut++;current=null;return {error:null};},mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal2',nextLevel:'aal2'},error:null})}};
  return {auth:auth as unknown as SupabaseClient['auth'],raw:auth,revoke:async()=>{revoked++;},counts:()=>({revoked,signedOut})};
}
test('external Linking and browser callback claim one flight before deferred storage read',async()=>{
  const run=createHostedCallbackFlight();let release!:()=>void,reads=0,exchanges=0;
  const pending=new Promise<void>(r=>release=r);
  const work=async()=>{reads++;await pending;exchanges++;};
  const first=run(work),second=run(work);assert.equal(first,second);
  release();await Promise.all([first,second]);assert.equal(reads,1);assert.equal(exchanges,1);
});
test('cancellation during assurance revokes and clears exact imported session after refresh rotation',async()=>{
  const f=fixture();let current=true;
  f.raw.mfa.getAuthenticatorAssuranceLevel=async()=>{current=false;return {data:{currentLevel:'aal2',nextLevel:'aal2'},error:null};};
  await assert.rejects(adoptHostedSession(f.auth,payload,issuer,()=>current,f.revoke,async()=>{}));
  assert.deepEqual(f.counts(),{revoked:1,signedOut:1});
});
test('canceled before import or provider failure revokes returned payload without erasing another session',async()=>{
  const f=fixture();await assert.rejects(adoptHostedSession(f.auth,payload,issuer,()=>false,f.revoke,async()=>{}));
  assert.deepEqual(f.counts(),{revoked:1,signedOut:0});
  const g=fixture();g.raw.getClaims=async()=>{throw new Error('network');};
  await assert.rejects(adoptHostedSession(g.auth,payload,issuer,()=>true,g.revoke,async()=>{}));assert.deepEqual(g.counts(),{revoked:1,signedOut:0});
});
test('successful AAL2 adoption commits once and AAL1 cannot bypass verification',async()=>{
  const f=fixture();let commits=0;await adoptHostedSession(f.auth,payload,issuer,()=>true,f.revoke,async()=>{commits++;});assert.equal(commits,1);assert.deepEqual(f.counts(),{revoked:0,signedOut:0});
  const g=fixture();g.raw.mfa.getAuthenticatorAssuranceLevel=async()=>({data:{currentLevel:'aal1',nextLevel:'aal2'},error:null});
  await assert.rejects(adoptHostedSession(g.auth,payload,issuer,()=>true,g.revoke,async()=>{}));assert.deepEqual(g.counts(),{revoked:1,signedOut:1});
});
test('native email may retain AAL1 only for the existing fail-closed authenticator gate',async()=>{
 const f=fixture();let commits=0;
 f.raw.mfa.getAuthenticatorAssuranceLevel=async()=>({data:{currentLevel:'aal1',nextLevel:'aal2'},error:null});
 await adoptHostedSession(f.auth,payload,issuer,()=>true,f.revoke,async()=>{commits++;},true);
 assert.equal(commits,1);assert.deepEqual(f.counts(),{revoked:0,signedOut:0});
});
