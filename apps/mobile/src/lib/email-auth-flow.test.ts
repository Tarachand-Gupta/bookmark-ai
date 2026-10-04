import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import type {Session, SupabaseClient} from '@supabase/supabase-js';
import {createEmailAuthFlow,validEmailCode} from './email-auth-flow';
const email='owned@example.test',session={access_token:'access',refresh_token:'refresh',user:{id:'owned',email}} as Session;
const ok=(session:Session|null=null)=>({data:{session,user:session?.user??null},error:null});
const error=(code:string)=>({data:{session:null,user:null},error:{code,message:code}});
function fixture(){
 const calls:any[]=[];let current:Session|null=null;
 const raw={
  signInWithPassword:async(value:unknown)=>{calls.push(['password',value]);current=session;return ok(session);},
  signUp:async(value:unknown)=>{calls.push(['signup',value]);return {data:{session:null,user:{id:'new',identities:[{}]}},error:null};},
  resend:async(value:unknown)=>{calls.push(['resend',value]);return {data:{},error:null};},
  signInWithOtp:async(value:unknown)=>{calls.push(['sendCode',value]);return ok();},
  resetPasswordForEmail:async(value:unknown)=>{calls.push(['recovery',value]);return {data:{},error:null};},
  verifyOtp:async(value:unknown)=>{calls.push(['verify',value]);current=session;return ok(session);},
  updateUser:async(value:unknown)=>{calls.push(['update',value]);return {data:{user:session.user},error:null};},
  getSession:async()=>ok(current),
  signOut:async(value:unknown)=>{calls.push(['signOut',value]);current=null;return {error:null};},
 };
 let adoption:((s:Session,current:()=>boolean)=>Promise<void>)|null=null;
 const adopt=async(s:Session,current:()=>boolean)=>{if(adoption)return adoption(s,current);assert.equal(current(),true);calls.push(['adopt',s.user.id]);};
 const flow=createEmailAuthFlow(raw as unknown as SupabaseClient['auth'],'https://www.bookmark-ai.cloud/auth/callback',adopt);
 return {raw,flow,calls,setAdopt:(f:typeof adoption)=>adoption=f};
}
test('existing password session completes and verified signup keeps the original code phase',async()=>{
 const f=fixture();assert.equal((await f.flow.password(email,'password')).phase,'complete');
 const g=fixture();g.raw.signInWithPassword=async()=>error('invalid_credentials') as any;
 assert.deepEqual(await g.flow.password(email,'new-password'),{phase:'code',mode:'signUp'});
 assert.equal(g.calls.some(v=>v[0]==='adopt'),false);
 await g.flow.verify(email,'signUp','12345678','');
 assert.equal(g.calls.find(v=>v[0]==='verify')[1].type,'email');assert.equal(g.calls.at(-1)[0],'adopt');
});
test('unconfirmed email resends confirmation and obfuscated existing signup cannot publish',async()=>{
 const f=fixture();f.raw.signInWithPassword=async()=>error('email_not_confirmed') as any;
 assert.equal((await f.flow.password(email,'password')).phase,'code');
 assert.equal(f.calls.find(v=>v[0]==='resend')[1].type,'signup');
 const g=fixture();g.raw.signInWithPassword=async()=>error('invalid_credentials') as any;
 g.raw.signUp=async()=>({data:{session:null,user:{id:'obfuscated',identities:[]}},error:null});
 await assert.rejects(g.flow.password(email,'wrong-password'),/Check your email and password/);
 assert.equal(g.calls.some(v=>v[0]==='adopt'),false);
});
test('email code stays existing-only and accepts configured eight-digit OTP',async()=>{
 const f=fixture();assert.deepEqual(await f.flow.code(email),{phase:'code',mode:'signIn'});
 assert.equal(f.calls.find(v=>v[0]==='sendCode')[1].options.shouldCreateUser,false);
 await f.flow.verify(email,'signIn','12345678','');assert.equal(f.calls.find(v=>v[0]==='verify')[1].type,'email');
 assert(validEmailCode('12345678'));assert(!validEmailCode('12345'));assert(!validEmailCode('abcdef12'));
});
test('recovery verifies provider recovery OTP and saves password before publishing the session',async()=>{
 const f=fixture();await f.flow.recovery(email);assert.equal(f.calls.some(v=>v[0]==='adopt'),false);
 await f.flow.verify(email,'reset','12345678','new-password');
 assert.deepEqual(f.calls.filter(v=>['verify','update','adopt'].includes(v[0])).map(v=>v[0]),['verify','update','adopt']);
 assert.equal(f.calls.find(v=>v[0]==='verify')[1].type,'recovery');
});
test('failed recovery password update retries its verified session without consuming OTP twice',async()=>{
 const f=fixture();await f.flow.recovery(email);let fail=true;
 f.raw.updateUser=async()=>{if(fail){fail=false;return {data:{user:null},error:{message:'offline'}} as any;}return {data:{user:session.user},error:null};};
 await assert.rejects(f.flow.verify(email,'reset','12345678','new-password'));
 assert.equal(f.calls.some(v=>v[0]==='adopt'),false);
 await f.flow.verify(email,'reset','12345678','new-password');assert.equal(f.calls.filter(v=>v[0]==='verify').length,1);
});
test('canceled in-flight password response is revoked and never adopted',async()=>{
 const f=fixture();let release!:()=>void;
 const delayed=new Promise<void>(r=>release=r),original=f.raw.signInWithPassword;
 f.raw.signInWithPassword=async(value)=>{await delayed;return original(value);};
 const operation=f.flow.password(email,'password');await new Promise(r=>setImmediate(r));await f.flow.reset();release();
 await assert.rejects(operation,/canceled/);assert.equal(f.calls.some(v=>v[0]==='adopt'),false);assert(f.calls.some(v=>v[0]==='signOut'));
});
test('identity mismatch and failed adoption revoke only the ephemeral local session',async()=>{
 const f=fixture();await f.flow.code(email);f.raw.verifyOtp=async()=>ok({...session,user:{...session.user,email:'other@example.test'}});
 await assert.rejects(f.flow.verify(email,'signIn','12345678',''),/identity/);assert.equal(f.calls.some(v=>v[0]==='adopt'),false);
 const g=fixture();g.setAdopt(async()=>{throw new Error('invalid import');});await assert.rejects(g.flow.password(email,'password'),/invalid import/);
 assert(g.calls.some(v=>v[0]==='signOut'&&v[1].scope==='local'));
 g.setAdopt(null);assert.equal((await g.flow.password(email,'password')).phase,'complete');
});
