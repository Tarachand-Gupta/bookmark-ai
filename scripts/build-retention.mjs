#!/usr/bin/env node
/** Keep products/provenance; prune only obsolete snapshot caches. No dependency-store GC. */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const variants = ['supabase-qa', 'supabase-production'];
const week = 7 * 24 * 60 * 60 * 1000;
const stat = (path) => { try { return lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } };
const json = (path) => {
  if (!lstatSync(path).isFile()) throw new Error('Retention metadata must be a regular file, never a symlink');
  return JSON.parse(readFileSync(path, 'utf8'));
};
const inside = (root, path) => path === root || path.startsWith(`${root}/`);
const livePid = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };

// Staging, reuse and pruning share this short-lived lock; a concurrent operator retries.
export function withRetentionLock(root, work) {
  const lock = join(root, '.work/builds/.retention-lock');
  for (const path of [root, join(root, '.work'), dirname(lock)]) {
    if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())) throw new Error('Retention lock ancestry must contain real directories');
  }
  mkdirSync(dirname(lock), { recursive: true });
  try { mkdirSync(lock); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Build retention is locked; retry after the other operation finishes (inspect a stale lock before removing it)');
    throw error;
  }
  try { writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); return work(); }
  finally { rmSync(lock, { recursive: true, force: true }); }
}
export function beginBuildRun(root, runRoot, validate = () => {}) {
  return withRetentionLock(root, () => {
    if (!variants.some(variant => dirname(runRoot) === join(root, '.work/builds', variant))) throw new Error('Build lease requires an exact managed snapshot');
    if (stat(dirname(runRoot)) && !safeCache(root, dirname(runRoot))) throw new Error('Snapshot parent must contain real directories');
    mkdirSync(runRoot, { recursive: true });
    if (!safeCache(root, runRoot)) throw new Error('Snapshot must contain real directories');
    const source = join(runRoot, 'source');
    if (stat(source) && (!stat(source).isDirectory() || !safeCache(root, source))) throw new Error('Snapshot source must be a real directory');
    const validated = validate();
    const path = join(runRoot, '.build-active.json');
    if (stat(path) && livePid(json(path).pid)) throw new Error('Snapshot is already in use by a build');
    writeFileSync(path, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    return validated;
  });
}
export function endBuildRun(runRoot) {
  const path = join(runRoot, '.build-active.json');
  if (stat(path) && json(path).pid === process.pid) rmSync(path);
}

/** One bounded OS inventory; includes servers, compiler children, cwd, mmap and open products. */
export function activeBuildPaths(root) {
  const results = [
    spawnSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 15000 }),
    spawnSync(process.platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof', ['-n', '-P', '-Fpn'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 15000 }),
  ];
  if (results.some(result => result.error || result.status !== 0)) throw new Error('Active process/open-file inventory unavailable; retention refused');
  const prefix = join(root, '.work/builds') + '/';
  return results.flatMap(result => result.stdout.split('\n').filter(line => line.includes(prefix)));
}

