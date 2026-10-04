"use client";
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getBrowserSupabase } from './auth';
import { authDestinationFromSearch } from './auth-policy';
const clients = new Map<string,SupabaseClient>();
const opaque=/^[A-Za-z0-9_-]{43}$/;
export function nativeFlowFromLocation(search=window.location.search, path=window.location.pathname) {
  let destination=path==='/auth/native/complete'?new URL(path+search,'https://bookmark.invalid'):new URL(authDestinationFromSearch(search),'https://bookmark.invalid');
  for(let depth=0;depth<3&&destination.pathname!=='/auth/native/complete';depth++) {
    const next=destination.searchParams.get('next');if(!next)return null;
    destination=new URL(next,'https://bookmark.invalid');
  }
  if(destination.origin!=='https://bookmark.invalid'||destination.pathname!=='/auth/native/complete')return null;
  const target=destination.searchParams;
  const flow=target.get('flow'),nonce=target.get('browser_nonce');
  if(!flow||!nonce||!opaque.test(flow)||!opaque.test(nonce)||target.getAll('flow').length!==1||target.getAll('browser_nonce').length!==1)return null;
  return {flow,nonce};
}
/** Only PKCE verifier crosses email tabs; provider session tokens remain tab-scoped. */
export function nativeFlowStorage(flow:string, tab:Storage, shared:Storage) {
  const prefix=`bmai-native:${flow}`;
  const verifier=(key:string)=>key.startsWith(prefix)&&key.endsWith('-code-verifier');
  return {getItem:(key:string)=>(verifier(key)?shared:tab).getItem(key),setItem:(key:string,value:string)=>(verifier(key)?shared:tab).setItem(key,value),removeItem:(key:string)=>(verifier(key)?shared:tab).removeItem(key)};
}
export function getAuthFlowSupabase():SupabaseClient {
  const flow=nativeFlowFromLocation();if(!flow)return getBrowserSupabase();
  let client=clients.get(flow.flow);
  if(!client) {
    client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{storage:nativeFlowStorage(flow.flow,window.sessionStorage,window.localStorage),storageKey:`bmai-native:${flow.flow}`,flowType:'pkce',detectSessionInUrl:false,persistSession:true,autoRefreshToken:false}});
    clients.set(flow.flow,client);
  }
  return client;
}
export async function clearNativeBrowserContext(flow:string) {
  const client=clients.get(flow);await client?.auth.stopAutoRefresh();clients.delete(flow);
  // Do not call provider signOut: the session now belongs to the native SDK.
  for(const storage of [sessionStorage,localStorage])for(let i=storage.length-1;i>=0;i--){const key=storage.key(i);if(key?.startsWith(`bmai-native:${flow}`))storage.removeItem(key);}
}

/** A required MFA navigation retains the dedicated session; only failed transfer is cleaned up. */
export function nativeMfaDestination(assurance:{error:unknown;data:{currentLevel:string|null;nextLevel:string|null}|null},next:string):string|null {
  if(assurance.error||!assurance.data||!['aal1','aal2'].includes(assurance.data.currentLevel??''))throw new Error('Verification is temporarily unavailable.');
  return assurance.data.nextLevel==='aal2'&&assurance.data.currentLevel!=='aal2'?'/auth/mfa?next='+encodeURIComponent(next):null;
}
