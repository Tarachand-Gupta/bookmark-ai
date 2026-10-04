import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedCallback,hostedSignInURL,type HostedAttempt} from './hosted-auth-policy';
const attempt:HostedAttempt={flowId:'f'.repeat(43),state:'s'.repeat(43),verifier:'v'.repeat(43),expiresAt:10_000};
const redirect='bookmarkai-supabase-qa://sso-callback';
const callback=redirect+'?'+new URLSearchParams({flow:attempt.flowId,state:attempt.state,code:"c".repeat(43)});
test('hosted callback accepts only exact app + flow + state before expiry',()=>{
  assert.equal(hostedCallback(callback,redirect,attempt,1).flowId,attempt.flowId);
  for(const url of [callback.replace('sso-callback','other'),callback.replace(attempt.state,'x'.repeat(43)),callback+'&state='+attempt.state,callback+'&access_token=secret',callback+'#refresh_token=secret'])assert.throws(()=>hostedCallback(url,redirect,attempt,1));
  assert.throws(()=>hostedCallback(callback,redirect,null,1));assert.throws(()=>hostedCallback(callback,redirect,attempt,10_000));
});
test('server cannot redirect native Sign In to a foreign website or a token-bearing URL',()=>{
  const origin='https://www.bookmark-ai.cloud';
  const next='/auth/native/complete?'+new URLSearchParams({flow:attempt.flowId,browser_nonce:'n'.repeat(43)});
  const url=origin+'/sign-in?'+new URLSearchParams({next});
  assert.equal(hostedSignInURL(url,origin,attempt.flowId),url);
  assert.equal(new URL(hostedSignInURL(url,origin,attempt.flowId,'google')).searchParams.get('native_provider'),'google');
  assert.throws(()=>hostedSignInURL(url.replace(origin,'https://evil.invalid'),origin,attempt.flowId));
  assert.throws(()=>hostedSignInURL(url+'#access_token=secret',origin,attempt.flowId));
  assert.throws(()=>hostedSignInURL(url,origin,'x'.repeat(43)));
});

test('exact native URL polyfill validates canonical start and callback without URLSearchParams.size',async(t)=>{
  const {createRequire}=await import('node:module');
  const require=createRequire(import.meta.url);
  const nativeRequire=createRequire(require.resolve('react-native-url-polyfill/package.json'));
  const polyfill=nativeRequire('whatwg-url-without-unicode');
  const originalURL=globalThis.URL,originalParams=globalThis.URLSearchParams;
  globalThis.URL=polyfill.URL;globalThis.URLSearchParams=polyfill.URLSearchParams;
  t.after(()=>{globalThis.URL=originalURL;globalThis.URLSearchParams=originalParams;});
  const origin='https://www.bookmark-ai.cloud';
  const next='/auth/native/complete?'+new URLSearchParams({flow:attempt.flowId,browser_nonce:'n'.repeat(43)});
  const start=origin+'/sign-in?'+new URLSearchParams({next});
  assert.equal((new URL(start).searchParams as any).size,undefined,'exercise the shipped native polyfill');
  for(const provider of ['google','apple'] as const){
    const accepted=new URL(hostedSignInURL(start,origin,attempt.flowId,provider));
    assert.equal(accepted.origin,origin);assert.equal(accepted.searchParams.get('native_provider'),provider);
  }
  assert.equal(hostedCallback(callback,redirect,attempt,1).completionCode,'c'.repeat(43));
  const withNext=(value:string)=>origin+'/sign-in?'+new URLSearchParams({next:value});
  for(const value of [start+'&next='+encodeURIComponent(next),start+'&unknown=value',start.replace(origin,'https://bookmark-ai.cloud'),start.replace(origin,'https://evil.invalid'),start+'#access_token=secret',withNext(next+'&flow='+attempt.flowId),withNext(next+'&unknown=value'),withNext(next.replace('n'.repeat(43),'bad')),withNext('https://evil.invalid'+next)]){
    assert.throws(()=>hostedSignInURL(value,origin,attempt.flowId));
  }
  for(const value of [callback+'&code='+'c'.repeat(43),callback+'&state='+attempt.state,callback+'&unknown=value',callback.replace(attempt.state,'x'.repeat(43)),callback.replace(attempt.flowId,'x'.repeat(43)),callback+'&access_token=secret',callback+'#refresh_token=secret',callback.replace('sso-callback','other')]){
    assert.throws(()=>hostedCallback(value,redirect,attempt,1));
  }
  assert.throws(()=>hostedCallback(callback,redirect,null,1));
  assert.throws(()=>hostedCallback(callback,redirect,attempt,attempt.expiresAt));
});
