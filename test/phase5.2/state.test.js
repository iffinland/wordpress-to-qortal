import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrokerState, STATE_SCHEMA, STATE_VERSION } from '../../broker/src/state.js';

const NOW = Date.parse('2026-11-03T10:00:00.000Z');

function tempState() {
  const dir = mkdtempSync(join(tmpdir(), 'qms-state-'));
  return { dir, path: join(dir, 'state.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('migrates a v1 state file to v3 without losing budget, publications, locks or idempotency', async () => {
  const ctx = tempState();
  try {
    const legacy = {
      schema: 'qms-test-broker-state@1',
      version: 1,
      createdAt: new Date(NOW - 1000).toISOString(),
      updatedAt: new Date(NOW - 1000).toISOString(),
      disabled: false,
      disabledAt: null,
      disabledReason: null,
      revokedKeys: ['old-key'],
      publications: {
        pub_aaaaaaaaaaaaaaaaaaaaaaaa: {
          schema: 'qms-test-publication@1',
          publicationId: 'pub_aaaaaaaaaaaaaaaaaaaaaaaa',
          state: 'remote_verified',
          totalFeeAtomic: 1000000
        }
      },
      idempotency: { req_existing: { publicationId: 'pub_aaaaaaaaaaaaaaaaaaaaaaaa', bodyHash: 'abc', at: NOW } },
      resourceLocks: { 'DOCUMENT|developer iffi|qms-dev-existing': { publicationId: 'pub_aaaaaaaaaaaaaaaaaaaaaaaa', state: 'remote_verified', at: NOW } },
      budget: { windowStart: NOW - 5000, spentAtomic: 2000000, uncertainAtomic: 0, reservations: { pub_bbbbbbbbbbbbbbbbbbbbbbbb: 1000000 } }
    };
    writeFileSync(ctx.path, JSON.stringify(legacy), { mode: 0o600 });
    const state = await BrokerState.open({ path: ctx.path, fsync: false, clock: () => NOW });
    const snapshot = state.snapshot();
    assert.equal(snapshot.schema, STATE_SCHEMA);
    assert.equal(snapshot.version, STATE_VERSION);
    assert.deepEqual(snapshot.requestNonces, {});
    assert.equal(Object.hasOwn(snapshot, 'accessGrants'), false);
    assert.equal(snapshot.budget.spentAtomic, 2000000);
    assert.deepEqual(snapshot.budget.reservations, legacy.budget.reservations);
    assert.deepEqual(snapshot.publications, legacy.publications);
    assert.deepEqual(snapshot.idempotency, legacy.idempotency);
    assert.deepEqual(snapshot.resourceLocks, legacy.resourceLocks);
    assert.deepEqual(snapshot.revokedKeys, ['old-key']);

    const persisted = JSON.parse(readFileSync(ctx.path, 'utf8'));
    assert.equal(persisted.schema, STATE_SCHEMA);
    assert.equal(persisted.version, STATE_VERSION);
    assert.equal(persisted.budget.spentAtomic, 2000000);
    assert.equal(Object.hasOwn(persisted, 'accessGrants'), false);
  } finally { ctx.cleanup(); }
});

test('migrates a v2 state file to v3 and drops the obsolete accessGrants map', async () => {
  const ctx = tempState();
  try {
    const previous = {
      schema: 'qms-test-broker-state@2',
      version: 2,
      createdAt: new Date(NOW - 1000).toISOString(),
      updatedAt: new Date(NOW - 1000).toISOString(),
      disabled: true,
      disabledAt: new Date(NOW - 500).toISOString(),
      disabledReason: 'incident',
      revokedKeys: ['agent-test'],
      accessGrants: {
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA': {
          schema: 'qms-broker-access-grant@1',
          keyId: 'agent-test',
          issuedAt: NOW - 1000,
          expiresAt: NOW + 900000,
          revoked: false
        }
      },
      publications: { pub_cccccccccccccccccccccccc: { state: 'remote_verified', totalFeeAtomic: 3 } },
      idempotency: { req_old: { publicationId: 'pub_cccccccccccccccccccccccc', bodyHash: 'def' } },
      resourceLocks: { 'DOCUMENT|developer iffi|qms-dev-old': { publicationId: 'pub_cccccccccccccccccccccccc' } },
      budget: { windowStart: NOW - 5000, spentAtomic: 1234, uncertainAtomic: 0, reservations: {} }
    };
    writeFileSync(ctx.path, JSON.stringify(previous), { mode: 0o600 });
    const state = await BrokerState.open({ path: ctx.path, fsync: false, clock: () => NOW });
    const snapshot = state.snapshot();
    assert.equal(snapshot.schema, STATE_SCHEMA);
    assert.equal(snapshot.version, STATE_VERSION);
    assert.equal(Object.hasOwn(snapshot, 'accessGrants'), false);
    assert.deepEqual(snapshot.requestNonces, {});
    assert.equal(snapshot.disabled, true);
    assert.equal(snapshot.disabledReason, 'incident');
    assert.deepEqual(snapshot.revokedKeys, ['agent-test']);
    assert.equal(snapshot.budget.spentAtomic, 1234);
    assert.deepEqual(snapshot.publications, previous.publications);
    assert.deepEqual(snapshot.idempotency, previous.idempotency);
    assert.deepEqual(snapshot.resourceLocks, previous.resourceLocks);
  } finally { ctx.cleanup(); }
});

