#!/usr/bin/env node
/** AMO reviewer source archive from the exact frozen Firefox package inputs. */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { repoRoot, parseEnv } from './supabase-qa.mjs';
const release = join(repoRoot, 'dist/production');
const entry = JSON.parse(readFileSync(join(release, 'ARTIFACTS.json'), 'utf8')).firefox;
if (entry.variant !== 'supabase-production') throw new Error('Verified frozen production Firefox package required');
const frozen = JSON.parse(readFileSync(entry.buildManifest, 'utf8'));
const source = frozen.stagedRoot;
const version = JSON.parse(readFileSync(join(source, 'apps/extension/package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version) || entry.manifest?.version !== version) throw new Error('Frozen Firefox source and package versions must match');
const publicEnvironment = parseEnv(readFileSync(join(repoRoot, '.env.supabase.production.local'), 'utf8'));
const keys = ['BOOKMARK_HOSTED_TARGET', 'BOOKMARK_QA_WEB_URL', 'BOOKMARK_QA_LIVE_URL', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_PRODUCTION_EXTENSION_FIREFOX_CLIENT_ID'];
const publicConfig = keys.map(key => {
  const value = publicEnvironment[key];
  if (!value || /[\r\n]/.test(value)) throw new Error('Missing public Firefox build configuration');
  return `${key}=${value}`;
}).join('\n') + '\n';
const staging = mkdtempSync(join(tmpdir(), 'bookmark-ai-amo-sources-'));
function collect(root, prefix = '') {
  const files = [];
  for (const item of readdirSync(root, { withFileTypes: true })) {
    if (/^(node_modules|\.env.*|\.keys|\.output.*|\.wxt|DerivedData.*|build.*|ios|android|\.git)$/.test(item.name) || /\.pem$|\.xcodeproj$/.test(item.name)) continue;
    const path = join(prefix, item.name);
    if (item.isDirectory()) files.push(...collect(join(root, item.name), path));
    else if (item.isFile()) files.push(path);
  }
  return files;
}
try {
  const files = [
    ...collect(join(source, 'apps/extension')).map(path => join('apps/extension', path)),
    ...collect(join(source, 'packages')).map(path => join('packages', path)),
    ...['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.base.json', 'turbo.json', 'scripts/supabase-qa.mjs', 'scripts/supabase-production.mjs', 'scripts/build-retention.mjs'].filter(path => existsSync(join(source, path))),
  ];
  for (const path of files) {
    mkdirSync(dirname(join(staging, path)), { recursive: true });
    copyFileSync(join(source, path), join(staging, path));
  }
  writeFileSync(join(staging, 'BUILD_PUBLIC.env'), publicConfig);
  writeFileSync(join(staging, '.gitignore'), 'node_modules/\n.work/\ndist/\n.output/\n.wxt/\n.env*\n');
  writeFileSync(join(staging, 'EXPECTED_FIREFOX_HASHES.json'), JSON.stringify(entry.fileHashes, null, 2) + '\n');
  writeFileSync(join(staging, 'BUILD.md'), `# Bookmark AI Firefox ${version} — Supabase production\n\nNode >=22 (release build used ${process.version}); pnpm 10.34.1; Git. No backend credentials or private signing key are needed. BUILD_PUBLIC.env contains only URLs, a publishable Supabase key and a public PKCE client ID.\n\nFrom this extracted archive root:\n\n\`\`\`sh\ncp BUILD_PUBLIC.env .env.supabase.production.local\ngit init -q\ngit add .\ngit -c user.name=AMO-review -c user.email=review@example.invalid commit -qm snapshot\ncorepack pnpm --filter @bookmark-ai/extension... install --frozen-lockfile\nnode scripts/supabase-production.mjs firefox bundle\n\`\`\`\n\nOutput: apps/extension/.output/firefox-mv2 and dist/production/firefox. Compare every relative output file SHA256 with EXPECTED_FIREFOX_HASHES.json. The wrapper freezes sources/dependencies and pins WXT production mode, Supabase provider, canonical URLs, original Firefox GUID and production session namespace. It does not deploy or sign in. Minification is WXT/Vite/Rollup/esbuild; the lockfile pins exact registry dependencies. Clerk code remains in shared legacy branches but Supabase production selects the PKCE path.\n\nThe uploaded Firefox ZIP is dist/production/firefox.zip. Frozen source hash: ${entry.sourceHash}; release Git baseline: ${entry.gitSha}. Any platform-dependent byte difference must be reported rather than claiming identical output.\n`);
  const archive = join(release, 'firefox-sources.zip');
  rmSync(archive, { force: true });
  const zip = spawnSync('zip', ['-q', '-X', '-r', archive, '.'], { cwd: staging });
  if (zip.status !== 0) throw new Error('Source archive failed');
  const manifestPath = join(release, 'ARTIFACTS.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.firefox.sourceArchive = { path: archive, sha256: createHash('sha256').update(readFileSync(archive)).digest('hex'), sourceHash: entry.sourceHash, publicConfigurationOnly: true };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`AMO source: ${relative(repoRoot, archive)}; public configuration only; frozen production source ${entry.sourceHash}`);
} finally { rmSync(staging, { recursive: true, force: true }); }
