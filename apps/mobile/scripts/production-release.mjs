#!/usr/bin/env node
/** Embedded, signed production packages from isolated frozen sources. No install. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { repoRoot, parseEnv, stageSources } from '../../../scripts/supabase-qa.mjs';
import { productionEnvironment, variant, releaseRoot } from '../../../scripts/supabase-production.mjs';

const [target, reuse] = process.argv.slice(2);
if (!['ios-simulator', 'ios-device', 'android'].includes(target) || (reuse && !reuse.startsWith('--from-run=')) || process.argv.length > 4) throw new Error('Usage: node apps/mobile/scripts/production-release.mjs ios-simulator|ios-device|android [--from-run=/absolute/run]');
const surface = target === 'android' ? 'android' : 'ios';
const env = productionEnvironment(parseEnv(readFileSync(join(repoRoot, '.env.supabase.production.local'), 'utf8')), process.env, surface);
Object.assign(env, { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', EXPO_USE_PRECOMPILED_MODULES: '0', BOOKMARK_QA_NATIVE_BUILD: '1' });
if (surface === 'android') {
  // These four owner-held values never become EXPO_PUBLIC fields or manifests.
  const allowed = new Set(['ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']);
  for (const line of readFileSync(join(repoRoot, '.keys/android-release.env'), 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && allowed.has(match[1])) env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  if ([...allowed].some(key => !env[key])) throw new Error('All four private Android signing fields are required');
  env.ANDROID_KEYSTORE_PATH = resolve(repoRoot, env.ANDROID_KEYSTORE_PATH);
  if (!existsSync(env.ANDROID_KEYSTORE_PATH)) throw new Error('Production Android keystore is missing');
  env.JAVA_HOME ||= '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
  env.ANDROID_HOME ||= join(process.env.HOME, 'Library/Android/sdk');
  env.ANDROID_SDK_ROOT = env.ANDROID_HOME;
}
let staged;
if (reuse) {
  const runRoot = resolve(reuse.slice('--from-run='.length));
  if (!runRoot.startsWith(join(repoRoot, '.work/builds', variant) + '/')) throw new Error('Reuse must be an existing production snapshot');
  const manifest = JSON.parse(readFileSync(join(runRoot, 'build-manifest.json'), 'utf8'));
  if (manifest.variant !== variant || manifest.surface !== surface || !manifest.dependencyLayer.nativeOverlay) throw new Error('Reusable snapshot must have the same surface and isolated native dependencies');
  staged = { runRoot, stagedRoot: manifest.stagedRoot, manifest };
  env.BOOKMARK_PRODUCTION_STAGE_ROOT = manifest.stagedRoot;
  env.TMPDIR = join(runRoot, 'tmp'); env.GRADLE_USER_HOME = join(runRoot, 'gradle-cache');
  env.CP_HOME_DIR = join(runRoot, 'cocoapods'); env.CP_CACHE_DIR = join(runRoot, 'cocoapods-cache');
  env.COCOAPODS_DISABLE_STATS = 'true';
} else staged = stageSources(surface, env, { variant, nativeConfiguration: () => {} });
const { runRoot, stagedRoot, manifest } = staged;
const app = join(stagedRoot, 'apps/mobile');
env.PATH = `${join(app, 'node_modules/.bin')}:${env.PATH}`;
env.NODE_BINARY = process.execPath;
const checked = (command, args, cwd = app) => {
  const result = spawnSync(command, args, { env, cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status})`);
};
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
console.log(`Mobile production ${target}: ${runRoot}`);
const nativeBuildLock = join(runRoot, 'ios-build.lock');
let ownsNativeBuildLock = false;
try {
  if (surface === 'ios') {
    // ExpoModulesJSI builds inside the shared native dependency overlay.
    // Simulator/device Xcode builds must run sequentially for this snapshot.
    try { mkdirSync(nativeBuildLock); ownsNativeBuildLock = true; }
    catch { throw new Error('This iOS snapshot is building another target; wait for that build before retrying'); }
  }
  const native = join(app, surface);
  if (!existsSync(native)) checked('corepack', ['pnpm', 'exec', 'expo', 'prebuild', '--platform', surface, '--no-install']);
  mkdirSync(releaseRoot, { recursive: true });
  const appConfig = JSON.parse(readFileSync(join(app, 'app.json'), 'utf8')).expo;
  const file = join(releaseRoot, 'mobile-manifest.json');
  const entry = { version: appConfig.version, build: surface === 'ios' ? appConfig.ios.buildNumber : appConfig.android.versionCode,
    packageId: 'ai.bookmarkai', callback: env.EXPO_PUBLIC_AUTH_REDIRECT_URL, namespace: env.EXPO_PUBLIC_AUTH_STORAGE_NAMESPACE,
    api: env.EXPO_PUBLIC_API_URL, live: env.EXPO_PUBLIC_LIVE_API_URL, configuration: 'Release', runRoot,
    sourceHash: manifest.sourceHash, gitSha: manifest.gitSha, lockfileHash: manifest.lockfileHash };
  if (surface === 'ios') {
    if (!existsSync(join(native, 'Pods/Manifest.lock'))) checked('pod', ['install'], native);
    const workspace = readdirSync(native).find(name => name.endsWith('.xcworkspace'));
    if (!workspace) throw new Error('Generated iOS workspace is missing');
    const device = target === 'ios-device';
    const derived = join(runRoot, device ? 'DerivedData-device' : 'DerivedData-simulator');
    checked('xcodebuild', ['-workspace', workspace, '-scheme', 'BookmarkAI', '-configuration', 'Release', '-sdk', device ? 'iphoneos' : 'iphonesimulator',
      '-destination', device ? 'generic/platform=iOS' : 'generic/platform=iOS Simulator', '-derivedDataPath', derived,
      ...(device ? ['-allowProvisioningUpdates', 'CODE_SIGN_STYLE=Automatic', 'DEVELOPMENT_TEAM=L3PP7DQZWS', 'CODE_SIGN_IDENTITY=Apple Development'] : ['CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-']), 'build'], native);
    const product = join(derived, 'Build/Products', device ? 'Release-iphoneos' : 'Release-iphonesimulator', 'BookmarkAI.app');
    checked('codesign', ['--verify', '--deep', '--strict', product]);
    for (const [key, expected] of [['CFBundleIdentifier', 'ai.bookmarkai'], ['CFBundleShortVersionString', appConfig.version], ['CFBundleVersion', appConfig.ios.buildNumber]]) {
      const info = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, join(product, 'Info.plist')], { encoding: 'utf8' });
      if (info.status !== 0 || info.stdout.trim() !== expected) throw new Error(`Built iOS app has incorrect ${key}`);
    }
    const archive = join(releaseRoot, device ? `Bookmark-AI-iOS-${appConfig.version}.ipa` : `Bookmark-AI-iOS-Simulator-${appConfig.version}.zip`);
    if (device) {
      const payload = join(runRoot, 'ipa/Payload'); mkdirSync(payload, { recursive: true });
      checked('ditto', [product, join(payload, 'BookmarkAI.app')]);
      checked('ditto', ['-c', '-k', '--keepParent', payload, archive]);
    } else checked('ditto', ['-c', '-k', '--keepParent', product, archive]);
    Object.assign(entry, { path: archive, sha256: sha256(archive), appPath: product, embeddedJSSha256: sha256(join(product, 'main.jsbundle')),
      signing: device ? 'Apple Development; provisioned devices only' : 'simulator ad-hoc' });
  } else {
    checked('./gradlew', ['assembleRelease', 'bundleRelease', '--no-daemon', '--rerun-tasks'], native);
    const apk = join(releaseRoot, `Bookmark-AI-Android-${appConfig.version}.apk`);
    const aab = join(releaseRoot, `Bookmark-AI-Android-${appConfig.version}.aab`);
    copyFileSync(join(native, 'app/build/outputs/apk/release/app-release.apk'), apk);
    copyFileSync(join(native, 'app/build/outputs/bundle/release/app-release.aab'), aab);
    checked(join(env.ANDROID_HOME, 'build-tools/36.0.0/apksigner'), ['verify', '--verbose', '--print-certs', apk]);
    const badging = spawnSync(join(env.ANDROID_HOME, 'build-tools/36.0.0/aapt2'), ['dump', 'badging', apk], { encoding: 'utf8' });
    const packageLine = badging.stdout.split('\n')[0];
    if (badging.status !== 0 || !packageLine.includes("name='ai.bookmarkai'") || !packageLine.includes(`versionCode='${appConfig.android.versionCode}'`) || !packageLine.includes(`versionName='${appConfig.version}'`)) throw new Error('Built Android package has incorrect production identity/version');
    Object.assign(entry, { path: apk, sha256: sha256(apk), appBundlePath: aab, appBundleSha256: sha256(aab), signing: 'owner production release keystore' });
  }
  // Read only once the expensive build finishes; independent iOS/Android builds
  // otherwise overwrite entries read before the other platform was published.
  const record = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { provider: 'supabase', variant, artifacts: {} };
  record.artifacts[target] = entry;
  writeFileSync(join(runRoot, `${target}-artifact.json`), JSON.stringify(entry, null, 2) + '\n');
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
  manifest.status = 'built'; writeFileSync(join(runRoot, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Production package: ${entry.path}`);
} catch (error) {
  manifest.status = 'failed'; writeFileSync(join(runRoot, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  throw error;
} finally {
  if (ownsNativeBuildLock) rmSync(nativeBuildLock, { recursive: true });
}
