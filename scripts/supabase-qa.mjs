#!/usr/bin/env node
/** Source snapshots, never worktrees or native generation in the live checkout. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, lstatSync, readdirSync, copyFileSync, symlinkSync, realpathSync, cpSync, constants, readlinkSync, unlinkSync, renameSync, chmodSync, rmSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const variant = 'supabase-qa';
const surfaces = ['check', 'web', 'live', 'chrome', 'firefox', 'safari', 'macos', 'ios', 'android'];
const apps = { web: 'web', live: 'live-server', chrome: 'extension', firefox: 'extension', safari: 'extension', macos: 'macos', ios: 'mobile', android: 'mobile' };
const forbidden = /(?:CLERK|^DATABASE_|^MASTER_DATABASE_|^DEV_OPEN_API$|^EXPO_PUBLIC_SKIP_AUTH$|^ANDROID_KEY)/;
export function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) throw new Error('Malformed QA environment line');
    const [, key, value] = match;
    if (forbidden.test(key)) throw new Error(`Production/bypass variable forbidden in QA: ${key}`);
    values[key] = value.replace(/^(["'])(.*)\1$/, '$2');
  }
  return values;
}

export function qaEnvironment(source = {}, inherited = process.env, surface = 'web') {
  const env = {};
  // Credentials/settings are never inherited from the caller's production shell.
  for (const key of ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'CI', 'JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'DEVELOPER_DIR', 'SDKROOT']) {
    if (inherited[key]) env[key] = inherited[key];
  }
  Object.assign(env, source);
  if (surface === 'live') {
    if (!source.REDIS_URL) throw new Error('QA Live requires explicit isolated REDIS_URL; default6379 is forbidden');
    const redis = new URL(source.REDIS_URL);
    if (redis.protocol !== 'redis:' || !['localhost', '127.0.0.1'].includes(redis.hostname) || redis.port !== '6386' || !['', '/0'].includes(redis.pathname)) throw new Error('QA Live Redis must use localhost6386/database0');
    if (!source.LIVE_ENCRYPTION_SECRET || source.LIVE_ENCRYPTION_SECRET.length < 32) throw new Error('QA Live requires its explicit encryption secret');
  }
  if (surface === 'macos') {
    env.BOOKMARK_QA_MACOS_SIGNING = inherited.BOOKMARK_QA_MACOS_SIGNING || source.BOOKMARK_QA_MACOS_SIGNING || 'unsigned';
    if (!['unsigned', 'adhoc', 'development'].includes(env.BOOKMARK_QA_MACOS_SIGNING)) throw new Error('Unknown QA Mac signing mode');
  }
  for (const key of Object.keys(source)) if (forbidden.test(key)) throw new Error(`Forbidden QA variable: ${key}`);
  if (source.BOOKMARK_BUILD_VARIANT && source.BOOKMARK_BUILD_VARIANT !== variant) throw new Error('Mixed build variant');
  for (const key of ['AUTH_PROVIDER', 'NEXT_PUBLIC_AUTH_PROVIDER', 'EXPO_PUBLIC_AUTH_PROVIDER', 'WXT_AUTH_PROVIDER']) {
    if (source[key] && source[key] !== 'supabase') throw new Error('Mixed auth provider');
  }
  const api = source.BOOKMARK_QA_WEB_URL || 'http://localhost:3100';
  const live = source.BOOKMARK_QA_LIVE_URL || 'http://localhost:3101';
  for (const url of [api, live]) {
    const parsed = new URL(url);
    if (/bookmark-ai\.cloud$|vercel\.app$/.test(parsed.hostname)) throw new Error('QA may not target production/deployed Bookmark APIs');
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported QA API URL');
  }
  const supabase = source.SUPABASE_URL || source.NEXT_PUBLIC_SUPABASE_URL;
  if (supabase && new URL(supabase).origin !== 'https://xogqaqtyacmecdbmgqqd.supabase.co') throw new Error('Unexpected Supabase QA project');
  const publicKey = source.SUPABASE_PUBLISHABLE_KEY || source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (source.SUPABASE_URL && source.NEXT_PUBLIC_SUPABASE_URL && source.SUPABASE_URL !== source.NEXT_PUBLIC_SUPABASE_URL) throw new Error('Mixed Supabase projects');
  Object.assign(env, {
    BOOKMARK_BUILD_VARIANT: variant, AUTH_PROVIDER: 'supabase', NEXT_PUBLIC_AUTH_PROVIDER: 'supabase',
    EXPO_PUBLIC_AUTH_PROVIDER: 'supabase', WXT_AUTH_PROVIDER: 'supabase', EXPO_NO_DOTENV: '1',
    NEXT_PUBLIC_APP_URL: api, NEXT_PUBLIC_API_URL: api, NEXT_PUBLIC_LIVE_SERVER_URL: live, NEXT_PUBLIC_LIVE_API_URL: live,
    PORT: surface === 'live' ? '3101' : '3100', LIVE_PORT: '3101', LIVE_ALLOWED_ORIGINS: new URL(api).origin,
    EXPO_PUBLIC_API_URL: surface === 'android' ? api.replace('localhost', '10.0.2.2') : api,
    EXPO_PUBLIC_LIVE_URL: surface === 'android' ? live.replace('localhost', '10.0.2.2') : live,
    EXPO_PUBLIC_LIVE_API_URL: surface === 'android' ? live.replace('localhost', '10.0.2.2') : live,
    EXPO_PUBLIC_BUILD_VARIANT: variant, EXPO_PUBLIC_AUTH_STORAGE_NAMESPACE: 'bookmark-ai:supabase-qa',
    EXPO_PUBLIC_AUTH_REDIRECT_URL: 'bookmarkai-supabase-qa://sso-callback',
    WXT_BUILD_VARIANT: variant, WXT_API_URL: api, WXT_APP_URL: api, WXT_LIVE_URL: live, WXT_LIVE_API_URL: live,
    WXT_AUTH_STORAGE_NAMESPACE: 'bookmark-ai:supabase-qa',
  });
  if (supabase) Object.assign(env, { SUPABASE_URL: supabase, NEXT_PUBLIC_SUPABASE_URL: supabase, EXPO_PUBLIC_SUPABASE_URL: supabase, WXT_SUPABASE_URL: supabase });
  if (publicKey) Object.assign(env, { SUPABASE_PUBLISHABLE_KEY: publicKey, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey, WXT_SUPABASE_PUBLISHABLE_KEY: publicKey });
  if (['chrome', 'firefox', 'safari'].includes(surface)) {
    const clientId = source[`SUPABASE_EXTENSION_${surface.toUpperCase()}_CLIENT_ID`];
    delete env.WXT_SUPABASE_OAUTH_CLIENT_ID;
    if (clientId) env.WXT_SUPABASE_OAUTH_CLIENT_ID = clientId;
  }
  return env;
}

export function macSigningArguments(mode = 'unsigned') {
  if (mode === 'unsigned') return ['CODE_SIGNING_ALLOWED=NO'];
  if (mode === 'adhoc') return ['CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_STYLE=Manual', 'CODE_SIGN_IDENTITY=-'];
  if (mode === 'development') return ['CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_STYLE=Automatic', 'DEVELOPMENT_TEAM=L3PP7DQZWS'];
  throw new Error('Unknown QA Mac signing mode');
}

function fingerprint(path) {
  return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;
}
/** Native included projects write build caches inside node_modules. Give them
 * private COW bytes so they cannot change dependencies of running QA servers. */
