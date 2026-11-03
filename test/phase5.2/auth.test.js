import test from 'node:test';
import assert from 'node:assert/strict';
import { createNonceCache, authenticateRequest, signRequest, authorizeKeySession } from '../../broker/src/auth.js';
import { issueAccessGrant } from '../../broker/src/grants.js';
import { createClientKey } from './support/harness.js';

const NOW = Date.parse('2026-11-03T10:00:00.000Z');
let nonceCounter = 0;

function grantFor(key, { now = NOW, ttlMs = 900000 } = {}) {
  const draft = { accessGrants: {} };
  const issued = issueAccessGrant({ draft, keyId: key.keyId, now, ttlMs, maxGrantsPerKey: 8 });
  return { accessToken: issued.token, grants: draft.accessGrants };
}

function baseArgs(key, overrides = {}) {
  const bodyBytes = overrides.bodyBytes ?? Buffer.from('{"hello":"world"}', 'utf8');
  const method = overrides.method ?? 'POST';
  const path = overrides.path ?? '/v1/publications';
  const timestamp = overrides.timestamp ?? NOW;
  const nonce = overrides.nonce ?? 'nonce-' + String(++nonceCounter).padStart(22, '0');
  const headers = signRequest({
    method,
    path,
    bodyBytes,
    keyId: key.keyId,
    privateKey: key.privateKey,
    timestamp,
    nonce
  });
  const grant = overrides.grant ?? grantFor(key, { now: overrides.grantIssuedAt ?? NOW, ttlMs: overrides.grantTtlMs ?? 900000 });
  return {
    method,
    path,
    bodyBytes,
    headers: { ...headers, ...(overrides.headers ?? {}) },
    keys: overrides.keys ?? key.keys,
    revokedKeys: overrides.revokedKeys ?? new Set(),
    nonceCache: overrides.nonceCache ?? createNonceCache(),
    now: overrides.now ?? NOW,
    clockSkewMs: overrides.clockSkewMs ?? 120000,
    nonceTtlMs: overrides.nonceTtlMs ?? 600000,
    accessToken: overrides.accessToken !== undefined ? overrides.accessToken : grant.accessToken,
    grants: grant.grants,
    requireGrant: overrides.requireGrant ?? true
  };
}

