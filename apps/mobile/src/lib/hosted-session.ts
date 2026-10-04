import type { SupabaseClient } from '@supabase/supabase-js';
export type HostedSession = {access_token:string;refresh_token:string;user_id:string;session_id:string;expires_at:number};
/** A callback flight is claimed synchronously, including its asynchronous pending-state read. */
export function createHostedCallbackFlight() {
  let flight:Promise<void>|null=null;
  return (work:()=>Promise<void>)=>{
    if(flight)return flight;
    const operation=Promise.resolve().then(work);
    flight=operation;
    void operation.finally(()=>{if(flight===operation)flight=null;}).catch(()=>undefined);
    return operation;
  };
}
function sessionId(token:string):string|undefined {
  try{return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).session_id;}catch{return undefined;}
}
/** Provider validation precedes SDK publication; every unsuccessful adoption revokes this exact session. */
export async function adoptHostedSession(auth:SupabaseClient['auth'],payload:HostedSession,issuer:string,isCurrent:()=>boolean,revoke:()=>Promise<unknown>,commit:()=>Promise<void>) {
  let adopted=false;
  try {
    if(!isCurrent())throw new Error('Sign-in canceled');
    const claims=await auth.getClaims(payload.access_token);
    if(!isCurrent()||claims.error||claims.data?.claims.session_id!==payload.session_id||claims.data.claims.sub!==payload.user_id||claims.data.claims.iss!==issuer)throw new Error('Invalid sign-in session');
    const provider=await auth.getUser(payload.access_token);
    if(!isCurrent()||provider.error||provider.data.user?.id!==payload.user_id)throw new Error('Invalid sign-in identity');
    const imported=await auth.setSession(payload);
    if(!isCurrent()||imported.error||!imported.data.session||imported.data.session.user.id!==payload.user_id||sessionId(imported.data.session.access_token)!==payload.session_id)throw new Error('Invalid sign-in session');
    const assurance=await auth.mfa.getAuthenticatorAssuranceLevel(imported.data.session.access_token);
    if(!isCurrent()||assurance.error||!assurance.data||!['aal1','aal2'].includes(assurance.data.currentLevel??'')||(assurance.data.nextLevel==='aal2'&&assurance.data.currentLevel!=='aal2'))throw new Error('Complete sign-in verification in your browser.');
    await commit();
    if(!isCurrent())throw new Error('Sign-in canceled');
    adopted=true;
  } finally {
    if(!adopted) {
      await revoke();
      // Refresh rotation changes the token pair, so stable provider session_id owns cleanup.
      const current=await auth.getSession();
      if(current.data.session?.user.id===payload.user_id&&sessionId(current.data.session.access_token)===payload.session_id)await auth.signOut({scope:'local'});
    }
  }
}
