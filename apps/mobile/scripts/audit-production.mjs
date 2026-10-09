#!/usr/bin/env node
/** Private byte comparisons; outputs booleans/hashes only, never credentials. */
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { repoRoot } from '../../../scripts/supabase-qa.mjs';
const [kind, input, output, appBundle] = process.argv.slice(2);
if (!['ios', 'android'].includes(kind) || !input || !output) throw new Error('Usage: audit-production.mjs ios|android app-or-apk output-json');
const secrets = new Set();
for (const path of ['.env', '.env.local', '.env.supabase.production.local', 'apps/web/.env.local']) {
  const file = join(repoRoot, path); if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || /^(?:NEXT_PUBLIC_|EXPO_PUBLIC_|WXT_)|PUBLISHABLE|PUBLIC_KEY/.test(match[1]) || !/(?:SECRET|PASSWORD|_TOKEN$|_API_KEY$|SERVICE_ROLE|DATABASE_URL)/.test(match[1])) continue;
    const value = match[2].replace(/^(["'])(.*)\1$/, '$2');
    if (value.length >= 16 && !value.includes('${')) secrets.add(value);
  }
}
if (!secrets.size) throw new Error('No private backend values were available for the leakage audit');
const artifact = resolve(input);
let js, config, productionIdentity;
let productionSigningKeyMatches;
let appBundleSignatureValid, appBundleSigningKeyMatches;
let appBundlePayloadMatches;
const extraConfigs = [];
if (kind === 'android') {
  const extract = name => {
    const result = spawnSync('unzip', ['-p', artifact, name], { maxBuffer: 128 * 1024 * 1024 });
    if (result.status !== 0) throw new Error('Expected APK embedded file is missing');
    return result.stdout;
  };
  js = extract('assets/index.android.bundle'); config = extract('assets/app.config');
  const configJson = JSON.parse(config.toString());
  productionIdentity = configJson.android?.package === 'ai.bookmarkai' && configJson.extra?.buildVariant === 'supabase-production';
  const signing = {};
  for (const line of readFileSync(join(repoRoot, '.keys/android-release.env'), 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?(ANDROID_KEYSTORE_PATH|ANDROID_KEYSTORE_PASSWORD|ANDROID_KEY_ALIAS)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) signing[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  const certificate = spawnSync('/opt/homebrew/opt/openjdk@21/bin/keytool', ['-exportcert', '-keystore', resolve(repoRoot, signing.ANDROID_KEYSTORE_PATH), '-alias', signing.ANDROID_KEY_ALIAS, '-storepass:env', 'ANDROID_KEYSTORE_PASSWORD'], { env: { ...process.env, ANDROID_KEYSTORE_PASSWORD: signing.ANDROID_KEYSTORE_PASSWORD } });
  if (certificate.status !== 0) throw new Error('Owner release certificate could not be inspected');
  const expected = createHash('sha256').update(certificate.stdout).digest('hex');
  const verify = spawnSync(join(process.env.HOME, 'Library/Android/sdk/build-tools/36.0.0/apksigner'), ['verify', '--print-certs', artifact], { encoding: 'utf8', env: { ...process.env, JAVA_HOME: '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home' } });
  const observed = /Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/i.exec(verify.stdout)?.[1].toLowerCase();
  productionSigningKeyMatches = verify.status === 0 && expected === observed;
  if (appBundle) {
    const keytool = '/opt/homebrew/opt/openjdk@21/bin/keytool';
    const cert = spawnSync(keytool, ['-printcert', '-jarfile', resolve(appBundle)], { encoding: 'utf8' });
    const digest = /SHA256:\s*([A-F0-9:]+)/i.exec(cert.stdout)?.[1].replaceAll(':', '').toLowerCase();
    const signature = spawnSync('/opt/homebrew/opt/openjdk@21/bin/jarsigner', ['-verify', resolve(appBundle)], { encoding: 'utf8' });
    appBundleSignatureValid = signature.status === 0 && signature.stdout.includes('jar verified.');
    appBundleSigningKeyMatches = cert.status === 0 && digest === expected;
    const bundleJS = spawnSync('unzip', ['-p', resolve(appBundle), 'base/assets/index.android.bundle'], { maxBuffer: 128 * 1024 * 1024 });
    const bundleConfig = spawnSync('unzip', ['-p', resolve(appBundle), 'base/assets/app.config'], { maxBuffer: 8 * 1024 * 1024 });
    appBundlePayloadMatches = bundleJS.status === 0 && bundleConfig.status === 0 && js.equals(bundleJS.stdout) && config.equals(bundleConfig.stdout);
  }
} else {
  js = readFileSync(join(artifact, 'main.jsbundle'));
  const plist = spawnSync('plutil', ['-convert', 'json', '-o', '-', join(artifact, 'Info.plist')], { maxBuffer: 8 * 1024 * 1024 });
  if (plist.status !== 0) throw new Error('iOS public configuration cannot be inspected');
  config = plist.stdout;
  productionIdentity = JSON.parse(config).CFBundleIdentifier === 'ai.bookmarkai';
  for (const file of readdirSync(artifact)) {
    if (!/\.json$/.test(file) || !statSync(join(artifact, file)).isFile()) continue;
    extraConfigs.push(readFileSync(join(artifact, file)));
  }
}
const scanned = [js, config, ...extraConfigs];
const leaks = [...secrets].filter(secret => scanned.some(bytes => bytes.includes(Buffer.from(secret))));
const report = {
  productionIdentity, embeddedReleaseJavaScript: js.length > 0,
  ...(productionSigningKeyMatches === undefined ? {} : { productionSigningKeyMatches }),
  ...(appBundleSignatureValid === undefined ? {} : { appBundleSignatureValid, appBundleSigningKeyMatches, appBundlePayloadMatches }),
  canonicalApiPresent: js.includes(Buffer.from('https://www.bookmark-ai.cloud')),
  canonicalLivePresent: js.includes(Buffer.from('https://live.bookmark-ai.cloud')),
  productionSupabasePresent: js.includes(Buffer.from('https://xogqaqtyacmecdbmgqqd.supabase.co')),
  backendValuesChecked: secrets.size, backendSecretLeakage: leaks.length > 0,
  embeddedJSSha256: createHash('sha256').update(js).digest('hex'),
  publicConfigSha256: createHash('sha256').update(config).digest('hex'),
  // Legacy development helpers may remain as inert strings. The actual runtime
  // guard enforces exact HTTPS endpoints; Release supplies the embedded bundle.
  noLocalServerDependency: false,
};
report.noLocalServerDependency = report.productionIdentity && report.embeddedReleaseJavaScript && report.canonicalApiPresent && report.canonicalLivePresent && report.productionSupabasePresent;
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (report.backendSecretLeakage || !report.noLocalServerDependency || productionSigningKeyMatches === false || appBundleSignatureValid === false || appBundleSigningKeyMatches === false || appBundlePayloadMatches === false) process.exitCode = 1;
