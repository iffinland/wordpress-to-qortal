import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateState, CURRENT_STORE_VERSION, emptyRecoveryState } from '../../lib/engine/storage/schema.js';
import { assertSupportedStoreVersion } from '../../lib/engine/storage/schema.js';
import { JournalStore } from '../../lib/engine/storage/journal.js';
import { tempDir } from '../../test-support/engine/env.js';

test('store version 4 migrates forward to the Phase 8 recovery state without losing data', () => {
  const legacy = {
    schema: 'qms-state@1',
    projectId: 'prj_testproject',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastEventSeq: 2,
    eventsDropped: 0,
    events: [],
    runs: {},
    counters: { run: 1 },
    meta: { keep: true },
    identity: null,
    plans: {},
    media: { assets: {}, downloads: {}, itemRefs: {}, counters: { bytes: 0, files: 0 } },
    publication: { schema: 'qms-publication-state@1', revision: 1, plans: {}, handoffs: {}, resources: {}, history: [], counters: { batch: 0, handoff: 0 } },
    sync: { schema: 'qms-sync-state@1', revision: 1, watermarks: {}, scans: {}, items: {}, conflicts: {}, withdrawals: {}, adoptions: [], counters: { scan: 0, conflict: 0, withdrawal: 0 } }
  };
  const migrated = migrateState(legacy, 4, { targetVersion: CURRENT_STORE_VERSION });
  assert.equal(migrated.storeVersion, CURRENT_STORE_VERSION);
  assert.deepEqual(migrated.applied, [5]);
  assert.equal(migrated.state.recovery.schema, 'qms-recovery-state@1');
  assert.deepEqual(migrated.state.recovery.checkpoints, {});
  assert.deepEqual(migrated.state.recovery.cleanups, {});
  assert.equal(migrated.state.meta.keep, true);
  assert.equal(migrated.state.counters.run, 1);
  assert.deepEqual(emptyRecoveryState(), migrated.state.recovery);
});

test('an unknown newer store version fails closed before any write', async (t) => {
  assert.throws(
    () => assertSupportedStoreVersion(CURRENT_STORE_VERSION + 1),
    (error) => error.code === 'STATE_VERSION_UNSUPPORTED'
  );
  const root = await tempDir(t);
  const store = await JournalStore.open({
    root,
    projectId: 'prj_testproject',
    initialState: {
      schema: 'qms-state@1',
      projectId: 'prj_testproject',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastEventSeq: 0,
      events: [],
      runs: {},
      counters: {},
      meta: {}
    }
  });
  assert.equal(store.storeVersion, CURRENT_STORE_VERSION);
  assert.equal(store.state.recovery.schema, 'qms-recovery-state@1');
  await store.close();
});

