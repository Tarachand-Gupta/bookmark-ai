import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify, errors, type JWTVerifyGetKey } from 'jose';

export class InvalidSessionError extends Error {}
export class AuthUnavailableError extends Error {}
/** Whole-request auth bound, including provider and control-plane lookups. */
export const AUTH_VALIDATION_DEADLINE_MS = 10_000;
export async function withAuthDeadline<T>(work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AuthUnavailableError('Authentication deadline exceeded')), AUTH_VALIDATION_DEADLINE_MS); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
export type SupabaseAuthUser = {id:string;email?:string;user_metadata?:Record<string,unknown>;app_metadata?:Record<string,unknown>;factors?:Array<{status:string}>};
export type VerifiedSupabaseSession = {providerUserId:string;sessionId:string;accessToken:string;expiresAt:number;aal:string;authenticatedAt:number;clientId?:unknown;user:SupabaseAuthUser};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keySets=new Map<string,JWTVerifyGetKey>();
export function isNativeSessionId(id:unknown):id is string{return typeof id==='string'&&UUID.test(id);}

/** Cached signing keys are safe; session approval is never cached. */
export function createSupabaseVerifier(config:{url:string;publishableKey:string}, dependencies:{fetch?:typeof fetch;key?:JWTVerifyGetKey}={}) {
  let base:URL;try{base=new URL(config.url);}catch{throw new AuthUnavailableError('Auth is not configured');}
  if(base.protocol!=='https:'||base.pathname!=='/'||base.search||base.hash||!config.publishableKey)throw new AuthUnavailableError('Auth is not configured');
  const issuer=`${base.origin}/auth/v1`;
  let key=dependencies.key??keySets.get(issuer);
  if(!key){key=createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`),{timeoutDuration:8000,cooldownDuration:30000,cacheMaxAge:600000});keySets.set(issuer,key);}
  const fetcher=dependencies.fetch??fetch;
  return async (token:string):Promise<VerifiedSupabaseSession>=>{
    if(!token||token.length>16384)throw new InvalidSessionError('Invalid session');
    // Reject random/stale/wrong-project traffic before any online lookup.
    try{
      const header=decodeProtectedHeader(token);const c=decodeJwt(token);
      if(!['ES256','RS256'].includes(String(header.alg))||!header.kid||c.iss!==issuer||c.aud!=='authenticated'||c.role!=='authenticated'||!isNativeSessionId(c.sub)||!isNativeSessionId(c.session_id)||typeof c.exp!=='number'||c.exp<=Date.now()/1000)throw new Error();
    }catch{throw new InvalidSessionError('Invalid session');}
    let claims;
    try{claims=(await jwtVerify(token,key,{issuer,audience:'authenticated',algorithms:['ES256','RS256'],requiredClaims:['sub','exp','iat','session_id']})).payload;}
    catch(error){
      const invalidCodes=['ERR_JWT_EXPIRED','ERR_JWT_CLAIM_VALIDATION_FAILED','ERR_JWT_INVALID','ERR_JWS_INVALID','ERR_JWS_SIGNATURE_VERIFICATION_FAILED','ERR_JOSE_ALG_NOT_ALLOWED','ERR_JWKS_NO_MATCHING_KEY'];
      if(error instanceof errors.JOSEError && invalidCodes.includes(error.code))throw new InvalidSessionError('Invalid session');
      throw new AuthUnavailableError('Auth temporarily unavailable');
    }
    let response:Response;
    try{
      // Node's RequestInit declarations omit Next's cache field; the runtime
      // option must still explicitly disable framework fetch caching.
      const options:NonNullable<Parameters<typeof fetch>[1]> & {cache:'no-store'}={headers:{apikey:config.publishableKey,authorization:`Bearer ${token}`,'cache-control':'no-store'},signal:AbortSignal.timeout(8000),cache:'no-store'};
      response=await fetcher(`${issuer}/user`,options);
    }
    catch{throw new AuthUnavailableError('Auth temporarily unavailable');}
    if(response.status===401||response.status===403)throw new InvalidSessionError('Invalid session');
    if(!response.ok)throw new AuthUnavailableError('Auth temporarily unavailable');
    let user:SupabaseAuthUser;try{user=await response.json() as SupabaseAuthUser;}catch{throw new AuthUnavailableError('Invalid auth response');}
    if(user.id!==claims.sub)throw new InvalidSessionError('Invalid session');
    return {providerUserId:user.id,sessionId:String(claims.session_id),accessToken:token,expiresAt:Number(claims.exp),aal:String(claims.aal??'aal1'),authenticatedAt:Array.isArray(claims.amr)?Math.max(0,...claims.amr.map((a:any)=>typeof a.timestamp==='number'?a.timestamp:0)):0,clientId:claims.client_id,user};
  };
}
