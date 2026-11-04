import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNonceCache,
  authenticateRequest,
  signRequest,
  parseKeysConfig,
  KEYS_SCHEMA
} from '../../broker/src/auth.js';
import { createClientKey, createLegacyClientKey } from './support/harness.js';
import { generateKeyPairSync } from 'node:crypto';

const NOW = Date.parse('2026-11-03T10:00:00.000Z');
const YEAR = 365 * 86400000;
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
    keyId: overrides.signingKeyId ?? key.keyId,
    privateKey: overrides.signingKey ?? key.privateKey,
    timestamp,
    nonce
  });
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
    nonceTtlMs: overrides.nonceTtlMs ?? 600000
  };
}

function expectCode(args, code) {
  assert.throws(() => authenticateRequest(args), (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

test('a persistent key authenticates repeatedly with no expiry or refresh', () => {
  const key = createClientKey({ createdAt: NOW - 1000 });
  const cache = createNonceCache();
  for (const offset of [0, 900000, 7 * 86400000, YEAR]) {
    const args = baseArgs(key, { now: NOW + offset, timestamp: NOW + offset, nonceCache: cache });
    const auth = authenticateRequest(args);
    assert.equal(auth.keyId, key.keyId);
    assert.equal(auth.timestamp, NOW + offset);
    assert.equal(Object.hasOwn(auth, 'grantHash'), false);
  }
});

test('legacy issuedAt/expiresAt entries are accepted but expiry is ignored', () => {
  const legacy = createLegacyClientKey({
    createdAt: NOW - 7200000,
    issuedAt: NOW - 7200000,
    expiresAt: NOW - 1000
  });
  const entry = legacy.keys.get(legacy.keyId);
  assert.equal(entry.legacy, true);
  assert.equal(Object.hasOwn(entry, 'expiresAt'), false);
  const auth = authenticateRequest(baseArgs(legacy, { now: NOW + YEAR, timestamp: NOW + YEAR }));
  assert.equal(auth.keyId, legacy.keyId);
});

test('the persistent key registry requires createdAt and Ed25519 keys', () => {
  const { publicKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  assert.throws(() => parseKeysConfig({
    schema: KEYS_SCHEMA,
    keys: [{ keyId: 'agent-key', publicKeyPem: pem }]
  }), (error) => error.code === 'AUTH_INVALID');
  assert.throws(() => parseKeysConfig({
    schema: 'qms-broker-client-keys@99',
    keys: [{ keyId: 'agent-key', publicKeyPem: pem, createdAt: new Date(NOW).toISOString() }]
  }), (error) => error.code === 'AUTH_INVALID');
  const { publicKey: rsa } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => parseKeysConfig({
    schema: KEYS_SCHEMA,
    keys: [{
      keyId: 'agent-key',
      publicKeyPem: rsa.export({ type: 'spki', format: 'pem' }),
      createdAt: new Date(NOW).toISOString()
    }]
  }), (error) => error.code === 'AUTH_INVALID');
  assert.throws(() => parseKeysConfig({
    schema: KEYS_SCHEMA,
    keys: [
      { keyId: 'agent-key', publicKeyPem: pem, createdAt: new Date(NOW).toISOString() },
      { keyId: 'agent-copy', publicKeyPem: pem, createdAt: new Date(NOW).toISOString() }
    ]
  }), (error) => error.code === 'AUTH_INVALID');
});

test('rejects missing authentication headers', () => {
  const key = createClientKey({ createdAt: NOW - 1000 });
  expectCode(baseArgs(key, { headers: { 'x-qms-signature': undefined } }), 'AUTH_REQUIRED');
});

test('rejects unknown, revoked and disabled keys', () => {
  const key = createClientKey({ createdAt: NOW - 1000 });
  expectCode(baseArgs(key, { keys: new Map() }), 'AUTH_KEY_UNKNOWN');
  expectCode(baseArgs(key, { revokedKeys: new Set([key.keyId]) }), 'AUTH_KEY_REVOKED');
  const disabled = createClientKey({ keyId: 'disabled-key', createdAt: NOW - 1000, enabled: false });
  expectCode(baseArgs(disabled), 'AUTH_KEY_REVOKED');
});

test('rejects stale and future timestamps outside the clock window', () => {
  const key = createClientKey({ createdAt: NOW - 1000 });
  expectCode(baseArgs(key, { timestamp: NOW - 300000 }), 'AUTH_EXPIRED');
  expectCode(baseArgs(key, { timestamp: NOW + 300000 }), 'AUTH_EXPIRED');
});

test('rejects replayed nonces', () => {
  const key = createClientKey({ createdAt: NOW - 1000 });
  const cache = createNonceCache();
  const nonce = 'nonce-replay-000000001';
  authenticateRequest(baseArgs(key, { nonce, nonceCache: cache }));
  expectCode(baseArgs(key, { nonce, nonceCache: cache }), 'AUTH_REPLAY');
});

test('rejects a body modified after signing', () => {
  const key = createClientKey({ createdAt: NOW - 1000 });
  const args = baseArgs(key);
  args.bodyBytes = Buffer.from('{"hello":"tampered"}', 'utf8');
  expectCode(args, 'AUTH_INVALID');
});

test('rejects wrong method, path, signature, nonce and signing key', () => {
  const key = createClientKey({ createdAt: NOW - 1000 });
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
  const wrongKey = createClientKey({ keyId: 'wrong-key', createdAt: NOW - 1000 });
  expectCode(baseArgs(key, { signingKey: wrongKey.privateKey }), 'AUTH_INVALID');
});
