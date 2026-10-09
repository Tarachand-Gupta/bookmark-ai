import test from 'node:test';
import assert from 'node:assert/strict';
import { oauthPreflight, productionCallbacks, previousQaCallbacks, publicAuthEnvironment } from './production-oauth-preflight.mjs';
const packages = Object.fromEntries(['CHROME','FIREFOX','SAFARI'].flatMap((browser,i) => [[`SUPABASE_PRODUCTION_EXTENSION_${browser}_CLIENT_ID`,`00000000-0000-4000-8000-00000000000${i+1}`],[`SUPABASE_EXTENSION_${browser}_CLIENT_ID`,`qa-${i}`]]));
const hosted = { SUPABASE_EXTENSION_CLIENT_IDS: Object.values(packages).join(','), SUPABASE_EXTENSION_REDIRECT_URIS: [...new Set([...productionCallbacks,...previousQaCallbacks])].join(',') };
test('promotion requires both independent hosted allowlists and preserves QA IDs', () => {
  assert.equal(oauthPreflight(packages,hosted).passed,true);
  assert.equal(oauthPreflight(packages,{...hosted,SUPABASE_EXTENSION_CLIENT_IDS:hosted.SUPABASE_EXTENSION_CLIENT_IDS.replace(packages.SUPABASE_PRODUCTION_EXTENSION_CHROME_CLIENT_ID,'removed')}).passed,false);
  assert.equal(oauthPreflight(packages,{...hosted,SUPABASE_EXTENSION_REDIRECT_URIS:productionCallbacks.slice(1).join(',')}).passed,false);
  assert.equal(oauthPreflight(packages,{...hosted,SUPABASE_EXTENSION_REDIRECT_URIS:productionCallbacks.join(',')}).previousQaCallbacksPreserved,false);
  assert.equal(oauthPreflight(packages,{...hosted,SUPABASE_EXTENSION_CLIENT_IDS:hosted.SUPABASE_EXTENSION_CLIENT_IDS.replace('qa-0','removed')}).passed,false);
  assert.equal(oauthPreflight(packages,{...hosted,SUPABASE_EXTENSION_REDIRECT_URIS:hosted.SUPABASE_EXTENSION_REDIRECT_URIS.replace('supabase','supabase/')}).passed,false);
});
test('private hosted credentials are excluded from parsed or reported configuration', () => {
  assert.deepEqual(publicAuthEnvironment('DATABASE_URL=private\nSUPABASE_SERVICE_ROLE_KEY=private\nSUPABASE_EXTENSION_CLIENT_IDS="public-id"\n'),{SUPABASE_EXTENSION_CLIENT_IDS:'public-id'});
});
test('quoted hosted CSV remains exact and redacted downloads cannot pass', () => {
  const parsed = publicAuthEnvironment(`SUPABASE_EXTENSION_CLIENT_IDS="${hosted.SUPABASE_EXTENSION_CLIENT_IDS}"\nSUPABASE_EXTENSION_REDIRECT_URIS='${hosted.SUPABASE_EXTENSION_REDIRECT_URIS}'\n`);
  assert.equal(oauthPreflight(packages,parsed).passed,true);
  const redacted = oauthPreflight(packages,{SUPABASE_EXTENSION_CLIENT_IDS:'[REDACTED]',SUPABASE_EXTENSION_REDIRECT_URIS:'[REDACTED]'});
  assert.equal(redacted.passed,false);assert.equal(redacted.publicValuesAvailable,false);
});
