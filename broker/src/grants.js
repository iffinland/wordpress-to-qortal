import { createHash, randomBytes } from 'node:crypto';
import { BROKER_ERROR, fail } from './errors.js';

export const GRANT_PREFIX = 'qmsa_';
export const GRANT_SCHEMA = 'qms-broker-access-grant@1';
export const GRANT_TOKEN = /^qmsa_[A-Za-z0-9_-]{43}$/;
const HASH = /^[A-Za-z0-9_-]{43}$/;

export function generateAccessToken() {
  return GRANT_PREFIX + randomBytes(32).toString('base64url');
}

/**
 * Only the SHA-256 hash of an access token is persisted. The plaintext token
 * exists only in the refresh response and in the agent's memory.
 */
export function hashAccessToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}

export function pruneAccessGrants(draft, now) {
  let removed = 0;
  for (const [hash, grant] of Object.entries(draft.accessGrants)) {
    if (!grant || grant.expiresAt <= now) {
      delete draft.accessGrants[hash];
      removed += 1;
    }
  }
  return removed;
}

/**
 * Issue a short-lived access grant bound to a registered key. Bounded growth is
 * enforced per key so a refresh loop cannot exhaust broker memory/state.
 */
export function issueAccessGrant({ draft, keyId, now, ttlMs, maxGrantsPerKey = 8 }) {
  pruneAccessGrants(draft, now);
  const active = Object.entries(draft.accessGrants)
    .filter(([, grant]) => grant.keyId === keyId)
    .sort((a, b) => a[1].issuedAt - b[1].issuedAt);
  while (active.length >= maxGrantsPerKey) {
    const [oldest] = active.shift();
    delete draft.accessGrants[oldest];
  }
  const token = generateAccessToken();
  const hash = hashAccessToken(token);
  const grant = {
    schema: GRANT_SCHEMA,
    keyId,
    issuedAt: now,
    expiresAt: now + ttlMs,
    revoked: false
  };
  draft.accessGrants[hash] = grant;
  return { token, hash, grant };
}

export function validateAccessGrant({ grants, token, keyId, now }) {
  if (typeof token !== 'string' || token.length === 0) {
    fail(BROKER_ERROR.AUTH_GRANT_REQUIRED, 'A broker access credential is required.');
  }
  if (!GRANT_TOKEN.test(token)) {
    fail(BROKER_ERROR.AUTH_GRANT_INVALID, 'The broker access credential is malformed.');
  }
  const hash = hashAccessToken(token);
  if (!HASH.test(hash)) {
    fail(BROKER_ERROR.AUTH_GRANT_INVALID, 'The broker access credential is malformed.');
  }
  const grant = grants?.[hash];
  if (!grant) {
    fail(BROKER_ERROR.AUTH_GRANT_INVALID, 'The broker access credential is unknown or was revoked.');
  }
  if (grant.keyId !== keyId) {
    fail(BROKER_ERROR.AUTH_GRANT_INVALID, 'The broker access credential is not bound to this key.');
  }
  if (grant.revoked === true) {
    fail(BROKER_ERROR.AUTH_GRANT_REVOKED, 'The broker access credential was revoked.');
  }
  if (grant.expiresAt <= now) {
    fail(BROKER_ERROR.AUTH_GRANT_EXPIRED, 'The broker access credential has expired; refresh it.');
  }
  return { hash, grant };
}

export function revokeKeyGrants(draft, keyId) {
  let revoked = 0;
  for (const grant of Object.values(draft.accessGrants)) {
    if (grant.keyId === keyId && grant.revoked !== true) {
      grant.revoked = true;
      revoked += 1;
    }
  }
  return revoked;
}

export function grantFingerprint(hash) {
  return 'sha256:' + hash.slice(0, 12);
}
