import test from 'node:test';
import assert from 'node:assert/strict';
import { createNonceCache, authenticateRequest, signRequest } from '../../broker/src/auth.js';
import { createClientKey } from './support/harness.js';

const NOW = Date.parse('2026-11-03T10:00:00.000Z');
let nonceCounter = 0;

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
  return {
    method,
    path,
    bodyBytes,
    headers: { ...headers, ...(overrides.headers ?? {}) },
    keys: key.keys,
    revokedKeys: overrides.revokedKeys ?? new Set(),
    nonceCache: overrides.nonceCache ?? createNonceCache(),
    now: overrides.now ?? NOW,
    clockSkewMs: overrides.clockSkewMs ?? 120000,
    nonceTtlMs: overrides.nonceTtlMs ?? 600000,
    sessionLifetimeMs: overrides.sessionLifetimeMs ?? 3600000
  };
}

function expectCode(args, code) {
  assert.throws(() => authenticateRequest(args), (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

test('accepts a correctly signed request', () => {
  const key = createClientKey({ issuedAt: NOW - 1000, expiresAt: NOW + 3600000 });
  const auth = authenticateRequest(baseArgs(key));
  assert.equal(auth.keyId, key.keyId);
  assert.equal(auth.timestamp, NOW);
});

test('rejects missing authentication headers', () => {
  const key = createClientKey({ issuedAt: NOW - 1000, expiresAt: NOW + 3600000 });
  expectCode(baseArgs(key, { headers: { 'x-qms-signature': undefined } }), 'AUTH_REQUIRED');
});

test('rejects unknown keys', () => {
  const key = createClientKey({ keyId: 'unknown-key', issuedAt: NOW - 1000, expiresAt: NOW + 3600000 });
  const args = baseArgs(key);
  args.keys = new Map();
  expectCode(args, 'AUTH_KEY_UNKNOWN');
});

test('rejects revoked keys', () => {
  const key = createClientKey({ issuedAt: NOW - 1000, expiresAt: NOW + 3600000 });
  expectCode(baseArgs(key, { revokedKeys: new Set([key.keyId]) }), 'AUTH_KEY_REVOKED');
});

test('rejects expired keys and expired authorization sessions', () => {
  const expired = createClientKey({ keyId: 'expired-key', issuedAt: NOW - 7200000, expiresAt: NOW - 1000 });
  expectCode(baseArgs(expired), 'AUTH_EXPIRED');

  const longSession = createClientKey({ keyId: 'long-session', issuedAt: NOW - 7200000, expiresAt: NOW + 3600000 });
  expectCode(baseArgs(longSession, { sessionLifetimeMs: 3600000 }), 'AUTH_EXPIRED');
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