export function nativeDependencyOverlay(frozenRoot, runRoot) {
  const root = join(runRoot, 'native-dependencies');
  cpSync(frozenRoot, root, {
    recursive: true, dereference: false, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
    filter: (path) => !(/\/(?:build|\.gradle)(?:\/|$)/.test(path) && /\/(?:@react-native\/gradle-plugin|expo-modules-autolinking\/android\/expo-gradle-plugin)\//.test(path)) && !(/\/(?:android|ReactAndroid)\/(?:build|\.gradle|\.cxx|\.kotlin)(?:\/|$)/.test(path)),
  });
  const walk = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) walk(path);
      else if (item.isFile() && path.includes('/node_modules/.bin/')) patchExecutable(path, [[frozenRoot, root]]);
    }
  };
  walk(join(root, 'node_modules'));
  return root;
}
function patchExecutable(file, replacements) {
  const bytes = readFileSync(file);
  if (bytes.includes(0)) return;
  let value = bytes.toString('utf8');
  for (const [before, after] of replacements) value = value.split(before).join(after);
  writeFileSync(file, value);
  chmodSync(file, lstatSync(file).mode);
}

/** Clone once per installed lockfile: no hard links or live dependency paths. */
export function dependencySnapshot() {
  const lockfileHash = fingerprint(join(repoRoot, 'pnpm-lock.yaml'));
  const installedLockfileHash = fingerprint(join(repoRoot, 'node_modules/.pnpm/lock.yaml'));
  if (!lockfileHash || !installedLockfileHash) throw new Error('Pinned dependencies must be installed before QA snapshots');
  const id = createHash('sha256').update(`${lockfileHash}:${installedLockfileHash}`).digest('hex');
  const root = join(repoRoot, '.work/builds', variant, 'dependencies', id);
  const ready = join(root, 'dependency-manifest.json');
  if (existsSync(ready)) {
    const manifest = JSON.parse(readFileSync(ready, 'utf8'));
    const globalScope = join(root, 'node_modules/.pnpm/node_modules/@bookmark-ai');
    if (existsSync(globalScope)) for (const name of readdirSync(globalScope)) {
      try { unlinkSync(join(globalScope, name)); manifest.removedWorkspaceLinks++; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    writeFileSync(ready, JSON.stringify(manifest, null, 2));
    return { root, ...manifest };
  }
  const partial = `${root}.partial-${process.pid}`;
  mkdirSync(join(partial, 'node_modules'), { recursive: true });
  console.log(`Freezing QA dependency layer: ${id.slice(0, 12)} (filesystem clone; copy fallback)`);
  cpSync(join(repoRoot, 'node_modules/.pnpm'), join(partial, 'node_modules/.pnpm'), {
    recursive: true, dereference: false, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
  });
  let logicalBytes = 0, files = 0, removedWorkspaceLinks = 0;
  const walk = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isSymbolicLink()) {
        if (path.includes('/node_modules/.pnpm/node_modules/@bookmark-ai/')) { unlinkSync(path); removedWorkspaceLinks++; continue; }
        const target = resolve(dirname(path), readlinkSync(path));
        if (target !== partial && !target.startsWith(`${partial}/`)) {
          // pnpm's global workspace fallback points outside its dependency store.
          // Workspaces are rebound in EACH source snapshot, never in this cache.
          if (path.includes('/node_modules/@bookmark-ai/')) { unlinkSync(path); removedWorkspaceLinks++; }
          else throw new Error(`External dependency symlink escapes frozen cache: ${relative(partial, path)}`);
        }
      } else if (item.isDirectory()) walk(path);
      else {
        logicalBytes += lstatSync(path).size; files++;
        if (path.includes('/node_modules/.bin/')) patchExecutable(path, [[join(repoRoot, 'node_modules'), join(root, 'node_modules')]]);
      }
    }
  };
  walk(join(partial, 'node_modules/.pnpm'));
  if (fingerprint(join(repoRoot, 'pnpm-lock.yaml')) !== lockfileHash || fingerprint(join(repoRoot, 'node_modules/.pnpm/lock.yaml')) !== installedLockfileHash) throw new Error('Dependency installation changed while snapshotting; retry after installation finishes');
  const manifest = { id, lockfileHash, installedLockfileHash, logicalBytes, files, removedWorkspaceLinks,
    method: 'COPYFILE_FICLONE with filesystem copy fallback; never hard-linked', createdAt: new Date().toISOString() };
  writeFileSync(join(partial, 'dependency-manifest.json'), JSON.stringify(manifest, null, 2));
  try { renameSync(partial, root); }
  catch (error) {
    if (!['ENOTEMPTY', 'EEXIST'].includes(error.code) || !existsSync(ready)) throw error;
    const winner = JSON.parse(readFileSync(ready, 'utf8'));
    if (winner.id !== id || winner.lockfileHash !== lockfileHash || winner.installedLockfileHash !== installedLockfileHash) throw new Error('Racing dependency snapshot has different provenance');
    // Delete ONLY this process's unpublished copy; preserve the completed winner.
    rmSync(partial, { recursive: true, force: true });
    return { root, ...winner };
  }
  return { root, ...manifest };
}

