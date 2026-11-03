import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateAccessToken,
  hashAccessToken,
  issueAccessGrant,
  validateAccessGrant,
  pruneAccessGrants,
  revokeKeyGrants,
  GRANT_TOKEN
} from '../../broker/src/grants.js';

const NOW = Date.parse('2026-11-03T10:00:00.000Z');

test('mints opaque grants and persists only the SHA-256 hash', () => {
  const draft = { accessGrants: {} };
  const issued = issueAccessGrant({ draft, keyId: 'agent-key', now: NOW, ttlMs: 900000 });
  assert.match(issued.token, GRANT_TOKEN);
  assert.equal(Object.keys(draft.accessGrants).length, 1);
  assert.equal(draft.accessGrants[issued.hash].keyId, 'agent-key');
  assert.equal(JSON.stringify(draft).includes(issued.token), false);
  assert.equal(hashAccessToken(issued.token), issued.hash);
});

test('validates a live grant and rejects expired, unknown and foreign grants', () => {
  const draft = { accessGrants: {} };
  const issued = issueAccessGrant({ draft, keyId: 'agent-key', now: NOW, ttlMs: 900000 });
  const valid = validateAccessGrant({ grants: draft.accessGrants, token: issued.token, keyId: 'agent-key', now: NOW + 1000 });
  assert.equal(valid.grant.keyId, 'agent-key');

  assert.throws(() => validateAccessGrant({
    grants: draft.accessGrants, token: issued.token, keyId: 'agent-key', now: NOW + 900001
  }), (error) => error.code === 'AUTH_GRANT_EXPIRED');
  assert.throws(() => validateAccessGrant({
    grants: draft.accessGrants, token: issued.token, keyId: 'other-key', now: NOW
  }), (error) => error.code === 'AUTH_GRANT_INVALID');
  assert.throws(() => validateAccessGrant({
    grants: draft.accessGrants, token: generateAccessToken(), keyId: 'agent-key', now: NOW
  }), (error) => error.code === 'AUTH_GRANT_INVALID');
  assert.throws(() => validateAccessGrant({
    grants: draft.accessGrants, token: 'qmsa_short', keyId: 'agent-key', now: NOW
  }), (error) => error.code === 'AUTH_GRANT_INVALID');
  assert.throws(() => validateAccessGrant({
    grants: draft.accessGrants, token: null, keyId: 'agent-key', now: NOW
  }), (error) => error.code === 'AUTH_GRANT_REQUIRED');
});

test('revokes all grants for one key without touching other keys', () => {
  const draft = { accessGrants: {} };
  const a = issueAccessGrant({ draft, keyId: 'key-a', now: NOW, ttlMs: 900000 });
  const b = issueAccessGrant({ draft, keyId: 'key-b', now: NOW, ttlMs: 900000 });
  assert.equal(revokeKeyGrants(draft, 'key-a'), 1);
  assert.throws(() => validateAccessGrant({ grants: draft.accessGrants, token: a.token, keyId: 'key-a', now: NOW }), (error) => error.code === 'AUTH_GRANT_REVOKED');
  assert.equal(validateAccessGrant({ grants: draft.accessGrants, token: b.token, keyId: 'key-b', now: NOW }).grant.keyId, 'key-b');
});

test('prunes expired grants and bounds active grants per key', () => {
  const draft = { accessGrants: {} };
  const old = issueAccessGrant({ draft, keyId: 'key-a', now: NOW - 3600000, ttlMs: 60000 });
  assert.equal(pruneAccessGrants(draft, NOW), 1);
  assert.equal(draft.accessGrants[old.hash], undefined);

  const tokens = [];
  for (let i = 0; i < 12; i += 1) {
    const issued = issueAccessGrant({ draft, keyId: 'key-a', now: NOW + i, ttlMs: 900000, maxGrantsPerKey: 3 });
    tokens.push(issued);
  }
  const active = Object.values(draft.accessGrants).filter((grant) => grant.keyId === 'key-a');
  assert.equal(active.length, 3);
  assert.throws(() => validateAccessGrant({
    grants: draft.accessGrants, token: tokens[0].token, keyId: 'key-a', now: NOW + 20
  }), (error) => error.code === 'AUTH_GRANT_INVALID');
});

test('concurrent minting produces unique tokens and consistent state', async () => {
  const draft = { accessGrants: {} };
  const issued = await Promise.all(Array.from({ length: 64 }, (_, index) =>
    Promise.resolve().then(() => issueAccessGrant({
      draft, keyId: 'key-a', now: NOW + index, ttlMs: 900000, maxGrantsPerKey: 64
    }))
  ));
  assert.equal(new Set(issued.map((entry) => entry.token)).size, 64);
  assert.equal(Object.keys(draft.accessGrants).length, 64);
  for (const entry of issued) {
    validateAccessGrant({ grants: draft.accessGrants, token: entry.token, keyId: 'key-a', now: NOW + 100 });
  }
});