function releaseReferences(root) {
  const paths = [];
  const visit = (value) => {
    if (typeof value === 'string') paths.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  for (const name of ['ARTIFACTS.json', 'mobile-manifest.json']) {
    const path = join(root, 'dist/production', name);
    if (existsSync(path)) visit(json(path)); // Malformed release metadata fails closed.
  }
  return paths;
}

/** Fixed paths, never a broad source or DerivedData deletion. Products and dSYMs remain. */
function cachePaths(runRoot, manifest) {
  const names = ['tmp', 'gradle-cache/caches', 'gradle-cache/wrapper', 'cocoapods-cache',
    'source/apps/web/.next/cache', 'source/apps/web/.next-supabase-qa/cache', 'source/apps/web/.next-supabase-production/cache',
    'source/.turbo', 'source/apps/web/.turbo', 'source/apps/mobile/ios/build', 'source/apps/extension/.wxt',
    'source/apps/mobile/android/.gradle', 'source/apps/mobile/android/.cxx',
    'source/apps/mobile/android/app/.cxx', 'source/apps/mobile/android/app/build/intermediates',
    'source/apps/mobile/android/build/intermediates'];
  for (const entry of readdirSync(runRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && /^DerivedData(?:-[a-z0-9-]+)?$/i.test(entry.name)) for (const cache of ['Build/Intermediates.noindex', 'ModuleCache.noindex', 'SDKStatCaches.noindex', 'Index.noindex']) names.push(`${entry.name}/${cache}`);
  }
  // Only the explicitly recorded per-run overlay is disposable. Shared layers stay.
  if (manifest.dependencyLayer?.nativeOverlay === true && manifest.dependencyLayer.root === join(runRoot, 'native-dependencies')) names.push('native-dependencies');
  return names.map(name => join(runRoot, name)).filter(existsSync);
}
function safeCache(root, path) {
  // Inspect the path components without following symlinks, including the root.
  if (!inside(root, path)) return false;
  let current = root;
  for (const name of ['', ...relative(root, path).split('/').filter(Boolean)]) {
    if (name) current = join(current, name);
    if (lstatSync(current).isSymbolicLink()) return false;
  }
  return inside(realpathSync(root), realpathSync(path));
}

export function planRetention({ root = defaultRoot, variant, surface, cold = false, now = Date.now(), activePaths, maxRuns = 2000 } = {}) {
  root = resolve(root);
  if (variant && !variants.includes(variant)) throw new Error('Unknown retention variant');
  const active = activePaths ?? activeBuildPaths(root);
  const references = releaseReferences(root);
  const runs = [];
  for (const name of variants.filter(name => !variant || name === variant)) {
    const base = join(root, '.work/builds', name);
    if (!existsSync(base)) continue;
    if (!safeCache(root, base)) throw new Error('Build variant directory must not be a symlink');
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'dependencies') continue;
      if (runs.length >= maxRuns) throw new Error('Retention metadata limit reached; inspect the build inventory manually');
      const runRoot = join(base, entry.name), manifestPath = join(runRoot, 'build-manifest.json');
      if (!existsSync(manifestPath)) continue; // Unknown/incomplete runs require manual inspection.
      const manifest = json(manifestPath);
      if (manifest.variant !== name || manifest.buildId !== entry.name || resolve(manifest.stagedRoot || '') !== join(runRoot, 'source')) throw new Error('Build manifest does not match its snapshot');
      if (surface && manifest.surface !== surface) continue;
      const created = Date.parse(manifest.createdAt);
      if (!Number.isFinite(created)) throw new Error('Build manifest has no valid creation time');
      const reasons = [];
      if (stat(join(runRoot, '.retention-pin'))) reasons.push('operator pin');
      if (!cold && references.some(path => path === runRoot || path.startsWith(runRoot + '/'))) reasons.push('current release reference');
      if (active.some(path => path.includes(runRoot + '/') || path.endsWith(runRoot))) reasons.push('active consumer');
      const lease = join(runRoot, '.build-active.json');
      if (stat(lease) && livePid(json(lease).pid)) reasons.push('active build lease');
      runs.push({ runRoot, manifest, created, reasons });
    }
  }
  const groups = Map.groupBy(runs, run => `${run.manifest.variant}:${run.manifest.surface}`);
  for (const group of cold ? [] : groups.values()) {
    group.sort((a, b) => b.created - a.created);
    const successes = group.filter(run => ['success', 'built'].includes(run.manifest.status) && !run.manifest.cacheRetention?.prunedAt && (!run.manifest.action || ['build', 'bundle', 'zip', 'export'].includes(run.manifest.action)));
    successes.slice(0, 2).forEach((run, i) => run.reasons.push(i ? 'previous success rollback' : 'latest success'));
    // A third warm snapshot is useful for interrupted/prepared work, but expires.
    const recent = group.find(run => !run.reasons.length && now - run.created < week);
    if (recent) recent.reasons.push('recent extra snapshot (7 days)');
  }
  return { root, kept: runs.filter(run => run.reasons.length).map(({ runRoot, reasons }) => ({ runRoot, reasons })),
    candidates: runs.filter(run => !run.reasons.length).map(run => ({ runRoot: run.runRoot, paths: cachePaths(run.runRoot, run.manifest).filter(path => {
      const skipped = run.manifest.cacheRetention?.skipped?.[relative(run.runRoot, path)];
      // Version two retains protected assets separately rather than blocking an
      // entire cache. Only that exact legacy skip is eligible for reconsideration.
      return safeCache(root, path) && !references.some(reference => reference === path || reference.startsWith(path + '/')) && (!skipped || skipped === 'contains a protected release asset');
    }) })).filter(run => run.paths.length) };
}