/** Rebind every workspace, package scope and executable to frozen dependencies. */
export function mirrorDependencies(original, staged, stagedRoot, dependencies) {
  if (!existsSync(original)) return;
  mkdirSync(staged, { recursive: true });
  for (const name of readdirSync(original)) {
    const from = join(original, name), to = join(staged, name);
    if (name.startsWith('@')) {
      mirrorDependencies(from, to, stagedRoot, dependencies);
    } else if (name === '.bin' && dependencies) {
      mkdirSync(to, { recursive: true });
      for (const executable of readdirSync(from)) {
        const dest = join(to, executable), source = join(from, executable);
        copyFileSync(source, dest); chmodSync(dest, lstatSync(source).mode);
        patchExecutable(dest, [[join(repoRoot, 'node_modules'), join(dependencies.root, 'node_modules')], [repoRoot, stagedRoot]]);
      }
    } else if (['.cache', '.vite', '.vite-temp'].includes(name)) continue;
    else {
      const originalTarget = realpathSync(from), path = relative(repoRoot, originalTarget);
      const storePath = dependencies ? relative(realpathSync(join(repoRoot, 'node_modules/.pnpm')), originalTarget) : null;
      if (/^(packages|apps)\//.test(path) && !path.includes('/node_modules/')) {
        const target = join(stagedRoot, path);
        if (!existsSync(join(target, 'package.json'))) throw new Error(`Missing staged workspace package: ${name}`);
        symlinkSync(target, to, 'dir');
      } else if (dependencies && storePath !== '..' && !storePath.startsWith('../')) {
        symlinkSync(join(dependencies.root, 'node_modules/.pnpm', storePath), to, lstatSync(originalTarget).isDirectory() ? 'dir' : 'file');
      } else if (dependencies && !lstatSync(originalTarget).isDirectory() && path.startsWith('node_modules/')) {
        copyFileSync(originalTarget, to);
      } else if (dependencies) throw new Error(`Dependency is outside the frozen pnpm layer: ${name}`);
      else symlinkSync(originalTarget, to, lstatSync(originalTarget).isDirectory() ? 'dir' : 'file');
    }
  }
}

