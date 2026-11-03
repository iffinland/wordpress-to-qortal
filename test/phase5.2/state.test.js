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

test('migrates a v1 state file without losing budget, publications, locks or idempotency', async () => {
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
    assert.deepEqual(snapshot.accessGrants, {});
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
  } finally { ctx.cleanup(); }
});

test('refuses a v2 state file with invalid access grant entries', async () => {
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
      accessGrants: { bad: { keyId: 'key', issuedAt: NOW, expiresAt: NOW + 1000 } },
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