test('refuses a v3 state file with invalid request nonce entries', async () => {
  const ctx = tempState();
  try {
    const invalid = {
      schema: STATE_SCHEMA,
      version: STATE_VERSION,
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
      disabled: false,
      disabledAt: null,
      disabledReason: null,
      revokedKeys: [],
      requestNonces: { bad: { expiresAt: NOW + 1000 } },
      publications: {},
      idempotency: {},
      resourceLocks: {},
      budget: { windowStart: NOW, spentAtomic: 0, uncertainAtomic: 0, reservations: {} }
    };
    writeFileSync(ctx.path, JSON.stringify(invalid), { mode: 0o600 });
    await assert.rejects(
      BrokerState.open({ path: ctx.path, fsync: false, clock: () => NOW }),
      (error) => error.code === 'UNAVAILABLE'
    );
  } finally { ctx.cleanup(); }
});

test('durable nonce claims survive reopen, reject duplicates and prune on expiry', async () => {
  const ctx = tempState();
  try {
    const state = await BrokerState.open({ path: ctx.path, fsync: false, clock: () => NOW });
    const claimed = await state.claimNonce({
      keyId: 'agent-test', nonce: 'nonce-durable-0000001', now: NOW, expiresAt: NOW + 600000
    });
    assert.equal(claimed, true);
    const duplicate = await state.claimNonce({
      keyId: 'agent-test', nonce: 'nonce-durable-0000001', now: NOW + 1000, expiresAt: NOW + 600000
    });
    assert.equal(duplicate, false);

    const reopened = await BrokerState.open({ path: ctx.path, fsync: false, clock: () => NOW + 2000 });
    assert.deepEqual(reopened.snapshot().requestNonces, {
      'agent-test|nonce-durable-0000001': { expiresAt: NOW + 600000 }
    });
    const afterRestart = await reopened.claimNonce({
      keyId: 'agent-test', nonce: 'nonce-durable-0000001', now: NOW + 2000, expiresAt: NOW + 600000
    });
    assert.equal(afterRestart, false);

    const expired = await BrokerState.open({ path: ctx.path, fsync: false, clock: () => NOW + 700000 });
    await expired.recoverInterrupted({ windowMs: 86400000 });
    assert.deepEqual(expired.snapshot().requestNonces, {});
    const reclaimer = await expired.claimNonce({
      keyId: 'agent-test', nonce: 'nonce-durable-0000001', now: NOW + 700000, expiresAt: NOW + 1300000
    });
    assert.equal(reclaimer, true);
  } finally { ctx.cleanup(); }
});
