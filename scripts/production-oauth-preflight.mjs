#!/usr/bin/env node
/** Read-only comparison of package public IDs with the exact hosted promotion environment. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const productionCallbacks = Object.freeze([
  'https://ffhbgpgebpmofjkehpjcemepbgcmoelp.chromiumapp.org/supabase',
  'https://bbf8f95c67aba661548c23a9abdd835bdefe81a3.extensions.allizom.org/',
  'https://www.bookmark-ai.cloud/auth/extension-callback',
]);
export const previousQaCallbacks = Object.freeze([
  'https://peikdeadpkgjgohdndljbciephekdpfg.chromiumapp.org/supabase',
  'https://2d23e472b97ab51916dd1f2d4be7103f7b50c01b.extensions.allizom.org/',
  'https://www.bookmark-ai.cloud/auth/extension-callback',
]);
// Select only public auth configuration; backend credentials are never returned or logged.
export function publicAuthEnvironment(text) {
  const selected = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?(SUPABASE_(?:EXTENSION_CLIENT_IDS|EXTENSION_REDIRECT_URIS|(?:PRODUCTION_)?EXTENSION_(?:CHROME|FIREFOX|SAFARI)_CLIENT_ID))\s*=\s*(.*?)\s*$/.exec(line);
    if (match) selected[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return selected;
}
export function oauthPreflight(packages, hosted) {
  const publicValuesAvailable = ['SUPABASE_EXTENSION_CLIENT_IDS','SUPABASE_EXTENSION_REDIRECT_URIS'].every(key => typeof hosted[key] === 'string' && hosted[key].length > 0 && !/redact|encrypted|sensitive/i.test(hosted[key]));
  const ids = new Set((hosted.SUPABASE_EXTENSION_CLIENT_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
  const callbacks = new Set((hosted.SUPABASE_EXTENSION_REDIRECT_URIS || '').split(',').map(s => s.trim()).filter(Boolean));
  const productionClientIdsAllowed = ['CHROME', 'FIREFOX', 'SAFARI'].every(browser => {
    const id = packages[`SUPABASE_PRODUCTION_EXTENSION_${browser}_CLIENT_ID`];
    return /^[0-9a-f-]{36}$/i.test(id || '') && ids.has(id);
  });
  const previousQaClientIdsPreserved = ['CHROME', 'FIREFOX', 'SAFARI'].every(browser => {
    const id = packages[`SUPABASE_EXTENSION_${browser}_CLIENT_ID`];
    return !id || ids.has(id);
  });
  const productionCallbacksAllowed = productionCallbacks.every(callback => callbacks.has(callback));
  const previousQaCallbacksPreserved = previousQaCallbacks.every(callback => callbacks.has(callback));
  return { passed: publicValuesAvailable && productionClientIdsAllowed && previousQaClientIdsPreserved && productionCallbacksAllowed && previousQaCallbacksPreserved, publicValuesAvailable, productionClientIdsAllowed, previousQaClientIdsPreserved, productionCallbacksAllowed, previousQaCallbacksPreserved, idCount: ids.size, callbackCount: callbacks.size };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [packageEnv, hostedEnv, report] = process.argv.slice(2);
  if (!packageEnv || !hostedEnv || process.argv.length > 5) throw new Error('Usage: production-oauth-preflight.mjs <package-public-env> <exact-hosted-promotion-env> [report.json]');
  const result = oauthPreflight(publicAuthEnvironment(readFileSync(packageEnv, 'utf8')), publicAuthEnvironment(readFileSync(hostedEnv, 'utf8')));
  if (report) writeFileSync(report, JSON.stringify({ ...result, checkedAt: new Date().toISOString(), packageEnv: resolve(packageEnv), hostedEnv: resolve(hostedEnv) }, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
}
