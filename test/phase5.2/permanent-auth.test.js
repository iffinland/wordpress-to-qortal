import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defaultConfig, validateConfig } from '../../broker/src/config.js';

const BROKER_SRC = new URL('../../broker/src/', import.meta.url).pathname;

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('no access-grant, refresh or fixed authorization-lifetime code paths remain', () => {
  assert.equal(existsSync(join(BROKER_SRC, 'grants.js')), false);
  const forbidden = [
    /\/v1\/auth\/refresh/,
    /accessTtlMs/,
    /maxAuthorizationLifetimeMs/,
    /maxGrantsPerKey/,
    /validateAccessGrant/,
    /issueAccessGrant/,
    /authorizeKeySession/,
    /AUTH_GRANT_/,
    /qmsa_/,
    /\b604800000\b/,
    /\b900000\b/
  ];
  const violations = [];
  for (const file of sourceFiles(BROKER_SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      if (pattern.test(text)) violations.push(file + ' matches ' + pattern);
    }
    // state.js may mention accessGrants only to drop it during migration.
    if (!file.endsWith('/state.js') && /accessGrants/.test(text)) {
      violations.push(file + ' matches /accessGrants/');
    }
  }
  assert.deepEqual(violations, []);
});

test('rejects nonce retention shorter than twice the timestamp window', () => {
  const config = defaultConfig();
  config.signing.externalAuth.walletId = 'test-wallet';
  assert.doesNotThrow(() => validateConfig(config));
  config.auth.nonceTtlMs = config.auth.clockSkewMs;
  assert.throws(() => validateConfig(config), (error) => error.code === 'INVALID_REQUEST');
});

test('the client has no refresh or grant state and signs each request', () => {
  const client = readFileSync(join(BROKER_SRC, 'client.js'), 'utf8');
  assert.match(client, /signRequest/);
  assert.equal(/refreshAccess|ensureAccess|accessToken|Bearer/.test(client), false);
});
