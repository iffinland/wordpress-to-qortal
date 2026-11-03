import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BrokerError, BROKER_ERROR, fail } from './errors.js';
import { sha256Hex } from './util.js';

export const AUTH_SCHEMA = 'qms-broker-auth@1';
const SIGNING_PREFIX = 'qms-qdn-test-broker-v1';
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

export function canonicalRequest({ method, path, bodyBytes, timestamp, nonce }) {
  return [
    SIGNING_PREFIX,
    String(method).toUpperCase(),
    path,
    sha256Hex(bodyBytes),
    String(timestamp),
    String(nonce)
  ].join('\n');
}

function decodeSignature(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{40,200}$/.test(value)) {
    fail(BROKER_ERROR.AUTH_INVALID, 'The request signature is missing or malformed.');
  }
  return Buffer.from(value, 'base64url');
}

export function parseKeysConfig(document) {
  if (!document || typeof document !== 'object' || !Array.isArray(document.keys)) {
    fail(BROKER_ERROR.AUTH_INVALID, 'The client key configuration is invalid.');
  }
  const keys = new Map();
  for (const entry of document.keys) {
    if (!entry || typeof entry !== 'object') fail(BROKER_ERROR.AUTH_INVALID, 'A client key entry is invalid.');
    if (typeof entry.keyId !== 'string' || !KEY_ID.test(entry.keyId)) {
      fail(BROKER_ERROR.AUTH_INVALID, 'A client keyId is invalid.');
    }
    if (keys.has(entry.keyId)) fail(BROKER_ERROR.AUTH_INVALID, 'Duplicate client keyId: ' + entry.keyId);
    let publicKey;
    try {
      publicKey = createPublicKey(entry.publicKeyPem);
    } catch (error) {
      fail(BROKER_ERROR.AUTH_INVALID, 'Client key ' + entry.keyId + ' does not contain a valid public key.', {
        cause: error.message
      });
    }
    if (publicKey.asymmetricKeyType !== 'ed25519') {
      fail(BROKER_ERROR.AUTH_INVALID, 'Client key ' + entry.keyId + ' must be Ed25519.');
    }
    const issuedAt = Date.parse(entry.issuedAt);
    const expiresAt = Date.parse(entry.expiresAt);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
      fail(BROKER_ERROR.AUTH_INVALID, 'Client key ' + entry.keyId + ' has invalid issuedAt/expiresAt.');
    }
    keys.set(entry.keyId, {
      keyId: entry.keyId,
      publicKey,
      issuedAt,
      expiresAt,
      disabled: entry.disabled === true
    });
  }
  return keys;
}

export function loadKeysFile(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    fail(BROKER_ERROR.AUTH_INVALID, 'Unable to read the client key file.', { cause: error.message });
  }
  try {
    return parseKeysConfig(JSON.parse(raw));
  } catch (error) {
    if (error instanceof BrokerError) throw error;
    fail(BROKER_ERROR.AUTH_INVALID, 'The client key file is not valid JSON.');
  }
}

/**
 * In-memory replay cache. The request timestamp window bounds the lifetime of
 * an entry; a broker restart loses the cache but cannot extend that window.
 */
export function createNonceCache() {
  const entries = new Map();
  let lastSweep = 0;
  return {
    remember(keyId, nonce, expiresAt, now) {
      if (now - lastSweep > 30000) {
        for (const [key, expiry] of entries) if (expiry <= now) entries.delete(key);
        lastSweep = now;
      }
      const key = keyId + '|' + nonce;
      const existing = entries.get(key);
      if (existing && existing > now) return false;
      entries.set(key, expiresAt);
      return true;
    },
    size() {
      return entries.size;
    },
    clear() {
      entries.clear();
    }
  };
}

/**
 * Verify an authenticated broker request. Every check is fail-closed; the
 * caller must not process the request when this throws.
 */
export function authenticateRequest({
  method,
  path,
  bodyBytes,
  headers,
  keys,
  revokedKeys = new Set(),
  nonceCache,
  now = Date.now(),
  clockSkewMs = 120000,
  nonceTtlMs = 600000,
  sessionLifetimeMs = 3600000
}) {
  const keyId = headers['x-qms-key-id'];
  const timestampRaw = headers['x-qms-timestamp'];
  const nonce = headers['x-qms-nonce'];
  const signature = headers['x-qms-signature'];

  if (!keyId || !timestampRaw || !nonce || !signature) {
    fail(BROKER_ERROR.AUTH_REQUIRED, 'Authenticated broker headers are required.');
  }
  if (typeof keyId !== 'string' || !KEY_ID.test(keyId)) {
    fail(BROKER_ERROR.AUTH_INVALID, 'The client key id is malformed.');
  }
  const key = keys.get(keyId);
  if (!key) fail(BROKER_ERROR.AUTH_KEY_UNKNOWN, 'Unknown client key.');
  if (key.disabled || revokedKeys.has(keyId)) {
    fail(BROKER_ERROR.AUTH_KEY_REVOKED, 'The client key is revoked or disabled.');
  }
  if (!Number.isInteger(Number(timestampRaw)) || !/^[0-9]{13}$/.test(String(timestampRaw))) {
    fail(BROKER_ERROR.AUTH_INVALID, 'The request timestamp is malformed.');
  }
  const timestamp = Number(timestampRaw);
  const age = now - timestamp;
  if (age > clockSkewMs || age < -clockSkewMs) {
    fail(BROKER_ERROR.AUTH_EXPIRED, 'The request timestamp is outside the allowed clock window.');
  }
  if (typeof nonce !== 'string' || !NONCE.test(nonce)) {
    fail(BROKER_ERROR.AUTH_INVALID, 'The request nonce is malformed.');
  }
  if (now < key.issuedAt - clockSkewMs) {
    fail(BROKER_ERROR.AUTH_INVALID, 'The client key is not active yet.');
  }
  if (now > key.expiresAt) {
    fail(BROKER_ERROR.AUTH_EXPIRED, 'The client key has expired.');
  }
  if (now - key.issuedAt > sessionLifetimeMs) {
    fail(BROKER_ERROR.AUTH_EXPIRED, 'The authorization session lifetime has been exceeded.');
  }
  if (!nonceCache.remember(keyId, nonce, now + nonceTtlMs, now)) {
    fail(BROKER_ERROR.AUTH_REPLAY, 'The request nonce has already been used.');
  }
  const canonical = canonicalRequest({ method, path, bodyBytes, timestamp, nonce });
  let valid = false;
  try {
    valid = cryptoVerify(null, Buffer.from(canonical, 'utf8'), key.publicKey, decodeSignature(signature));
  } catch {
    valid = false;
  }
  if (!valid) {
    fail(BROKER_ERROR.AUTH_INVALID, 'The request signature is invalid.');
  }
  return { keyId, timestamp, nonce, expiresAt: Math.min(key.expiresAt, key.issuedAt + sessionLifetimeMs) };
}

export function signRequest({ method, path, bodyBytes, keyId, privateKey, timestamp = Date.now(), nonce }) {
  const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey;
  const canonical = canonicalRequest({ method, path, bodyBytes, timestamp, nonce });
  const signature = cryptoSign(null, Buffer.from(canonical, 'utf8'), key).toString('base64url');
  return {
    'x-qms-key-id': keyId,
    'x-qms-timestamp': String(timestamp),
    'x-qms-nonce': nonce,
    'x-qms-signature': signature
  };
}
