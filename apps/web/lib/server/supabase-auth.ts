import { headers } from 'next/headers';
import { withAuthDeadline, createSupabaseVerifier, InvalidSessionError, AuthUnavailableError, type VerifiedSupabaseSession, classifyOAuthClient } from '@bookmark-ai/engine';
import { AccountDisabledError, isPostgresMasterRepository } from '@bookmark-ai/db';
import { getMasterContext } from './context';
export { InvalidSessionError, AuthUnavailableError };
export class MfaRequiredError extends Error {}
export type WebAuth = VerifiedSupabaseSession & {userId:string};
export function isSupabaseAuth(){return process.env.AUTH_PROVIDER==='supabase'||['supabase-qa','supabase-production'].includes(process.env.BOOKMARK_BUILD_VARIANT??'');}
export async function getWebAuth(options:{allowExtension?:boolean}={}):Promise<WebAuth|null>{
  return withAuthDeadline(async()=>{
  if(!isSupabaseAuth()||process.env.AUTH_PROVIDER!=='supabase'||!['supabase-qa','supabase-production'].includes(process.env.BOOKMARK_BUILD_VARIANT??'')||!process.env.SUPABASE_URL||!process.env.SUPABASE_PUBLISHABLE_KEY)throw new AuthUnavailableError('Supabase auth not configured');
  const h=await headers();const header=h.get('authorization');
  const bearer=header?.startsWith('Bearer ')?header.slice(7).trim():null;
  const token=header?bearer:await (await import('@/lib/auth/server')).getCookieAccessToken();
  if(!token)return null;
  try{
    const verify=createSupabaseVerifier({url:process.env.SUPABASE_URL??'',publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY??''});
    const session=await verify(token);
    const capability=classifyOAuthClient(session.clientId,(process.env.SUPABASE_EXTENSION_CLIENT_IDS??"").split(",").map(s=>s.trim()).filter(Boolean));
    if(capability === "denied" || (capability === "extension" && !options.allowExtension)) throw new InvalidSessionError("Invalid session capability");
    if(session.user.factors?.some(f=>f.status==='verified')&&session.aal!=='aal2')throw new MfaRequiredError();
    const master=getMasterContext();if(!master||!isPostgresMasterRepository(master.db))throw new AuthUnavailableError('Master unavailable');
    await master.ready;
    const userId=await master.db.resolveAccount(session.providerUserId);
    return {...session,userId};
  }catch(error){
    if(error instanceof InvalidSessionError||error instanceof AccountDisabledError)return null;
    if(error instanceof MfaRequiredError||error instanceof AuthUnavailableError)throw error;
    throw new AuthUnavailableError('Auth temporarily unavailable');
  }
  });
}
