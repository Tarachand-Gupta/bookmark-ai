export type HostedAttempt = { flowId: string; state: string; verifier: string; expiresAt: number };
const opaque=/^[A-Za-z0-9_-]{43}$/;
// The installed React Native URL polyfill predates URLSearchParams.size.
const parameterCount=(params:URLSearchParams)=>Array.from(params).length;
export function hostedCallback(url:string, redirect:string, attempt:HostedAttempt|null, now=Date.now()) {
  const target=new URL(url),expected=new URL(redirect);
  if(target.protocol!==expected.protocol||target.host!==expected.host||target.pathname!==expected.pathname||target.username||target.password||target.hash)throw new Error('Unexpected sign-in callback');
  if(!attempt||!opaque.test(attempt.flowId)||!opaque.test(attempt.verifier)||attempt.expiresAt<=now||target.searchParams.getAll('flow').length!==1||target.searchParams.getAll('state').length!==1||target.searchParams.get('flow')!==attempt.flowId||target.searchParams.get('state')!==attempt.state||parameterCount(target.searchParams)!==3||!opaque.test(target.searchParams.get('code')??''))throw new Error('Sign-in expired or belongs to another attempt');
  return {...attempt,completionCode:target.searchParams.get('code')!};
}
export function hostedSignInURL(value:string, origin:string, flowId:string, provider?: "google" | "apple") {
  const url=new URL(value),base=new URL(origin);
  if(url.origin!==base.origin||url.pathname!=='/sign-in'||url.hash||url.username||url.password||parameterCount(url.searchParams)!==1)throw new Error('Unexpected sign-in address');
  const next=new URL(url.searchParams.get('next')??'',base);
  if(next.origin!==base.origin||next.pathname!=='/auth/native/complete'||next.searchParams.get('flow')!==flowId||!opaque.test(next.searchParams.get('browser_nonce')??'')||parameterCount(next.searchParams)!==2)throw new Error('Unexpected sign-in destination');
  if(provider)url.searchParams.set('native_provider',provider);
  return url.href;
}
