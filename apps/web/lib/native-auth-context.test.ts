import {expect,it} from 'vitest';
import {createClient} from '@supabase/supabase-js';
import {nativeFlowStorage,nativeFlowFromLocation,nativeMfaDestination} from './native-auth-context';
function storage():Storage {const map=new Map<string,string>();return {get length(){return map.size;},getItem:key=>map.get(key)??null,setItem:(key,value)=>{map.set(key,value);},removeItem:key=>{map.delete(key);},clear:()=>map.clear(),key:index=>[...map.keys()][index]??null};}
const flow='f'.repeat(43),nonce='n'.repeat(43),destination='/auth/native/complete?flow='+flow+'&browser_nonce='+nonce;
it('separate email tabs share only flow PKCE verifier and never provider credentials',()=>{
 const shared=storage(),one=nativeFlowStorage(flow,storage(),shared),two=nativeFlowStorage(flow,storage(),shared),prefix='bmai-native:'+flow;
 one.setItem(prefix+'-code-verifier','pkce');one.setItem(prefix,'provider-session');
 expect(two.getItem(prefix+'-code-verifier')).toBe('pkce');expect(two.getItem(prefix)).toBeNull();
 expect(nativeFlowStorage(flow,storage(),storage()).getItem(prefix+'-code-verifier')).toBeNull();
 expect(nativeFlowFromLocation('?next='+encodeURIComponent('/auth/update-password?next='+encodeURIComponent(destination)),'/auth/callback')).toEqual({flow,nonce});
});
it('MFA navigation retains the existing scoped session and unavailable assurance fails closed',()=>{
 const tab=storage(),clientStorage=nativeFlowStorage(flow,tab,storage());clientStorage.setItem('bmai-native:'+flow,'session');
 expect(nativeMfaDestination({error:null,data:{currentLevel:'aal1',nextLevel:'aal2'}},destination)).toBe('/auth/mfa?next='+encodeURIComponent(destination));
 expect(clientStorage.getItem('bmai-native:'+flow)).toBe('session');
 expect(()=>nativeMfaDestination({error:new Error(),data:null},destination)).toThrow();
 expect(nativeMfaDestination({error:null,data:{currentLevel:'aal2',nextLevel:'aal2'}},destination)).toBeNull();
});
it('provider email OTP fallback works in original scoped tab without an email-browser PKCE verifier',async()=>{
 const uid='00000000-0000-4000-8000-000000000001';
 const token=['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({sub:uid,exp:Date.now()/1000+3600,aal:'aal1'})).toString('base64url'),'signature'].join('.');
 const posted:any[]=[];
 const sb=createClient('https://test.supabase.co','public-key',{auth:{storage:nativeFlowStorage(flow,storage(),storage()),storageKey:'bmai-native:'+flow,persistSession:true,autoRefreshToken:false,flowType:'pkce',detectSessionInUrl:false},global:{fetch:async(input,init)=>{
  expect(String(input)).toContain('/auth/v1/verify');posted.push(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify({access_token:token,refresh_token:'refresh',expires_in:3600,token_type:'bearer',user:{id:uid,aud:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}}),{headers:{'content-type':'application/json'}});
 }}});
 for(const type of ['recovery','signup'] as const){expect((await sb.auth.verifyOtp({email:'qa@example.test',token:'12345678',type})).error).toBeNull();}
 expect(posted.map(v=>[v.type,v.token])).toEqual([['recovery','12345678'],['signup','12345678']]);
 expect((await sb.auth.getSession()).data.session?.user.id).toBe(uid);
});
