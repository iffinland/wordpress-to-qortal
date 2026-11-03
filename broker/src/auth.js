import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BrokerError, BROKER_ERROR, fail } from './errors.js';
import { sha256Hex } from './util.js';

export const AUTH_SCHEMA = 'qms-broker-auth@1';
export const KEYS_SCHEMA = 'qms-broker-client-keys@2';
export const LEGACY_KEYS_SCHEMA = 'qms-broker-client-keys@1';
const SIGNING_PREFIX = 'qms-qdn-test-broker-v1';
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

/**
 * Canonical signed request. The body hash binds the exact bytes, the method and
 * path prevent cross-route reuse, and the timestamp plus nonce bound replay.
 */
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

/**
 * Parse the operator-owned client key registry.
 *
 * The persistent schema is qms-broker-client-keys@2. A key has a stable
 * keyId, one Ed25519 public key, a createdAt audit timestamp and an optional
 * enabled flag. It has no expiry: authorization ends only when an operator
 * revokes the key through the admin socket or disables it in this file.
 *
 * Legacy entries that still carry issuedAt/expiresAt are accepted so an
 * upgrade cannot lock the agent out, but their expiry is deliberately ignored
 * and the entry is flagged so the broker can log a migration warning.
 */
export function parseKeysConfig(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document) || !Array.isArray(document.keys)) {
    fail(BROKER_ERROR.AUTH_INVALID, 'The client key configuration is invalid.');
  }
  if (document.schema !== undefined && ![KEYS_SCHEMA, LEGACY_KEYS_SCHEMA].includes(document.schema)) {
    fail(BROKER_ERROR.AUTH_INVALID, 'The client key configuration schema is unsupported.');
  }
  const persistentSchema = document.schema === KEYS_SCHEMA;
  const keys = new Map();
  const publicKeys = new Set();
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
    const publicKeyFingerprint = publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
    if (publicKeys.has(publicKeyFingerprint)) {
      fail(BROKER_ERROR.AUTH_INVALID, 'Client key ' + entry.keyId + ' duplicates another registered public key.');
    }
    publicKeys.add(publicKeyFingerprint);
    const legacy = entry.expiresAt !== undefined || entry.issuedAt !== undefined;
    const createdAtRaw = entry.createdAt ?? entry.issuedAt ?? null;
    let createdAt = null;
    if (createdAtRaw !== null) {
      createdAt = Date.parse(createdAtRaw);
      if (!Number.isFinite(createdAt)) {
        fail(BROKER_ERROR.AUTH_INVALID, 'Client key ' + entry.keyId + ' has an invalid createdAt.');
      }
    } else if (persistentSchema || !legacy) {
      fail(BROKER_ERROR.AUTH_INVALID, 'Client key ' + entry.keyId + ' requires createdAt.');
    }
    keys.set(entry.keyId, {
      keyId: entry.keyId,
      publicKey,
      publicKeyPem: entry.publicKeyPem,
      createdAt,
      disabled: entry.enabled === false || entry.disabled === true,
      legacy
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
 * In-memory replay cache used as the fast concurrency gate. The timestamp
 * window bounds every entry. Durable replay protection is layered on top by
 * PublicationBroker.claimNonce(), which persists claimed nonces in broker
 * state so a restart cannot reopen the window.
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
 * Verify one directly signed broker request. Every check is fail-closed and
 * the caller must not process the request when this throws.
 *
 * There is no session, access grant, refresh or authorization lifetime. A
 * registered key remains valid until the operator revokes it (state) or
 * disables it (key file). The only time bound is the per-request timestamp
 * window; the only one-shot bound is the nonce.
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
  nonceTtlMs = 600000
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
  if (!nonceCache.remember(keyId, nonce, now + nonceTtlMs, now)) {
    fail(BROKER_ERROR.AUTH_REPLAY, 'The request nonce has already been used.');
  }
  return { keyId, timestamp, nonce };
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