export function auditDependencyLinks(stagedRoot, dependencyRoot) {
  stagedRoot = realpathSync(stagedRoot);
  dependencyRoot = realpathSync(dependencyRoot);
  let links = 0, executables = 0;
  const walk = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isSymbolicLink()) {
        const target = realpathSync(path);
        if (!(target === stagedRoot || target.startsWith(`${stagedRoot}/`) || target === dependencyRoot || target.startsWith(`${dependencyRoot}/`))) throw new Error(`Staged dependency escapes frozen roots: ${relative(stagedRoot, path)}`);
        links++;
      } else if (item.isDirectory()) walk(path);
      else if (path.includes('/node_modules/.bin/')) {
        const bytes = readFileSync(path);
        if (!bytes.includes(0) && [join(repoRoot, 'node_modules'), join(repoRoot, 'apps'), join(repoRoot, 'packages')].some((prefix) => bytes.includes(Buffer.from(prefix)))) throw new Error(`Executable references mutable checkout: ${relative(stagedRoot, path)}`);
        executables++;
      }
    }
  };
  walk(join(stagedRoot, 'node_modules'));
  for (const folder of ['apps', 'packages']) {
    if (!existsSync(join(stagedRoot, folder))) continue;
    for (const name of readdirSync(join(stagedRoot, folder))) {
      const modules = join(stagedRoot, folder, name, 'node_modules');
      if (existsSync(modules)) walk(modules);
    }
  }
  return { links, executables, result: 'All staged module links/bins resolve inside frozen dependency/source roots' };
}

