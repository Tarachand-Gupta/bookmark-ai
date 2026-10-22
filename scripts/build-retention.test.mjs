import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planRetention, retainBuildCaches, beginBuildRun, endBuildRun, withRetentionLock } from './build-retention.mjs';

const day = 86400000, now = Date.now();
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'build-retention-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function file(path, value = 'cache') { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, value); }
  function run(id, age, status = 'success', surface = 'ios', variant = 'supabase-production', action) {
    const path = join(root, '.work/builds', variant, id);
    const manifest = { buildId: id, variant, surface, status, action, stagedRoot: join(path, 'source'), createdAt: new Date(now - age * day).toISOString() };
    file(join(path, 'build-manifest.json'), JSON.stringify(manifest));
    file(join(path, 'DerivedData-ios/Build/Intermediates.noindex/object.o'));
    file(join(path, 'DerivedData-ios/Build/Products/Release/App.app/binary'), 'product');
    file(join(path, 'DerivedData-ios/Build/Products/Release/App.app.dSYM/symbols'), 'symbols');
    file(join(path, 'release/App.xcarchive/Info.plist'), 'archive');
    return path;
  }
  return { root, run, file, options: { root, now, activePaths: [] } };
}
test('latest production + rollback are per variant/surface; prepared/failed expire after seven days', t => {
  const f = fixture(t), old = f.run('old', 30), previous = f.run('previous', 20), latest = f.run('latest', 10, 'built');
  const recent = f.run('prepared', 1, 'prepared'), failed = f.run('failed', 15, 'failed');
  const qa = f.run('qa', 50, 'success', 'ios', 'supabase-qa'), android = f.run('android', 50, 'success', 'android');
  const typecheck = f.run('typecheck', 8, 'success', 'ios', 'supabase-production', 'typecheck');
  const plan = planRetention(f.options);
  assert.deepEqual(new Set(plan.kept.map(run => run.runRoot)), new Set([previous, latest, recent, qa, android]));
  assert.deepEqual(new Set(plan.candidates.map(run => run.runRoot)), new Set([old, failed, typecheck]));
});
test('dry-run leaves caches untouched; apply preserves products, archives, symbols and shared dependencies', t => {
  const f = fixture(t), old = f.run('old', 30); f.run('previous', 20); f.run('latest', 10);
  const dependencies = join(f.root, '.work/builds/supabase-qa/dependencies/layer/file'); f.file(dependencies);
  const manifestPath = join(old, 'build-manifest.json'), before = readFileSync(manifestPath, 'utf8');
  const cache = join(old, 'DerivedData-ios/Build/Intermediates.noindex');
  assert.equal(retainBuildCaches(f.options).applied, false);
  assert.equal(readFileSync(manifestPath, 'utf8'), before); assert.ok(existsSync(cache));
  const applied = retainBuildCaches({ ...f.options, apply: true }); assert.ok(applied.removed.includes(cache));
  for (const path of [dependencies, join(old, 'release/App.xcarchive/Info.plist'), join(old, 'DerivedData-ios/Build/Products/Release/App.app/binary'), join(old, 'DerivedData-ios/Build/Products/Release/App.app.dSYM/symbols')]) assert.ok(existsSync(path));
  assert.equal(JSON.parse(readFileSync(manifestPath)).cacheRetention.reusable, false);
});
test('exact release references, pins, processes, cwd and live build leases protect old snapshots', t => {
  const f = fixture(t); f.run('previous', 20); f.run('latest', 10);
  const pinned = f.run('pinned', 40), release = f.run('release', 41), mobile = f.run('mobile', 42), process = f.run('process', 43), cwd = f.run('cwd', 44), lease = f.run('lease', 45);
  f.file(join(pinned, '.retention-pin'));
  f.file(join(f.root, 'dist/production/ARTIFACTS.json'), JSON.stringify({ chrome: { buildManifest: join(release, 'build-manifest.json') } }));
  f.file(join(f.root, 'dist/production/mobile-manifest.json'), JSON.stringify({ artifacts: { ios: { runRoot: mobile } } }));
  beginBuildRun(f.root, lease);
  const plan = planRetention({ ...f.options, activePaths: [`node ${process}/source/apps/web/server.js`, `n${cwd}`] });
  assert.equal(plan.candidates.length, 0);
  endBuildRun(lease);
  assert.ok(plan.kept.find(run => run.runRoot === lease).reasons.includes('active build lease'));
});
test('cold mode keeps pins/consumers but can discard warm cache of referenced latest run', t => {
  const f = fixture(t), latest = f.run('latest', 1), pin = f.run('pin', 1), active = f.run('active', 1);
  f.file(join(pin, '.retention-pin'));
  f.file(join(f.root, 'dist/production/ARTIFACTS.json'), JSON.stringify({ ios: { buildManifest: join(latest, 'build-manifest.json') } }));
  const plan = planRetention({ ...f.options, cold: true, activePaths: [`n${active}`] });
  assert.deepEqual(plan.candidates.map(run => run.runRoot), [latest]);
  assert.deepEqual(new Set(plan.kept.map(run => run.runRoot)), new Set([pin, active]));
});
test('symlinked caches, manifests, metadata and lock ancestry never write or delete outside roots', t => {
  const f = fixture(t), old = f.run('old', 40); f.run('previous', 20); f.run('latest', 10);
  const external = join(f.root, 'outside'); f.file(join(external, 'file'), 'keep');
  symlinkSync(external, join(old, 'tmp'), 'dir');
  const plan = planRetention(f.options); assert.ok(!plan.candidates[0].paths.includes(join(old, 'tmp')));
  retainBuildCaches({ ...f.options, apply: true }); assert.equal(readFileSync(join(external, 'file'), 'utf8'), 'keep');
  rmSync(join(old, 'build-manifest.json')); symlinkSync(join(external, 'file'), join(old, 'build-manifest.json'));
  assert.throws(() => planRetention(f.options), /regular file/);
  const f2 = fixture(t); mkdirSync(join(f2.root, 'external')); symlinkSync(join(f2.root, 'external'), join(f2.root, '.work'), 'dir');
  assert.throws(() => withRetentionLock(f2.root, () => assert.fail()), /real directories/);
  const f3 = fixture(t), leaseRun = f3.run('lease', 30), missing = join(f3.root, 'outside-created');
  symlinkSync(missing, join(leaseRun, '.build-active.json'));
  assert.throws(() => beginBuildRun(f3.root, leaseRun), /regular file/); assert.ok(!existsSync(missing));
});
test('release assets inside cache move intact, retaining provenance and selecting nested bundles once', t => {
  const f = fixture(t), old = f.run('old', 30); f.run('previous', 20); f.run('latest', 10);
  for (const name of ['App.dSYM', 'App.xcarchive', 'release.ipa', 'release.apk', 'release.aab', 'release.zip', 'release.pkg', 'release.dmg']) f.file(join(old, 'tmp', name), 'keep');
  f.file(join(old, 'tmp/Nested.xcarchive/dSYMs/Symbols.dSYM/file'), 'nested');
  const applied = retainBuildCaches({ ...f.options, apply: true });
  assert.equal(applied.retained.length, 9); assert.ok(!existsSync(join(old, 'tmp')));
  assert.equal(readFileSync(join(old, 'retained-cache-assets/tmp/release.ipa'), 'utf8'), 'keep');
  assert.equal(readFileSync(join(old, 'retained-cache-assets/tmp/Nested.xcarchive/dSYMs/Symbols.dSYM/file'), 'utf8'), 'nested');
  assert.ok(JSON.parse(readFileSync(join(old, 'build-manifest.json'))).cacheRetention.retainedAssets.every(record => record.state === 'retained'));
  assert.equal(planRetention(f.options).candidates.length, 0);
});
test('asset destination collision and destination symlink preserve the entire original cache', t => {
  for (const mode of ['collision', 'symlink']) {
    const f = fixture(t), old = f.run('old', 30); f.run('previous', 20); f.run('latest', 10);
    f.file(join(old, 'tmp/release.ipa'), 'original');
    if (mode === 'collision') f.file(join(old, 'retained-cache-assets/tmp/release.ipa'), 'existing');
    else { mkdirSync(join(f.root, 'external')); symlinkSync(join(f.root, 'external'), join(old, 'retained-cache-assets'), 'dir'); }
    assert.throws(() => retainBuildCaches({ ...f.options, apply: true }), /destination already exists|ancestry must contain real directories/);
    assert.equal(readFileSync(join(old, 'tmp/release.ipa'), 'utf8'), 'original');
    if (mode === 'collision') assert.equal(readFileSync(join(old, 'retained-cache-assets/tmp/release.ipa'), 'utf8'), 'existing');
  }
});
test('unsafe links inside assets or protected asset symlinks prevent relocation/removal', t => {
  for (const mode of ['internal', 'protected', 'cross-cache']) {
    const f = fixture(t), old = f.run('old', 30); f.run('previous', 20); f.run('latest', 10);
    f.file(join(old, 'tmp/sibling'), 'keep');
    if (mode === 'internal') { mkdirSync(join(old, 'tmp/Symbols.dSYM')); symlinkSync('../sibling', join(old, 'tmp/Symbols.dSYM/link')); }
    else if (mode === 'protected') symlinkSync('sibling', join(old, 'tmp/release.ipa'));
    else { f.file(join(old, 'gradle-cache/caches/Symbols.dSYM/file')); symlinkSync(join(old, 'tmp/sibling'), join(old, 'gradle-cache/caches/Symbols.dSYM/link')); }
    assert.throws(() => retainBuildCaches({ ...f.options, apply: true }), /would break|asset is a symlink/);
    assert.ok(existsSync(join(old, 'tmp/sibling')));
    assert.ok(existsSync(join(old, 'DerivedData-ios/Build/Intermediates.noindex/object.o')));
    if (mode === 'cross-cache') assert.ok(existsSync(join(old, 'gradle-cache/caches/Symbols.dSYM/file')));
  }
});
test('interrupted completed move is reconciled before the remaining cache is pruned', t => {
  const f = fixture(t), old = f.run('old', 30); f.run('previous', 20); f.run('latest', 10);
  f.file(join(old, 'tmp/Symbols.dSYM/file'), 'symbols'); f.file(join(old, 'tmp/junk'));
  const destination = join(old, 'retained-cache-assets/tmp/Symbols.dSYM'); mkdirSync(join(destination, '..'), { recursive: true }); renameSync(join(old, 'tmp/Symbols.dSYM'), destination);
  const manifestPath = join(old, 'build-manifest.json'), manifest = JSON.parse(readFileSync(manifestPath));
  manifest.cacheRetention = { prunedAt: new Date().toISOString(), retainedAssets: [{ original: 'tmp/Symbols.dSYM', retained: 'retained-cache-assets/tmp/Symbols.dSYM', state: 'pending' }] };
  f.file(manifestPath, JSON.stringify(manifest)); retainBuildCaches({ ...f.options, apply: true });
  assert.ok(!existsSync(join(old, 'tmp'))); assert.equal(readFileSync(join(destination, 'file'), 'utf8'), 'symbols');
  assert.equal(JSON.parse(readFileSync(manifestPath)).cacheRetention.retainedAssets[0].state, 'retained');
});
test('legacy asset-only skips are retried, while direct release asset references protect their cache in cold mode', t => {
  const f = fixture(t), old = f.run('old', 30); f.run('previous', 20); f.run('latest', 10);
  f.file(join(old, 'tmp/Symbols.dSYM/file'), 'symbols');
  const manifestPath = join(old, 'build-manifest.json'), manifest = JSON.parse(readFileSync(manifestPath));
  manifest.cacheRetention = { skipped: { tmp: 'contains a protected release asset' } }; f.file(manifestPath, JSON.stringify(manifest));
  assert.ok(planRetention(f.options).candidates.some(run => run.paths.includes(join(old, 'tmp'))));
  f.file(join(f.root, 'dist/production/ARTIFACTS.json'), JSON.stringify({ archive: { path: join(old, 'tmp/Symbols.dSYM/file') } }));
  retainBuildCaches({ ...f.options, cold: true, apply: true }); assert.ok(existsSync(join(old, 'tmp/Symbols.dSYM/file')));
});
test('native overlay ownership is exact; dependency ZIPs may be pruned, shared store stays', t => {
  const f = fixture(t), old = f.run('old', 30); f.run('previous', 20); f.run('latest', 10);
  const path = join(old, 'native-dependencies'), manifestPath = join(old, 'build-manifest.json'), manifest = JSON.parse(readFileSync(manifestPath));
  f.file(join(path, 'node_modules/dependency/archive.zip')); manifest.dependencyLayer = { nativeOverlay: true, root: path }; f.file(manifestPath, JSON.stringify(manifest));
  f.file(join(path, 'node_modules/hermes/hermes.framework/binary'));
  retainBuildCaches({ ...f.options, apply: true }); assert.ok(!existsSync(path));
});
test('lease validation happens inside lock and failed validation publishes no lease', t => {
  const f = fixture(t), run = f.run('reuse', 10);
  assert.throws(() => beginBuildRun(f.root, run, () => { assert.ok(existsSync(join(f.root, '.work/builds/.retention-lock'))); throw new Error('pruned'); }), /pruned/);
  assert.ok(!existsSync(join(run, '.build-active.json')));
  beginBuildRun(f.root, run); assert.throws(() => beginBuildRun(f.root, run), /already in use/); endBuildRun(run);
  rmSync(join(run, 'source'), { recursive: true, force: true });
  mkdirSync(join(f.root, 'outside')); symlinkSync(join(f.root, 'outside'), join(run, 'source'), 'dir');
  assert.throws(() => beginBuildRun(f.root, run), /source must be a real directory/);
});
test('malformed release metadata and bounded metadata overflow fail closed', t => {
  const f = fixture(t); f.run('one', 10); f.run('two', 20);
  assert.throws(() => planRetention({ ...f.options, maxRuns: 1 }), /metadata limit/);
  f.file(join(f.root, 'dist/production/ARTIFACTS.json'), '{broken');
  assert.throws(() => retainBuildCaches({ ...f.options, apply: true }), SyntaxError);
});
