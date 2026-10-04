"use client";
import { useEffect, useState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { clearNativeBrowserContext, getAuthFlowSupabase, nativeFlowFromLocation, nativeMfaDestination } from '@/lib/native-auth-context';
let transfer:{flow:string;promise:Promise<string|null>}|null=null;
export default function CompleteNativeAuth() {
  const [error,setError]=useState(''),[callback,setCallback]=useState('');
  useEffect(()=>{
    const flow=nativeFlowFromLocation();if(!flow){setError('This sign-in request is invalid. Start again in the app.');return;}
    const sb=getAuthFlowSupabase();
    if(transfer?.flow!==flow.flow)transfer = {flow:flow.flow,promise:(async()=>{
      const {data,error}=await sb.auth.getSession();if(error||!data.session)throw new Error('Return to sign in to complete this request.');
      const assurance=await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      const mfa=nativeMfaDestination(assurance,location.pathname+location.search);
      if(mfa){location.replace(mfa);return null;}
      await sb.auth.stopAutoRefresh();
      const response=await fetch('/api/auth/native/complete',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json',authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify({flowId:flow.flow,browserNonce:flow.nonce,accessToken:data.session.access_token,refreshToken:data.session.refresh_token})});
      if(!response.ok)throw new Error('This sign-in could not finish. Start again in the app.');
      const result=await response.json();
      const url=new URL(result.callbackUrl);
      if(!['bookmarkai-macos-supabase-qa://auth/callback','bookmarkai-supabase-qa://sso-callback'].includes(url.protocol+'//'+url.host+url.pathname)||url.hash||url.username||url.password||url.searchParams.size!==3||url.searchParams.get('flow')!==flow.flow||!/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('state')??'')||!/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code')??''))throw new Error('Unexpected app callback.');
      await clearNativeBrowserContext(flow.flow);history.replaceState(null,'','/auth/native/complete');
      return url.href;
    })()};
    void transfer.promise.then(url=>{if(url){setCallback(url);location.replace(url);}}).catch(async e=>{
      transfer=null;setError(e.message);
      const client=sb;await client.auth.stopAutoRefresh();
      // A failed fresh session never belongs to the app. Revoke it before clearing its temporary storage.
      await client.auth.signOut({scope:'local'}).catch(()=>undefined);await clearNativeBrowserContext(flow.flow);
    });
  },[]);
  return <AuthShell title={error?'Sign-in could not finish':'Return to Bookmark AI'} description={error?'Start a new request from the app.':'Your app is signing in. You can close this browser tab after returning.'}>
    {error?<p role="alert" className="text-sm text-destructive">{error}</p>:<p role="status" className="text-sm text-muted-foreground">Connecting your app…</p>}
    {callback&&<Button asChild className="w-full"><a href={callback}>Return to app</a></Button>}
  </AuthShell>;
}
