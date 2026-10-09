#!/usr/bin/env node
/** Frozen Supabase production packages. Never installs, deploys or submits. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, cpSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { repoRoot, parseEnv, qaEnvironment, stageSources } from './supabase-qa.mjs';

export const variant = 'supabase-production';
export const releaseRoot = join(repoRoot, 'dist/production');
const browsers = ['chrome', 'firefox', 'safari'];
export function productionEnvironment(source, inherited = process.env, surface = 'chrome') {
  if (source.BOOKMARK_HOSTED_TARGET !== 'production') throw new Error('Production requires explicit hosted production environment');
  if (source.BOOKMARK_BUILD_VARIANT && !['supabase-qa', variant].includes(source.BOOKMARK_BUILD_VARIANT)) throw new Error('Unknown production build variant');
  const prepared = { ...source };
  delete prepared.BOOKMARK_BUILD_VARIANT;
  const env = qaEnvironment(prepared, inherited, surface);
  if (!env.SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_') || env.SUPABASE_URL !== 'https://xogqaqtyacmecdbmgqqd.supabase.co') throw new Error('Explicit production Supabase public configuration required');
  Object.assign(env, {
    BOOKMARK_BUILD_VARIANT: variant, WXT_BUILD_VARIANT: variant, EXPO_PUBLIC_BUILD_VARIANT: variant,
    WXT_AUTH_STORAGE_NAMESPACE: 'bookmark-ai:supabase-production',
    EXPO_PUBLIC_AUTH_STORAGE_NAMESPACE: 'bookmark-ai:supabase-production',
    EXPO_PUBLIC_AUTH_REDIRECT_URL: 'bookmarkai://sso-callback',
    EXPO_PUBLIC_SERVER_TARGET: 'production', EXPO_PUBLIC_HOSTED_TARGET: 'production',
  });
  if (browsers.includes(surface)) {
    env.WXT_SUPABASE_OAUTH_CLIENT_ID = source[`SUPABASE_PRODUCTION_EXTENSION_${surface.toUpperCase()}_CLIENT_ID`] || '';
    if (!/^[0-9a-f-]{36}$/i.test(env.WXT_SUPABASE_OAUTH_CLIENT_ID)) throw new Error(`Missing exact production ${surface} public OAuth client ID`);
  }
  return env;
}
function checked(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status})`);
}
function configureNative(stagedRoot, env) {
  const infoPath = join(stagedRoot, 'apps/macos/Resources/Info.plist');
  if (!existsSync(infoPath)) return;
  const info = {
    BOOKMARK_BUILD_VARIANT: variant, BOOKMARK_AUTH_PROVIDER: 'supabase', BOOKMARK_HOSTED_TARGET: 'production',
    BOOKMARK_API_URL: env.WXT_API_URL, BOOKMARK_LIVE_URL: env.WXT_LIVE_URL,
    BOOKMARK_AUTH_STORAGE_NAMESPACE: 'bookmark-ai:supabase-production', BOOKMARK_AUTH_CALLBACK_SCHEME: 'bookmarkai-macos',
    SUPABASE_URL: env.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY,
    NSAppTransportSecurity: {},
    CFBundleURLTypes: [{ CFBundleURLSchemes: ['bookmarkai-macos'], CFBundleURLName: 'ai.bookmarkai.macos' }],
  };
  const result = spawnSync('python3', ['-c', 'import sys,json,plistlib; p=sys.argv[1]; d=plistlib.load(open(p,"rb")); d.update(json.load(sys.stdin)); plistlib.dump(d,open(p,"wb"))', infoPath], { input: JSON.stringify(info), encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Failed to configure production Mac');
  const entitlements = join(stagedRoot, 'apps/macos/Resources/BookmarkAI.entitlements');
  // Hosted Apple OAuth needs no native Sign in with Apple capability/profile.
  const entitlement = spawnSync('python3', ['-c', 'import sys,plistlib; p=sys.argv[1]; d=plistlib.load(open(p,"rb")); d.pop("com.apple.developer.applesignin",None); d.pop("com.apple.security.get-task-allow",None); plistlib.dump(d,open(p,"wb"))', entitlements], { encoding: 'utf8' });
  if (entitlement.status !== 0) throw new Error('Failed to configure hosted browser signing entitlements');
}
function hashes(directory, prefix = '') {
  const values = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(values, hashes(join(directory, entry.name), relative + '/'));
    else if (entry.isFile()) values[relative] = createHash('sha256').update(readFileSync(join(directory, entry.name))).digest('hex');
  }
  return values;
}
export function writeInstallGuide() {
  const mobileManifest = join(releaseRoot, 'mobile-manifest.json');
  const mobileEntries = existsSync(mobileManifest) ? Object.entries(JSON.parse(readFileSync(mobileManifest, 'utf8')).artifacts || {}) : [];
  const mobileVersions = mobileEntries.length ? mobileEntries.map(([surface, artifact]) => `${surface} ${artifact.version} (${artifact.build})`).join('; ') : 'see mobile-manifest.json when mobile packages are ready';
  mkdirSync(releaseRoot, { recursive: true });
  writeFileSync(join(releaseRoot, 'INSTALL.md'), '# Bookmark AI production packages\n\nAll packages use Supabase on https://www.bookmark-ai.cloud. No local server is required.\n\n- Chrome: chrome://extensions → Developer mode → Load unpacked → this kit’s chrome folder, or apps/extension/.output/chrome-mv3. ID ffhbgpgebpmofjkehpjcemepbgcmoelp. Reload an existing install after a rebuild.\n- Firefox: about:debugging#/runtime/this-firefox → Load Temporary Add-on → firefox/manifest.json. GUID bookmark-ai@bookmark-ai.cloud. This local temporary install must be loaded again after a browser restart; AMO signed publication is separate.\n- Safari: install/open Bookmark AI for Safari.app; enable Bookmark AI in Safari Settings → Extensions. Keep the companion separate from the main Mac app.\n- Mac: install/open Bookmark AI.app; Sign In opens the production website in the default browser and returns to the app.\n- iPhone/iPad: Bookmark-AI-iOS-1.0.2.ipa is a signed development build for registered devices; install through Xcode Devices or the supported device installer. It is not a TestFlight/App Store release.\n- iOS Simulator: unzip Bookmark-AI-iOS-Simulator-1.0.2.zip and install BookmarkAI.app into a booted simulator.\n- Android: install Bookmark-AI-Android-1.0.2.apk as the signed app update; the accompanying AAB is the store-upload package, not directly installable.\n\nMobile packages retain ai.bookmarkai identity and '+mobileVersions+'; mobile-manifest.json records package/signing/hash evidence separately.\n\nSupabase production sessions have separate storage from earlier QA and Clerk builds. Sign in afresh. ARTIFACTS.json records exact source, identities, versions and file SHA256 hashes. Signed local Apple builds are not claimed notarized or store published.\n');
}
export function publishDirectory(source, name, manifest, metadata = {}) {
  mkdirSync(releaseRoot, { recursive: true });
  const temporary = join(releaseRoot, `.${name}-${Date.now()}`);
  cpSync(source, temporary, { recursive: true });
  const fileHashes = hashes(temporary);
  const destination = join(releaseRoot, name);
  if (existsSync(destination)) {
    const backup = join(repoRoot, '.work/production-oct9/replaced-packages', `${name}-${Date.now()}`);
    mkdirSync(join(repoRoot, '.work/production-oct9/replaced-packages'), { recursive: true });
    renameSync(destination, backup);
  }
  renameSync(temporary, destination);
  const manifestPath = join(releaseRoot, 'ARTIFACTS.json');
  const artifacts = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  artifacts[name] = { provider: 'supabase', variant, api: 'https://www.bookmark-ai.cloud', live: 'https://live.bookmark-ai.cloud', buildManifest: join(manifest.stagedRoot, '../build-manifest.json'), sourceHash: manifest.sourceHash, gitSha: manifest.gitSha, ...metadata, fileHashes };
  writeFileSync(manifestPath, JSON.stringify(artifacts, null, 2) + '\n');
  writeInstallGuide();
  return destination;
}
function updateStandardOutput(source, name) {
  const output = join(repoRoot, 'apps/extension/.output', name);
  const backup = join(repoRoot, '.work/production-oct9/rollback-extension-output', name);
  if (existsSync(output)) {
    if (!existsSync(backup)) { mkdirSync(join(backup, '..'), { recursive: true }); renameSync(output, backup); }
    else rmSync(output, { recursive: true });
  }
  mkdirSync(join(output, '..'), { recursive: true });
  cpSync(source, output, { recursive: true });
}
function signingArguments(env) {
  const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
  const identity = /"(Apple Development: [^"]+)"/.exec(result.stdout || '')?.[1];
  if (!identity) throw new Error('Real Apple Development signing identity required; unsigned production packages are refused');
  return ['CODE_SIGN_STYLE=Manual', `CODE_SIGN_IDENTITY=${identity}`, 'PROVISIONING_PROFILE_SPECIFIER=', 'DEVELOPMENT_TEAM=L3PP7DQZWS'];
}
export function sanitizeReleaseSigning(product, env, scratch) {
  const identity = signingArguments(env).find(value => value.startsWith('CODE_SIGN_IDENTITY=')).slice('CODE_SIGN_IDENTITY='.length);
  const nested = join(product,'Contents/PlugIns');
  const targets = existsSync(nested) ? readdirSync(nested).filter(name => name.endsWith('.appex')).map(name => join(nested,name)) : [];
  targets.push(product);
  mkdirSync(scratch,{recursive:true});
  for (const [index,target] of targets.entries()) {
    const entitlements = join(scratch,`release-${index}.plist`);
    const cleaned = spawnSync('python3',['-c','import sys,subprocess,plistlib; r=subprocess.run(["codesign","-d","--entitlements",":-",sys.argv[1]],capture_output=True,check=True); d=plistlib.loads(r.stdout[r.stdout.find(b"<?xml"):]); d.pop("com.apple.security.get-task-allow",None); plistlib.dump(d,open(sys.argv[2],"wb"))',target,entitlements],{encoding:'utf8'});
    if(cleaned.status!==0)throw new Error('Cannot inspect and sanitize Release signing entitlements');
    checked('codesign',['--force','--sign',identity,'--options','runtime','--timestamp=none','--entitlements',entitlements,target],repoRoot,env);
  }
  checked('codesign',['--verify','--deep','--strict',product],repoRoot,env);
}
export function main(argv = process.argv.slice(2)) {
  const [surface = 'chrome', action = 'build', reuse] = argv;
  if (![...browsers, 'macos', 'ios', 'android', 'web', 'live'].includes(surface) || !['prepare','build','bundle','zip','test','typecheck'].includes(action) || argv.length > 3 || (reuse && !reuse.startsWith('--from-run='))) throw new Error('Usage: production:supabase <surface> prepare|build|bundle|zip|test|typecheck [--from-run=/frozen/production/run]');
  if (action === 'zip' && !browsers.includes(surface)) throw new Error('zip is an extension package action');
  const source = parseEnv(readFileSync(join(repoRoot, '.env.supabase.production.local'), 'utf8'));
  const env = productionEnvironment(source, process.env, surface);
  if (['ios','android'].includes(surface) && action === 'build') throw new Error('Use prepare then the explicitly signed mobile release procedure; no debug signing fallback');
  let staged;
  if (reuse) {
    const runRoot = resolve(reuse.slice('--from-run='.length));
    if (!runRoot.startsWith(join(repoRoot, '.work/builds', variant) + '/')) throw new Error('Reuse requires an existing production snapshot');
    const manifest = JSON.parse(readFileSync(join(runRoot, 'build-manifest.json'), 'utf8'));
    if (manifest.variant !== variant || manifest.surface !== surface) throw new Error('Frozen snapshot surface/variant mismatch');
    staged = { runRoot, stagedRoot: manifest.stagedRoot, manifest };
    env.BOOKMARK_PRODUCTION_STAGE_ROOT = manifest.stagedRoot;
  } else staged = stageSources(surface, env, { variant, nativeConfiguration: configureNative });
  const { runRoot, stagedRoot, manifest } = staged;
  const app = join(stagedRoot, 'apps', browsers.includes(surface) ? 'extension' : surface === 'macos' ? 'macos' : ['ios','android'].includes(surface) ? 'mobile' : surface === 'live' ? 'live-server' : 'web');
  env.PATH = `${join(app, 'node_modules/.bin')}:${env.PATH}`;
  console.log(`Supabase production ${surface}: ${runRoot}`);
  try {
    if (action === 'prepare') return;
    if (browsers.includes(surface)) {
      checked(process.execPath, ['scripts/wxt-run.mjs', 'prepare'], app, env);
      if (action === 'test' || action === 'typecheck') checked('corepack', ['pnpm','exec', ...(action === 'test' ? ['vitest','run'] : ['tsc','--noEmit'])], app, env);
      else {
        checked(process.execPath, ['scripts/wxt-run.mjs',action === 'zip' ? 'zip' : 'build','-b',surface,surface === 'firefox' ? '--mv2' : '--mv3','-m','production'], app, env);
        const name = `${surface}-${surface === 'firefox' ? 'mv2' : 'mv3'}`;
        const bundle = join(app, '.output', name);
        const built = JSON.parse(readFileSync(join(bundle,'manifest.json'),'utf8'));
        if (built.name !== 'Bookmark AI' || built.version !== '0.1.6') throw new Error('Unexpected production manifest identity/version');
        updateStandardOutput(bundle, name);
        publishDirectory(bundle, surface, manifest, { extensionId: surface === 'chrome' ? 'ffhbgpgebpmofjkehpjcemepbgcmoelp' : surface === 'firefox' ? 'bookmark-ai@bookmark-ai.cloud' : 'ai.bookmark.safari.Extension', manifest: built });
        if (action === 'zip') {
          const archive = readdirSync(join(app,'.output')).find(name => name.endsWith('.zip') && name.includes(surface));
          if (!archive) throw new Error('Missing production extension archive');
          const path = join(releaseRoot,`${surface}.zip`);
          cpSync(join(app,'.output',archive),path);
          const artifactPath=join(releaseRoot,'ARTIFACTS.json');
          const artifacts=JSON.parse(readFileSync(artifactPath,'utf8'));
          artifacts[surface].archive={path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')};
          writeFileSync(artifactPath,JSON.stringify(artifacts,null,2)+'\n');
        }
        if (surface === 'safari' && !['bundle','zip'].includes(action)) {
          const native = join(app,'safari-app');
          checked(process.execPath,['scripts/safari-version.mjs','--write'],app,env);
          checked('rsync',['-a','--delete',`${bundle}/`,`${join(native,'Extension/Resources')}/`],app,env);
          checked('xcodegen',['generate'],native,env);
          checked('xcodebuild',['-project','BookmarkAISafari.xcodeproj','-scheme','BookmarkAI','-configuration','Release','-derivedDataPath',join(runRoot,'DerivedData-safari'),'clean','build',...signingArguments(env)],native,env);
          const product = join(runRoot,'DerivedData-safari/Build/Products/Release/Bookmark AI.app');
          sanitizeReleaseSigning(product,env,join(runRoot,'release-signing'));
          publishDirectory(product,'Bookmark AI for Safari.app',manifest,{bundleId:'ai.bookmark.safari',version:built.version,configuration:'Release',signing:'Apple Development'});
        }
      }
    } else if (surface === 'macos') {
      checked('xcodegen',['generate'],app,env);
      const derived = join(runRoot,'DerivedData-macos');
      checked('xcodebuild',['-project','BookmarkAI.xcodeproj','-scheme','BookmarkAI','-configuration',action === 'test' ? 'Debug' : 'Release','-derivedDataPath',derived,...signingArguments(env),action === 'test' ? 'test' : 'build'],app,env);
      if (action === 'build') {
        const product=join(derived,'Build/Products/Release/BookmarkAI.app');
        sanitizeReleaseSigning(product,env,join(runRoot,'release-signing'));
        publishDirectory(product,'Bookmark AI.app',manifest,{bundleId:'ai.bookmarkai.macos',version:'0.1.1',build:8,configuration:'Release',callback:'bookmarkai-macos://auth/callback',namespace:'bookmark-ai:supabase-production',signing:'Apple Development'});
      }
    } else throw new Error('Only prepare is supported here for web/live/mobile; use the owning release procedure');
    manifest.status='success';
  } catch(error) { manifest.status='failed'; throw error; }
  finally { writeFileSync(join(runRoot,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n'); }
  console.log(`Packages: ${releaseRoot}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch(error) { console.error(error.message); process.exitCode=1; }
}
