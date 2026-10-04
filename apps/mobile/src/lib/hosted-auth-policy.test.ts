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
  assert.throws(()=>hostedSignInURL(url.replace(origin,'https://evil.invalid'),origin,attempt.flowId));
  assert.throws(()=>hostedSignInURL(url+'#access_token=secret',origin,attempt.flowId));
  assert.throws(()=>hostedSignInURL(url,origin,'x'.repeat(43)));
});
