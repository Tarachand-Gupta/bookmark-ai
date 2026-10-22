import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { parseEnv, qaEnvironment, mirrorDependencies, auditDependencyLinks, nativeDependencyOverlay, macSigningArguments, repoRoot, isExcludedSourcePath } from './supabase-qa.mjs';

test('snapshots preserve build helpers while excluding generated builds and private files', () => {
  for (const path of ['scripts/build-retention.mjs', 'scripts/build-retention.test.mjs', 'apps/extension/scripts/build.mjs']) assert.equal(isExcludedSourcePath(path), false, path);
  for (const path of ['apps/extension/build/output.js', 'apps/extension/build-release/output.js', '.env.supabase.production.local', 'apps/extension/.keys/key.pem', 'apps/extension/.output/firefox-mv2/background.js']) assert.equal(isExcludedSourcePath(path), true, path);
});

test('caller production credentials are not inherited; only explicit QA credentials survive', () => {
  const env = qaEnvironment({ SUPABASE_URL: 'https://xogqaqtyacmecdbmgqqd.supabase.co' }, {
    PATH: '/test/bin', CLERK_SECRET_KEY: 'do-not-copy', DATABASE_AUTH_TOKEN: 'do-not-copy',
    SUPABASE_SECRET_KEY: 'do-not-copy', NEXT_PUBLIC_API_URL: 'https://www.bookmark-ai.cloud',
  });
  assert.equal(env.CLERK_SECRET_KEY, undefined);
  assert.equal(env.DATABASE_AUTH_TOKEN, undefined);
  assert.equal(env.SUPABASE_SECRET_KEY, undefined);
  assert.equal(env.NEXT_PUBLIC_API_URL, 'http://localhost:3100');
  assert.equal(env.WXT_API_URL, 'http://localhost:3100');
  assert.equal(env.EXPO_NO_DOTENV, '1');
});

test('Live refuses implicit/default Redis and requires isolated content encryption', () => {
  assert.throws(() => qaEnvironment({}, {}, 'live'), /REDIS_URL/);
  for (const REDIS_URL of ['redis://localhost:6379/0', 'redis://remote.example:6386/0', 'redis://127.0.0.1:6386/1']) assert.throws(() => qaEnvironment({ REDIS_URL, LIVE_ENCRYPTION_SECRET: 'x'.repeat(32) }, {}, 'live'));
  assert.throws(() => qaEnvironment({ REDIS_URL: 'redis://127.0.0.1:6386/0' }, {}, 'live'), /encryption/);
  assert.equal(qaEnvironment({ REDIS_URL: 'redis://127.0.0.1:6386/0', LIVE_ENCRYPTION_SECRET: 'x'.repeat(32) }, {}, 'live').REDIS_URL, 'redis://127.0.0.1:6386/0');
});

test('Mac signing is explicit and staged; ad-hoc and development modes are bounded', () => {
  assert.deepEqual(macSigningArguments(), ['CODE_SIGNING_ALLOWED=NO']);
  assert.ok(macSigningArguments('adhoc').includes('CODE_SIGN_IDENTITY=-'));
  assert.ok(macSigningArguments('development').includes('DEVELOPMENT_TEAM=L3PP7DQZWS'));
  assert.throws(() => macSigningArguments('production'));
  assert.equal(qaEnvironment({}, { BOOKMARK_QA_MACOS_SIGNING: 'adhoc' }, 'macos').BOOKMARK_QA_MACOS_SIGNING, 'adhoc');
  assert.throws(() => qaEnvironment({}, { BOOKMARK_QA_MACOS_SIGNING: 'other' }, 'macos'));
});

