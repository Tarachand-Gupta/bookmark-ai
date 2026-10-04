import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, statSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateAppleClientSecret } from './generate-apple-client-secret.mjs';

function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'bmai-apple-secret-'));
  try {
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const keyPath = join(dir, 'test.p8');
    writeFileSync(keyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fn({ dir, keys, options: { team: 'ABCDE12345', keyId: '12345ABCDE', serviceId: 'ai.bookmarkai.test', keyPath, output: join(dir, 'secret.jwt') } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('JWT has Apple claims, P1363 signature independently verifies, files are 0600 and metadata has no secret', () => fixture(({ dir, keys, options }) => {
  const metadataOutput = join(dir, 'metadata.json');
  const result = generateAppleClientSecret({ ...options, metadataOutput }, 1791110000);
  const jwt = readFileSync(options.output, 'utf8').trim();
  const [h, p, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: options.keyId, typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url')), {
    iss: options.team, iat: 1791110000, exp: 1791110000 + 180 * 86400, aud: 'https://appleid.apple.com', sub: options.serviceId,
  });
  assert.equal(Buffer.from(s, 'base64url').length, 64);
  assert.equal(verify('sha256', Buffer.from(`${h}.${p}`), { key: keys.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), true);
  assert.equal(verify('sha256', Buffer.from(`${h}.${p}tampered`), { key: keys.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), false);
  assert.equal(statSync(options.output).mode & 0o777, 0o600);
  assert.equal(statSync(metadataOutput).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(metadataOutput, 'utf8')), result);
  assert.equal(JSON.stringify(result).includes(jwt), false);
  assert.equal(result.lifetimeSeconds, 15552000);
}));

test('lifetime bounds reject 0,181 and fractions; a 1-day override works', () => fixture(({ options }) => {
  for (const ttlDays of [0, -1, 181, 1.5, NaN, Infinity, '180']) assert.throws(() => generateAppleClientSecret({ ...options, ttlDays }), /TTL/);
  assert.equal(generateAppleClientSecret({ ...options, ttlDays: 1 }).lifetimeSeconds, 86400);
}));

test('wrong curve, malformed key, RSA key and public-only key are rejected', () => fixture(({ options }) => {
  for (const pem of [
    'invalid key',
    generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
    generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
    generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'pem' }),
  ]) {
    writeFileSync(options.keyPath, pem);
    assert.throws(() => generateAppleClientSecret(options), /private|P-256/);
  }
}));

test('existing files and symlink destinations cannot be replaced, including the signing key', () => fixture(({ dir, options }) => {
  const original = readFileSync(options.keyPath);
  assert.throws(() => generateAppleClientSecret({ ...options, output: options.keyPath }), /different/);
  symlinkSync(options.keyPath, options.output);
  assert.throws(() => generateAppleClientSecret(options), /new path/);
  assert.deepEqual(readFileSync(options.keyPath), original);
  const existing = join(dir, 'existing.jwt');
  writeFileSync(existing, 'preserved');
  assert.throws(() => generateAppleClientSecret({ ...options, output: existing }), /new path/);
  assert.equal(readFileSync(existing, 'utf8'), 'preserved');
}));

test('CLI requires explicit flags and rejects unknown/duplicate/lifetime options', () => fixture(({ options }) => {
  const args = ['--team', options.team, '--key-id', options.keyId, '--service-id', options.serviceId, '--key-path', options.keyPath, '--output', options.output];
  for (const argv of [[], [...args, '--ttl-days', '181'], [...args, '--ttl-days', '1e2'], [...args, '--team', options.team], [...args, '--unknown']]) {
    const proc = spawnSync(process.execPath, ['scripts/generate-apple-client-secret.mjs', ...argv], { encoding: 'utf8' });
    assert.equal(proc.status, 1);
    assert.equal(proc.stdout, '');
    assert.equal(proc.stderr.includes('BEGIN PRIVATE KEY'), false);
  }
}));

test('CLI success prints metadata only; token is exclusively in output', () => fixture(({ options }) => {
  const proc = spawnSync(process.execPath, ['scripts/generate-apple-client-secret.mjs', '--team', options.team, '--key-id', options.keyId, '--service-id', options.serviceId, '--key-path', options.keyPath, '--output', options.output], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  const jwt = readFileSync(options.output, 'utf8').trim();
  assert.equal(proc.stdout.includes(jwt), false);
  assert.equal(proc.stderr, '');
  assert.equal(JSON.parse(proc.stdout).signatureVerified, true);
}));
