#!/usr/bin/env node
// Apple client-secret claims: https://developer.apple.com/documentation/signinwithapplerestapi/creating-a-client-secret
// Supabase configuration: https://supabase.com/docs/guides/auth/social-login/auth-apple
import { createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto';
import { openSync, readFileSync, writeFileSync, fsyncSync, fchmodSync, closeSync, linkSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const MAX_TTL_DAYS = 180;
const audience = 'https://appleid.apple.com';
const usage = `Usage: node scripts/generate-apple-client-secret.mjs
  --team <10-character Team ID> --key-id <10-character Key ID>
  --service-id <Services ID> --key-path <private .p8 path> --output <new JWT file>
  [--ttl-days <1..180, default 180>] [--metadata-output <new JSON file>]
Files are created exclusively with mode 0600. Existing files are never overwritten.
Only non-secret metadata is printed; no token or private key is printed.`;

function validate({ team, keyId, serviceId, keyPath, output, metadataOutput, ttlDays = MAX_TTL_DAYS }, now) {
  if (!/^[A-Z0-9]{10}$/.test(team ?? '')) throw new Error('Team ID must contain 10 uppercase letters or digits.');
  if (!/^[A-Z0-9]{10}$/.test(keyId ?? '')) throw new Error('Key ID must contain 10 uppercase letters or digits.');
  if (!/^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+$/.test(serviceId ?? '')) throw new Error('A valid Services ID is required.');
  if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > MAX_TTL_DAYS) throw new Error('TTL must be an integer from 1 through 180 days.');
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + ttlDays * 86400)) throw new Error('Invalid issuance time.');
  if (typeof keyPath !== 'string' || !keyPath || typeof output !== 'string' || !output) throw new Error('Explicit key and output file paths are required.');
  if (metadataOutput !== undefined && (typeof metadataOutput !== 'string' || !metadataOutput)) throw new Error('Metadata output must be an explicit file path.');
  const paths = [keyPath, output, ...(metadataOutput === undefined ? [] : [metadataOutput])].map((p) => resolve(p));
  if (new Set(paths).size !== paths.length) throw new Error('Key, JWT and metadata paths must be different.');
  return { team, keyId, serviceId, ttlDays, keyPath: paths[0], output: paths[1], metadataOutput: paths[2] };
}

// A private same-directory temporary inode is linked exclusively into its destination.
// This makes the final file complete, prevents overwriting/symlink following, and preserves 0600.
function writePrivateFile(path, content) {
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(12).toString('hex')}.tmp`);
  let fd;
  let created = false;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    created = true;
    fchmodSync(fd, 0o600);
    writeFileSync(fd, content, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    linkSync(temporary, path);
  } catch {
    throw new Error('Cannot create output file securely; use a new path in an existing writable directory.');
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (created) unlinkSync(temporary);
  }
}

/** Reads a local key, verifies the generated JWT, writes protected files, returns metadata only. */
export function generateAppleClientSecret(options, now = Math.floor(Date.now() / 1000)) {
  const config = validate(options, now);
  let privateKey;
  try {
    privateKey = createPrivateKey(readFileSync(config.keyPath));
  } catch {
    throw new Error('Cannot load an unencrypted private signing key from the key file.');
  }
  if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('Apple ES256 requires an EC P-256 private key.');
  }
  const header = { alg: 'ES256', kid: config.keyId, typ: 'JWT' };
  const claims = { iss: config.team, iat: now, exp: now + config.ttlDays * 86400, aud: audience, sub: config.serviceId };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode(header)}.${encode(claims)}`;
  // JWT uses a 64-byte IEEE-P1363 r||s signature, not ASN.1 DER.
  const signature = sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  if (signature.length !== 64 || !verify('sha256', Buffer.from(signingInput), {
    key: createPublicKey(privateKey), dsaEncoding: 'ieee-p1363',
  }, signature)) throw new Error('Generated signature failed local verification.');
  const metadata = {
    algorithm: header.alg, teamId: claims.iss, keyId: header.kid, serviceId: claims.sub, audience: claims.aud,
    issuedAt: new Date(claims.iat * 1000).toISOString(), expiresAt: new Date(claims.exp * 1000).toISOString(),
    lifetimeSeconds: claims.exp - claims.iat, signatureVerified: true, outputFile: config.output,
  };
  writePrivateFile(config.output, `${signingInput}.${signature.toString('base64url')}\n`);
  if (config.metadataOutput) writePrivateFile(config.metadataOutput, `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

export function run(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, strict: true, allowPositionals: false, tokens: true, options: {
      team: { type: 'string' }, 'key-id': { type: 'string' }, 'service-id': { type: 'string' },
      'key-path': { type: 'string' }, output: { type: 'string' }, 'metadata-output': { type: 'string' },
      'ttl-days': { type: 'string' }, help: { type: 'boolean' },
    } });
  } catch { throw new Error('Invalid command-line options; use --help.'); }
  const seen = new Set();
  for (const token of parsed.tokens) {
    if (token.kind === 'option') {
      if (seen.has(token.name)) throw new Error('Duplicate command-line options are not allowed.');
      seen.add(token.name);
    }
  }
  if (parsed.values.help) { console.log(usage); return; }
  const v = parsed.values;
  if (['team', 'key-id', 'service-id', 'key-path', 'output'].some((name) => !v[name])) throw new Error('Required options are missing; use --help.');
  if (v['ttl-days'] !== undefined && !/^\d+$/.test(v['ttl-days'])) throw new Error('TTL must be an integer from 1 through 180 days.');
  const metadata = generateAppleClientSecret({
    team: v.team, keyId: v['key-id'], serviceId: v['service-id'], keyPath: v['key-path'], output: v.output,
    metadataOutput: v['metadata-output'], ttlDays: v['ttl-days'] === undefined ? MAX_TTL_DAYS : Number(v['ttl-days']),
  });
  console.log(JSON.stringify(metadata, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { run(); } catch (error) { console.error(`Apple client-secret generation failed: ${error.message}`); process.exitCode = 1; }
}