test('native compiler overlay preserves dependency sources and isolates generated package outputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bmai-native-overlay-'));
  try {
    const frozen = join(dir, 'frozen'), run = join(dir, 'run');
    const plugin = join(frozen, 'node_modules/.pnpm/plugin/node_modules/@react-native/gradle-plugin');
    mkdirSync(join(plugin, 'shared/build'), { recursive: true });
    mkdirSync(join(plugin, 'src'), { recursive: true });
    writeFileSync(join(plugin, 'src/source.kt'), 'source'); writeFileSync(join(plugin, 'shared/build/old.jar'), 'old');
    const overlay = nativeDependencyOverlay(frozen, run);
    const copied = join(overlay, 'node_modules/.pnpm/plugin/node_modules/@react-native/gradle-plugin');
    assert.equal(readFileSync(join(copied, 'src/source.kt'), 'utf8'), 'source');
    assert.throws(() => readFileSync(join(copied, 'shared/build/old.jar')), /ENOENT/);
    writeFileSync(join(copied, 'src/source.kt'), 'compiler change');
    assert.equal(readFileSync(join(plugin, 'src/source.kt'), 'utf8'), 'source');
    assert.equal(readFileSync(join(plugin, 'shared/build/old.jar'), 'utf8'), 'old');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('mixed provider, project, production URL and auth bypass fail closed', () => {
  for (const source of [
    { AUTH_PROVIDER: 'clerk' }, { NEXT_PUBLIC_AUTH_PROVIDER: 'clerk' },
    { BOOKMARK_BUILD_VARIANT: 'production' }, { DEV_OPEN_API: '1' },
    { BOOKMARK_QA_WEB_URL: 'https://www.bookmark-ai.cloud' },
    { BOOKMARK_QA_LIVE_URL: 'https://bookmark-ai-theta.vercel.app' },
    { SUPABASE_URL: 'https://different-project.supabase.co' },
  ]) assert.throws(() => qaEnvironment(source));
});

test('QA env parser is literal and rejects old credentials; no shell expansion', () => {
  assert.deepEqual(parseEnv('AUTH_PROVIDER=supabase\nVALUE="$(do-not-execute)"'), { AUTH_PROVIDER: 'supabase', VALUE: '$(do-not-execute)' });
  assert.throws(() => parseEnv('CLERK_SECRET_KEY=forbidden'));
  assert.throws(() => parseEnv('MASTER_DATABASE_URL=forbidden'));
  assert.throws(() => parseEnv('not a variable'));
});

test('native public URLs and callback/storage namespace are independent of production', () => {
  const env = qaEnvironment({}, {}, 'android');
  assert.equal(env.EXPO_PUBLIC_API_URL, 'http://10.0.2.2:3100');
  assert.equal(env.EXPO_PUBLIC_LIVE_URL, 'http://10.0.2.2:3101');
  assert.equal(env.EXPO_PUBLIC_AUTH_REDIRECT_URL, 'bookmarkai-supabase-qa://sso-callback');
  assert.equal(env.EXPO_PUBLIC_AUTH_STORAGE_NAMESPACE, 'bookmark-ai:supabase-qa');
});

test('workspace symlinks are rebound; missing staged dependency is rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supabase-qa-dependencies-'));
  try {
    const original = join(dir, 'original'), staged = join(dir, 'source');
    mkdirSync(join(original, '@bookmark-ai'), { recursive: true });
    symlinkSync(join(repoRoot, 'packages/types'), join(original, '@bookmark-ai/types'));
    assert.throws(() => mirrorDependencies(original, join(staged, 'node_modules'), staged), /Missing staged/);
    rmSync(join(staged, 'node_modules'), { recursive: true, force: true });
    mkdirSync(join(staged, 'packages/types'), { recursive: true });
    writeFileSync(join(staged, 'packages/types/package.json'), '{}');
    mirrorDependencies(original, join(staged, 'node_modules'), staged);
    assert.equal(realpathSync(join(staged, 'node_modules/@bookmark-ai/types')), realpathSync(join(staged, 'packages/types')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('external package scopes and executable paths use frozen dependency bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supabase-qa-external-'));
  try {
    const original = join(dir, 'original'), staged = join(dir, 'source'), frozen = join(dir, 'frozen');
    const target = realpathSync(join(repoRoot, 'apps/extension/node_modules/wxt'));
    const frozenTarget = join(frozen, 'node_modules/.pnpm', relative(realpathSync(join(repoRoot, 'node_modules/.pnpm')), target));
    mkdirSync(frozenTarget, { recursive: true });
    mkdirSync(join(original, '@example'), { recursive: true });
    mkdirSync(join(original, '.bin'), { recursive: true });
    symlinkSync(target, join(original, '@example/tool'));
    writeFileSync(join(original, '.bin/tool'), `#!/bin/sh\nNODE_PATH="${repoRoot}/node_modules/.pnpm/node_modules"\n`);
    mirrorDependencies(original, join(staged, 'node_modules'), staged, { root: frozen });
    assert.equal(realpathSync(join(staged, 'node_modules/@example/tool')), realpathSync(frozenTarget));
    assert.ok(readFileSync(join(staged, 'node_modules/.bin/tool'), 'utf8').includes(frozen));
    assert.ok(!readFileSync(join(staged, 'node_modules/.bin/tool'), 'utf8').includes(`${repoRoot}/node_modules`));
    assert.deepEqual(auditDependencyLinks(staged, frozen), { links: 1, executables: 1, result: 'All staged module links/bins resolve inside frozen dependency/source roots' });
    symlinkSync(target, join(staged, 'node_modules/unsafe'));
    assert.throws(() => auditDependencyLinks(staged, frozen), /escapes frozen/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Expo shipped identity stays intact; migration builds require an isolated QA variant', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const configure = require('../apps/mobile/app.config.js');
  const config = require('../apps/mobile/app.json').expo;
  const before = { ...process.env };
  try {
    delete process.env.BOOKMARK_BUILD_VARIANT;
    assert.throws(() => configure({ config }), /migration mobile builds/);
    process.env.BOOKMARK_BUILD_VARIANT = 'supabase-qa';
    delete process.env.BOOKMARK_QA_STAGE_ROOT;
    assert.throws(() => configure({ config }), /must use/);
    process.env.BOOKMARK_QA_STAGE_ROOT = '/test/source';
    const qa = configure({ config });
    assert.equal(qa.ios.bundleIdentifier, 'ai.bookmarkai.supabaseqa');
    assert.equal(qa.android.package, 'ai.bookmarkai.supabaseqa');
    assert.equal(qa.scheme, 'bookmarkai-supabase-qa');
    assert.deepEqual(qa.ios.entitlements['com.apple.security.application-groups'], ['group.ai.bookmarkai.supabaseqa']);
    assert.equal(config.ios.bundleIdentifier, 'ai.bookmarkai');
  } finally {
    for (const key of ['BOOKMARK_BUILD_VARIANT', 'BOOKMARK_QA_STAGE_ROOT']) {
      if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
    }
  }
});


test('explicit hosted target pins production endpoints and preserves distinct auth identity', () => {
  const hosted = { BOOKMARK_HOSTED_TARGET: 'production', BOOKMARK_QA_WEB_URL: 'https://www.bookmark-ai.cloud', BOOKMARK_QA_LIVE_URL: 'https://live.bookmark-ai.cloud', REDIS_URL: 'redis://127.0.0.1:6379/3', LIVE_ENCRYPTION_SECRET: 'x'.repeat(32) };
  const env = qaEnvironment(hosted, {}, 'live');
  assert.equal(env.NEXT_PUBLIC_API_URL, 'https://www.bookmark-ai.cloud');
  assert.equal(env.EXPO_PUBLIC_HOSTED_TARGET, 'production');
  assert.equal(env.WXT_AUTH_STORAGE_NAMESPACE, 'bookmark-ai:supabase-qa');
  assert.equal(env.BOOKMARK_BUILD_VARIANT, 'supabase-qa');
  for (const patch of [{ BOOKMARK_HOSTED_TARGET: 'other' }, { BOOKMARK_QA_WEB_URL: 'http://bookmark-ai.cloud' }, { BOOKMARK_QA_LIVE_URL: 'https://evil.example' }, { REDIS_URL: 'redis://127.0.0.1:6379/2' }]) assert.throws(() => qaEnvironment({ ...hosted, ...patch }, {}, 'live'));
  assert.throws(() => qaEnvironment({ ...hosted, BOOKMARK_HOSTED_TARGET: undefined }, {}, 'live'));
});