function expectCode(args, code) {
  assert.throws(() => authenticateRequest(args), (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

test('accepts a correctly signed request with an access grant', () => {
  const key = createClientKey({ issuedAt: NOW - 1000, expiresAt: NOW + 3600000 });
  const auth = authenticateRequest(baseArgs(key));
  assert.equal(auth.keyId, key.keyId);
  assert.equal(auth.timestamp, NOW);
  assert.equal(typeof auth.grantHash, 'string');
});

test('rejects missing authentication headers', () => {
  const key = createClientKey({ issuedAt: NOW - 1000, expiresAt: NOW + 3600000 });
  expectCode(baseArgs(key, { headers: { 'x-qms-signature': undefined } }), 'AUTH_REQUIRED');
});

test('rejects unknown keys', () => {
  const key = createClientKey({ keyId: 'unknown-key', issuedAt: NOW - 1000, expiresAt: NOW + 3600000 });
  expectCode(baseArgs(key, { keys: new Map() }), 'AUTH_KEY_UNKNOWN');
});

test('rejects revoked keys', () => {
  const key = createClientKey({ issuedAt: NOW - 1000, expiresAt: NOW + 3600000 });
  expectCode(baseArgs(key, { revokedKeys: new Set([key.keyId]) }), 'AUTH_KEY_REVOKED');
});

test('rejects expired keys', () => {
  const expired = createClientKey({ keyId: 'expired-key', issuedAt: NOW - 7200000, expiresAt: NOW - 1000 });
  expectCode(baseArgs(expired), 'AUTH_EXPIRED');
});

test('requires a grant and rejects missing, malformed, expired and wrong-key grants', () => {
  const key = createClientKey({ issuedAt: NOW - 1000, expiresAt: NOW + 3600000 });
  expectCode(baseArgs(key, { accessToken: null }), 'AUTH_GRANT_REQUIRED');
  expectCode(baseArgs(key, { accessToken: 'not-a-grant' }), 'AUTH_GRANT_INVALID');

  const expired = grantFor(key, { now: NOW - 3600000, ttlMs: 60000 });
  expectCode(baseArgs(key, { grant: expired }), 'AUTH_GRANT_EXPIRED');

  const other = createClientKey({ keyId: 'other-key', issuedAt: NOW - 1000, expiresAt: NOW + 3600000 });
  const foreign = grantFor(other);
  expectCode(baseArgs(key, { grant: foreign }), 'AUTH_GRANT_INVALID');
});

test('allows refresh authentication without an access grant', () => {
  const key = createClientKey({ issuedAt: NOW - 1000, expiresAt: NOW + 3600000 });
  const auth = authenticateRequest(baseArgs(key, { requireGrant: false }));
  assert.equal(auth.grantHash, null);
});

test('authorizeKeySession enforces the registered key and maximum renewable lifetime', () => {
  const key = createClientKey({ issuedAt: NOW - 7200000, expiresAt: NOW + 3600000 });
  const session = authorizeKeySession({
    keys: key.keys, keyId: key.keyId, now: NOW, maxAuthorizationLifetimeMs: 86400000
  });
  assert.equal(session.keyId, key.keyId);

  assert.throws(() => authorizeKeySession({
    keys: key.keys, keyId: key.keyId, now: NOW, maxAuthorizationLifetimeMs: 3600000
  }), (error) => error.code === 'AUTH_EXPIRED');

  const revoked = createClientKey({ keyId: 'revoked-refresh', issuedAt: NOW - 1000, expiresAt: NOW + 3600000 });
  assert.throws(() => authorizeKeySession({
    keys: revoked.keys, keyId: revoked.keyId, revokedKeys: new Set([revoked.keyId]), now: NOW
  }), (error) => error.code === 'AUTH_KEY_REVOKED');
});

test('rejects stale and future timestamps outside the clock window', () => {
  const key = createClientKey({ issuedAt: NOW - 1000, expiresAt: NOW + 3600000 });
  expectCode(baseArgs(key, { timestamp: NOW - 300000 }), 'AUTH_EXPIRED');
  expectCode(baseArgs(key, { timestamp: NOW + 300000 }), 'AUTH_EXPIRED');
});

test('rejects replayed nonces', () => {
  const key = createClientKey({ issuedAt: NOW - 1000, expiresAt: NOW + 3600000 });
  const cache = createNonceCache();
  const nonce = 'nonce-replay-000000001';
  authenticateRequest(baseArgs(key, { nonce, nonceCache: cache }));
  expectCode(baseArgs(key, { nonce, nonceCache: cache }), 'AUTH_REPLAY');
});

test('rejects a body modified after signing', () => {
  const key = createClientKey({ issuedAt: NOW - 1000, expiresAt: NOW + 3600000 });
  const args = baseArgs(key);
  args.bodyBytes = Buffer.from('{"hello":"tampered"}', 'utf8');
  expectCode(args, 'AUTH_INVALID');
});

test('rejects wrong method, path, signature and malformed nonce', () => {
  const key = createClientKey({ issuedAt: NOW - 1000, expiresAt: NOW + 3600000 });
  const wrongMethod = baseArgs(key);
  wrongMethod.method = 'GET';
  expectCode(wrongMethod, 'AUTH_INVALID');
  const wrongPath = baseArgs(key);
  wrongPath.path = '/v1/publications/other';
  expectCode(wrongPath, 'AUTH_INVALID');
  expectCode(baseArgs(key, { headers: { 'x-qms-signature': 'A'.repeat(88) } }), 'AUTH_INVALID');
  const malformed = baseArgs(key);
  malformed.headers['x-qms-nonce'] = 'short';
  expectCode(malformed, 'AUTH_INVALID');
});