// Cache allowlist can contain an unexpected release asset. Refuse that whole cache,
// rather than discovering this only after deletion. No recursive scan during dry-run.
function protectedAssets(path, budget, dependencyCache = false) {
  const assets = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (--budget.remaining < 0) throw new Error('Cache inspection limit reached; preserve this snapshot for manual inspection');
    if (budget.overall && --budget.overall.remaining < 0) throw new Error('Whole-plan inspection limit reached; narrow retention by variant and surface');
    const child = join(path, entry.name);
    if (/\.(xcarchive|dSYM|ipa|apk|aab|pkg|dmg)$/i.test(entry.name) || (!dependencyCache && /\.(app|appex|framework|zip)$/i.test(entry.name))) {
      if (entry.isSymbolicLink()) throw new Error('Protected asset is a symlink; inspect it manually');
      assets.push(child); // Never descend into a selected archive/bundle.
    } else if (entry.isDirectory()) assets.push(...protectedAssets(child, budget, dependencyCache));
  }
  return assets;
}
function prepareAssetMoves(root, runRoot, cache, assets, overall) {
  return assets.map(source => {
    if (!safeCache(root, source)) throw new Error('Protected asset escaped its cache');
    validateAssetLinks(source, join(root, '.work/builds'), { remaining: 100000, overall });
    const destination = join(runRoot, 'retained-cache-assets', relative(runRoot, cache), relative(cache, source));
    if (stat(destination)) throw new Error('Retained asset destination already exists; inspect the collision manually');
    // Check all existing parents before creating any destination directories.
    let parent = dirname(destination);
    while (inside(runRoot, parent)) {
      const value = stat(parent);
      if (value && (!value.isDirectory() || !safeCache(root, parent))) throw new Error('Retained asset ancestry must contain real directories');
      if (parent === runRoot) break;
      parent = dirname(parent);
    }
    return { source, destination };
  });
}
function validateAssetLinks(asset, buildsRoot, budget, directory = asset) {
  if (!lstatSync(directory).isDirectory()) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (--budget.remaining < 0) throw new Error('Asset link inspection limit reached; preserve its cache for manual inspection');
    if (budget.overall && --budget.overall.remaining < 0) throw new Error('Whole-plan inspection limit reached; narrow retention by variant and surface');
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const link = readlinkSync(path), target = resolve(dirname(path), link);
      // Internal relative links keep their meaning after a same-layout move.
      // Other snapshot caches may be pruned in this or a later cleanup pass.
      if ((!link.startsWith('/') && !inside(asset, target)) || (link.startsWith('/') && inside(buildsRoot, target))) throw new Error('Protected asset has a link that would break after relocation');
    } else if (entry.isDirectory()) validateAssetLinks(asset, buildsRoot, budget, path);
  }
}
function reconcileAssetMoves(root, runRoot, cache, manifest) {
  for (const record of manifest.cacheRetention?.retainedAssets || []) {
    const source = resolve(runRoot, record.original), destination = resolve(runRoot, record.retained);
    if (!inside(cache, source)) continue;
    const expected = join(runRoot, 'retained-cache-assets', relative(runRoot, source));
    if (destination !== expected) throw new Error('Retained asset provenance does not match its snapshot');
    const original = stat(source), retained = stat(destination);
    if (record.state === 'pending' && original && !retained) continue;
    if (original || !retained || !safeCache(root, destination)) throw new Error('Interrupted asset preservation needs manual inspection');
    record.state = 'retained';
  }
}
export function retainBuildCaches(options = {}) {
  const root = resolve(options.root || defaultRoot);
  if (!options.apply) return { ...planRetention({ ...options, root }), applied: false };
  return withRetentionLock(root, () => {
    // Re-plan under the same lock used to start/reuse a build.
    const plan = planRetention({ ...options, root }), removed = [], skipped = [], retained = [];
    // Inspect the WHOLE candidate plan before the first move/delete. A symbol
    // bundle can point at a later cache (or one ordered before its own cache).
    // Abort the whole pass on uncertainty so neither side of that link is lost.
    const prepared = new Map(), overall = { remaining: 5000000 };
    for (const candidate of plan.candidates) for (const path of candidate.paths) {
      if (!safeCache(root, path) || !lstatSync(path).isDirectory()) throw new Error('Cache path changed or is not a real directory');
      const manifest = json(join(candidate.runRoot, 'build-manifest.json'));
      reconcileAssetMoves(root, candidate.runRoot, path, manifest);
      const assets = protectedAssets(path, { remaining: path.endsWith('/native-dependencies') ? 500000 : 100000, overall }, /\/(?:gradle-cache|cocoapods-cache|native-dependencies)(?:\/|$)/.test(path));
      prepared.set(path, prepareAssetMoves(root, candidate.runRoot, path, assets, overall));
    }
    let attempted = 0;
    outer: for (const candidate of plan.candidates) for (const path of candidate.paths) {
      if (++attempted > (options.maxCaches ?? 40)) break outer;
      if (!safeCache(root, path)) throw new Error('Cache path changed or escaped the repository');
      const manifestPath = join(candidate.runRoot, 'build-manifest.json'), manifest = json(manifestPath);
      reconcileAssetMoves(root, candidate.runRoot, path, manifest);
      const moves = prepared.get(path);
      // Mark BEFORE removal so an interrupted prune can never be reused as complete.
      manifest.cacheRetention = { ...manifest.cacheRetention, policyVersion: 2, prunedAt: new Date().toISOString(), paths: [...new Set([...(manifest.cacheRetention?.paths || []), relative(candidate.runRoot, path)])], reusable: false };
      if (manifest.cacheRetention.skipped) delete manifest.cacheRetention.skipped[relative(candidate.runRoot, path)];
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
      for (const move of moves) {
        if (stat(move.destination) || !safeCache(root, move.source)) throw new Error('Protected asset path changed before preservation');
        mkdirSync(dirname(move.destination), { recursive: true });
        if (!safeCache(root, dirname(move.destination))) throw new Error('Retained asset destination escaped its snapshot');
        const record = { original: relative(candidate.runRoot, move.source), retained: relative(candidate.runRoot, move.destination), state: 'pending' };
        manifest.cacheRetention.retainedAssets ??= [];
        const previous = manifest.cacheRetention.retainedAssets.find(value => value.original === record.original && value.retained === record.retained);
        if (previous) Object.assign(previous, record);
        else manifest.cacheRetention.retainedAssets.push(record);
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
        // Same-volume rename preserves exact bytes, modes and bundle contents.
        renameSync(move.source, move.destination);
        record.state = 'retained';
        if (previous) previous.state = 'retained';
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
        retained.push(move);
      }
      rmSync(path, { recursive: true });
      removed.push(path);
    }
    return { ...plan, applied: true, removed, skipped, retained, inspectedEntries: 5000000 - overall.remaining };
  });
}
export function automaticRetention(root, variant, surface) {
  try {
    const result = retainBuildCaches({ root, variant, surface, apply: true, maxCaches: 40 });
    if (result.removed.length) console.log(`Retention: removed ${result.removed.length} obsolete cache directories; products and provenance retained.`);
  } catch (error) { console.warn(`Retention skipped: ${error.message}`); }
}

function main(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--cold') options.cold = true;
    else if (arg.startsWith('--variant=')) options.variant = arg.slice(10);
    else if (arg.startsWith('--surface=')) options.surface = arg.slice(10);
    else if (arg.startsWith('--pin=')) options.pin = resolve(arg.slice(6));
    else throw new Error('Usage: node scripts/build-retention.mjs [--apply] [--cold] [--variant=supabase-qa|supabase-production] [--surface=ios] [--pin=/absolute/run]');
  }
  if (options.pin) {
    const run = options.pin;
    if (!variants.some(variant => dirname(run) === join(defaultRoot, '.work/builds', variant)) || !safeCache(defaultRoot, run) || !existsSync(join(run, 'build-manifest.json'))) throw new Error('Pin requires an exact existing managed snapshot');
    withRetentionLock(defaultRoot, () => {
      const marker = join(run, '.retention-pin');
      if (stat(marker) && !stat(marker).isFile()) throw new Error('Pin marker must be a regular file');
      writeFileSync(marker, 'Operator pin: remove this marker manually to release.\n');
    });
    console.log(`Pinned ${run}`); return;
  }
  console.log(JSON.stringify(retainBuildCaches(options), null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
