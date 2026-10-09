import test from 'node:test';
import assert from 'node:assert/strict';
import { productionEnvironment } from './supabase-production.mjs';
const source = { BOOKMARK_HOSTED_TARGET:'production',BOOKMARK_BUILD_VARIANT:'supabase-qa',BOOKMARK_QA_WEB_URL:'https://www.bookmark-ai.cloud',BOOKMARK_QA_LIVE_URL:'https://live.bookmark-ai.cloud',SUPABASE_URL:'https://xogqaqtyacmecdbmgqqd.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_EXTENSION_CHROME_CLIENT_ID:'old-qa-client',SUPABASE_PRODUCTION_EXTENSION_CHROME_CLIENT_ID:'00000000-0000-4000-8000-000000000001' };
test('production keeps exact production endpoints, separate session storage and production public client',()=>{
  const env=productionEnvironment(source,{PATH:'/bin',CLERK_SECRET_KEY:'never',DEV_OPEN_API:'1'},'chrome');
  assert.equal(env.BOOKMARK_BUILD_VARIANT,'supabase-production');
  assert.equal(env.WXT_AUTH_PROVIDER,'supabase');assert.equal(env.WXT_SUPABASE_OAUTH_CLIENT_ID,source.SUPABASE_PRODUCTION_EXTENSION_CHROME_CLIENT_ID);
  assert.equal(env.WXT_AUTH_STORAGE_NAMESPACE,'bookmark-ai:supabase-production');assert.equal(env.EXPO_PUBLIC_AUTH_REDIRECT_URL,'bookmarkai://sso-callback');
  assert.equal(env.CLERK_SECRET_KEY,undefined);assert.equal(env.DEV_OPEN_API,undefined);
});
test('production refuses QA clients, local endpoints, other projects and bypasses',()=>{
  for(const patch of [{BOOKMARK_HOSTED_TARGET:''},{BOOKMARK_QA_WEB_URL:'http://localhost:3100'},{BOOKMARK_QA_LIVE_URL:'http://localhost:3101'},{SUPABASE_URL:'https://other.supabase.co'},{SUPABASE_PUBLISHABLE_KEY:'sb_secret_private'},{SUPABASE_PRODUCTION_EXTENSION_CHROME_CLIENT_ID:''},{AUTH_PROVIDER:'clerk'},{DEV_OPEN_API:'1'}])assert.throws(()=>productionEnvironment({...source,...patch},{},'chrome'));
});