function git(...args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot identify Git source snapshot');
  return result.stdout;
}
function checked(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status})`);
}
function replaceFile(file, replacements) {
  if (!existsSync(file)) return;
  let value = readFileSync(file, 'utf8');
  for (const [before, after] of replacements) value = value.split(before).join(after);
  writeFileSync(file, value);
}

function nativeConfiguration(stagedRoot, env) {
  const mac = join(stagedRoot, 'apps/macos');
  if (existsSync(mac)) {
    replaceFile(join(mac, 'project.yml'), [
      ['ai.bookmarkai.macos', 'ai.bookmarkai.macos.supabaseqa'],
      ['PRODUCT_NAME: BookmarkAI', 'PRODUCT_NAME: BookmarkAISupabaseQA'],
      ['BookmarkAI.app/Contents/MacOS/BookmarkAI', 'BookmarkAISupabaseQA.app/Contents/MacOS/BookmarkAISupabaseQA'],
    ]);
    replaceFile(join(mac, 'Resources/Info.plist'), [['<string>Bookmark AI</string>', '<string>Bookmark AI Supabase QA</string>']]);
    const info = {
      BOOKMARK_BUILD_VARIANT: variant, BOOKMARK_API_URL: env.WXT_API_URL, BOOKMARK_LIVE_URL: env.WXT_LIVE_URL,
      BOOKMARK_AUTH_STORAGE_NAMESPACE: 'bookmark-ai:supabase-qa', BOOKMARK_AUTH_CALLBACK_SCHEME: 'bookmarkai-macos-supabase-qa',
      SUPABASE_URL: env.SUPABASE_URL || '', SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY || '',
      CFBundleURLTypes: [{ CFBundleURLSchemes: ['bookmarkai-macos-supabase-qa'], CFBundleURLName: 'ai.bookmarkai.macos.supabaseqa' }],
    };
    const result = spawnSync('python3', ['-c', 'import sys,json,plistlib; p=sys.argv[1]; d=plistlib.load(open(p,"rb")); d.update(json.load(sys.stdin)); plistlib.dump(d,open(p,"wb"))', join(mac, 'Resources/Info.plist')], { input: JSON.stringify(info), encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Failed to write staged Mac public configuration');
    const entitlement = join(mac, 'Resources/BookmarkAI.entitlements');
    const signed = spawnSync('python3', ['-c', 'import sys,plistlib; p=sys.argv[1]; d=plistlib.load(open(p,"rb")); d.pop("com.apple.developer.applesignin",None); d.update({"com.apple.developer.applesignin":["Default"]} if sys.argv[2]=="development" else {}); plistlib.dump(d,open(p,"wb"))', entitlement, env.BOOKMARK_QA_MACOS_SIGNING || 'unsigned'], { encoding: 'utf8' });
    if (signed.status !== 0) throw new Error('Failed to write staged Mac QA signing entitlements');
  }
  const safari = join(stagedRoot, 'apps/extension/safari-app');
  if (existsSync(safari)) {
    const replacements = [
      ['ai.bookmark.safari', 'ai.bookmark.safari.supabaseqa'],
      ['Bookmark AI for Safari', 'Bookmark AI Supabase QA for Safari'],
      ['PRODUCT_NAME: Bookmark AI Extension', 'PRODUCT_NAME: Bookmark AI Supabase QA Extension'],
      ['PRODUCT_NAME: Bookmark AI\n', 'PRODUCT_NAME: Bookmark AI Supabase QA\n'],
      ['<string>Bookmark AI</string>', '<string>Bookmark AI Supabase QA</string>'],
      ['<string>Bookmark AI Extension</string>', '<string>Bookmark AI Supabase QA Extension</string>'],
    ];
    const walk = (dir) => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, item.name);
        if (item.isDirectory()) walk(path);
        else if (/\.(swift|plist|entitlements|yml)$/.test(item.name)) replaceFile(path, replacements);
      }
    };
    walk(safari);
    replaceFile(join(safari, 'project.yml'), [['      - path: Extension/Resources/icon\n', '      - path: Extension/Resources/icon-dev\n        type: folder\n        optional: true\n      - path: Extension/Resources/icon\n']]);
  }
}

export function stageSources(surface, env) {
  const sha = git('rev-parse', '--short=12', 'HEAD').trim();
  const buildId = `${sha}-${Date.now()}-${surface}`;
  const runRoot = join(repoRoot, '.work/builds', variant, buildId);
  const stagedRoot = join(runRoot, 'source');
  mkdirSync(stagedRoot, { recursive: true });
  const selected = surface === 'check' ? Object.values(apps) : surface === 'web' ? [apps.web, apps.live] : [apps[surface]];
  const rootFiles = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'turbo.json', 'tsconfig.json', 'tsconfig.base.json']);
  const paths = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
  const hash = createHash('sha256');
  for (const path of [...new Set(paths)].sort()) {
    if (!(rootFiles.has(path) || path.startsWith('packages/') || path.startsWith('scripts/') || path.startsWith('supabase/') || selected.some((app) => path.startsWith(`apps/${app}/`)))) continue;
    if (/(?:^|\/)(?:\.env[^/]*|node_modules|\.keys|\.next[^/]*|\.output[^/]*|\.wxt|\.expo|DerivedData|build[^/]*|ios|android)(?:\/|$)/.test(path) || /\.xcodeproj\//.test(path)) continue;
    const from = join(repoRoot, path);
    if (!existsSync(from) || !lstatSync(from).isFile()) continue;
    const to = join(stagedRoot, path);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    hash.update(path).update(readFileSync(from));
  }
  let dependencies = dependencySnapshot();
  if (env.BOOKMARK_QA_NATIVE_BUILD === '1') {
    const frozenRoot = dependencies.root;
    dependencies = { ...dependencies, root: nativeDependencyOverlay(frozenRoot, runRoot), frozenRoot, nativeOverlay: true };
  }
  mirrorDependencies(join(repoRoot, 'node_modules'), join(stagedRoot, 'node_modules'), stagedRoot, dependencies);
  for (const folder of ['apps', 'packages']) {
    if (!existsSync(join(stagedRoot, folder))) continue;
    for (const name of readdirSync(join(stagedRoot, folder))) {
      mirrorDependencies(join(repoRoot, folder, name, 'node_modules'), join(stagedRoot, folder, name, 'node_modules'), stagedRoot, dependencies);
    }
  }
  const dependencyAudit = auditDependencyLinks(stagedRoot, dependencies.root);
  env.BOOKMARK_QA_STAGE_ROOT = stagedRoot;
  env.TMPDIR = join(runRoot, 'tmp');
  env.GRADLE_USER_HOME = join(runRoot, 'gradle-cache');
  env.CP_HOME_DIR = join(runRoot, 'cocoapods');
  env.CP_CACHE_DIR = join(runRoot, 'cocoapods-cache');
  env.COCOAPODS_DISABLE_STATS = 'true';
  mkdirSync(env.TMPDIR, { recursive: true });
  nativeConfiguration(stagedRoot, env);
  const manifest = { variant, buildId, gitSha: sha, sourceHash: hash.digest('hex'), surface, stagedRoot,
    lockfileHash: fingerprint(join(repoRoot, 'pnpm-lock.yaml')),
    installedLockfileHash: fingerprint(join(repoRoot, 'node_modules/.pnpm/lock.yaml')),
    dependencyLayer: dependencies,
    dependencyAudit,
    createdAt: new Date().toISOString(), status: 'prepared' };
  writeFileSync(join(runRoot, 'build-manifest.json'), JSON.stringify(manifest, null, 2));
  return { runRoot, stagedRoot, manifest };
}

export function main(argv = process.argv.slice(2)) {
  const [surface = 'check', action = 'build'] = argv;
  if (!surfaces.includes(surface) || !['build', 'prepare', 'dev', 'export', 'generate', 'typecheck', 'test'].includes(action) || argv.length > 2) throw new Error('Usage: node scripts/supabase-qa.mjs check|web|live|chrome|firefox|safari|macos|ios|android [build|prepare|dev|export|generate|typecheck|test]');
  if (['export', 'generate'].includes(action) && !['ios', 'android'].includes(surface)) throw new Error('export/generate are mobile-only actions');
  if (['test', 'typecheck'].includes(action) && ['check', 'macos'].includes(surface)) throw new Error('Use check for wrapper tests; Mac tests need an explicitly configured Xcode destination');
  const file = join(repoRoot, '.env.supabase.local');
  const env = qaEnvironment(existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}, process.env, surface);
  if (action === 'dev' && ['ios', 'android'].includes(surface)) {
    env.EXPO_PUBLIC_API_URL = env.NEXT_PUBLIC_API_URL;
    env.EXPO_PUBLIC_LIVE_API_URL = env.NEXT_PUBLIC_LIVE_API_URL;
    env.EXPO_PUBLIC_LIVE_URL = env.NEXT_PUBLIC_LIVE_API_URL;
  }
  if (action === 'build' && ['ios', 'android'].includes(surface)) env.BOOKMARK_QA_NATIVE_BUILD = '1';
  // macOS's /usr/bin/java may be only a launcher even when Homebrew JDK21 is
  // installed. Prefer that existing compiler without installing/changing Java.
  if (surface === 'android' && !env.JAVA_HOME) {
    const java21 = '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
    if (existsSync(join(java21, 'bin/java'))) env.JAVA_HOME = java21;
  }
  const { runRoot, stagedRoot, manifest } = stageSources(surface, env);
  const app = join(stagedRoot, 'apps', apps[surface] || 'mobile');
  env.PATH = `${join(app, 'node_modules/.bin')}:${env.PATH}`;
  console.log(`Supabase QA ${surface}: ${runRoot}`);
  try {
    if (surface === 'check') {
      checked(process.execPath, ['--test', join(stagedRoot, 'scripts/supabase-qa.test.mjs')], stagedRoot, env);
      checked('corepack', ['pnpm', 'exec', 'expo', 'config', '--type', 'public', '--json'], join(stagedRoot, 'apps/mobile'), { ...env, PATH: `${join(stagedRoot, 'apps/mobile/node_modules/.bin')}:${env.PATH}` });
    } else if (['test', 'typecheck'].includes(action)) {
      if (['chrome', 'firefox', 'safari'].includes(surface)) checked(process.execPath, ['scripts/wxt-run.mjs', 'prepare'], app, env);
      const testDirectory = surface === 'live' ? 'src' : 'src/lib';
      const testArgs = ['ios', 'android', 'live'].includes(surface)
        ? [process.execPath, '--import', 'tsx', '--test', ...readdirSync(join(app, testDirectory), { recursive: true }).filter((name) => name.endsWith('.test.ts')).map((name) => `${testDirectory}/${name}`)]
        : ['vitest', 'run'];
      checked('corepack', ['pnpm', 'exec', ...(action === 'typecheck' ? ['tsc', '--noEmit'] : testArgs)], app, env);
    } else if (action !== 'prepare') {
      if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new Error('QA Supabase URL/publishable key are required; no production fallback');
      if (surface === 'web') checked('corepack', ['pnpm', 'exec', 'next', action === 'dev' ? 'dev' : 'build', ...(action === 'dev' ? ['--port', '3100'] : [])], app, env);
      else if (surface === 'live') {
        checked('corepack', ['pnpm', 'exec', 'tsup', '--out-dir', 'dist-supabase-qa'], app, env);
        if (action === 'dev') checked(process.execPath, ['dist-supabase-qa/server.js'], app, env);
      }
      else if (['chrome', 'firefox', 'safari'].includes(surface)) {
        if (action === 'dev') throw new Error('QA extension builds are snapshots; use build then load explicitly');
        checked(process.execPath, ['scripts/wxt-run.mjs', 'prepare'], app, env);
        checked(process.execPath, ['scripts/wxt-run.mjs', 'build', '-b', surface, surface === 'firefox' ? '--mv2' : '--mv3', '-m', variant], app, env);
        if (surface === 'safari') {
          const out = join(app, '.output-supabase-qa');
          const bundle = readdirSync(out).find((name) => name.startsWith('safari-mv3'));
          if (!bundle) throw new Error('Missing staged Safari MV3 output');
          const native = join(app, 'safari-app');
          checked('rsync', ['-a', `${join(out, bundle)}/`, `${join(native, 'Extension/Resources')}/`], app, env);
          checked('xcodegen', ['generate'], native, env);
          checked('xcodebuild', ['-project', 'BookmarkAISafari.xcodeproj', '-scheme', 'BookmarkAI', '-configuration', 'Debug', '-derivedDataPath', join(runRoot, 'DerivedData-safari'), 'CODE_SIGNING_ALLOWED=NO', 'build'], native, env);
        }
      } else if (surface === 'macos') {
        checked('xcodegen', ['generate'], app, env);
        checked('xcodebuild', ['-project', 'BookmarkAI.xcodeproj', '-scheme', 'BookmarkAI', '-configuration', 'Debug', '-derivedDataPath', join(runRoot, 'DerivedData-macos'), ...macSigningArguments(env.BOOKMARK_QA_MACOS_SIGNING), 'build'], app, env);
      } else {
        if (action === 'dev') checked('corepack', ['pnpm', 'exec', 'expo', 'start', '--dev-client', '--port', '8083', '--localhost', '--scheme', 'bookmarkai-supabase-qa'], app, env);
        else if (action === 'export') checked('corepack', ['pnpm', 'exec', 'expo', 'export', '--platform', surface, '--output-dir', join(runRoot, 'export')], app, env);
        else {
          checked('corepack', ['pnpm', 'exec', 'expo', 'prebuild', '--platform', surface, '--no-install'], app, env);
          if (action === 'build') {
            if (surface === 'ios') {
              checked('pod', ['install'], join(app, 'ios'), env);
              const workspace = readdirSync(join(app, 'ios')).find((name) => name.endsWith('.xcworkspace'));
              if (!workspace) throw new Error('CocoaPods did not generate the staged iOS workspace');
              checked('xcodebuild', ['-workspace', workspace, '-scheme', 'BookmarkAISupabaseQA', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-derivedDataPath', join(runRoot, 'DerivedData-ios'), 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', 'build'], join(app, 'ios'), env);
            } else checked('./gradlew', ['assembleDebug', '--no-daemon'], join(app, 'android'), env);
          } else console.log('Native project generated in snapshot only; no compilation or installation attempted.');
        }
      }
    }
    manifest.status = 'success';
  } catch (error) {
    manifest.status = 'failed';
    throw error;
  } finally {
    writeFileSync(join(runRoot, 'build-manifest.json'), JSON.stringify(manifest, null, 2));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
