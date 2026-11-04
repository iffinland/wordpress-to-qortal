import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { JournalStore } from '../../lib/engine/storage/journal.js';
import { createInitialState } from '../../lib/engine/storage/schema.js';
import { tempDir } from '../../test-support/engine/env.js';

async function openStore(root, options = {}) {
  return JournalStore.open({
    root,
    projectId: 'prj_testproject',
    initialState: createInitialState({ projectId: 'prj_testproject', createdAt: '2026-01-01T00:00:00.000Z' }),
    compactEveryTransactions: 1000,
    ...options
  });
}

test('committed transactions survive a store reopen', async (t) => {
  const root = await tempDir(t);
  const store = await openStore(root);
  await store.transaction((draft) => {
    draft.meta.counter = 1;
    draft.runs.run_one = { id: 'run_one', state: 'completed', events: [] };
  });
  await store.transaction((draft) => {
    draft.meta.counter = 2;
  });
  assert.equal(store.lastTxnSeq, 2);
  await store.close();

  const reopened = await openStore(root);
  assert.equal(reopened.state.meta.counter, 2);
  assert.equal(reopened.state.runs.run_one.state, 'completed');
  assert.equal(reopened.lastTxnSeq, 2);
  assert.equal(reopened.recovery.recovered, false);
});

test('a torn journal tail is discarded and reported as recovered', async (t) => {
  const root = await tempDir(t);
  const store = await openStore(root);
  await store.transaction((draft) => {
    draft.meta.counter = 1;
  });
  await store.transaction((draft) => {
    draft.meta.counter = 2;
  });
  await store.close();

  const journalPath = path.join(root, 'journal.jsonl');
  const good = await readFile(journalPath, 'utf8');
  // Half of a begin record: exactly what a crash mid-append leaves behind.
  await appendFile(journalPath, '{"t":"begin","txnSeq":3,"storeVersion":1,"at":"2026-');

  const recovered = await openStore(root);
  assert.equal(recovered.recovery.recovered, true);
  assert.ok(recovered.recovery.truncatedBytes > 0);
  assert.equal(recovered.state.meta.counter, 2);
  assert.equal(recovered.lastTxnSeq, 2);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(recovered.state)));

  const repaired = await readFile(journalPath, 'utf8');
  assert.ok(repaired.endsWith('\n'));
  for (const line of repaired.trim().split('\n')) {
    assert.doesNotThrow(() => JSON.parse(line));
  }
});

test('an uncommitted transaction is never applied', async (t) => {
  const root = await tempDir(t);
  const store = await openStore(root);
  await store.transaction((draft) => {
    draft.meta.counter = 1;
  });
  await store.close();

  const journalPath = path.join(root, 'journal.jsonl');
  const state = {
    ...createInitialState({ projectId: 'prj_testproject', createdAt: '2026-01-01T00:00:00.000Z' }),
    meta: { counter: 99 }
  };
  await appendFile(journalPath, [
    JSON.stringify({ t: 'begin', txnSeq: 2, storeVersion: 1, at: '2026-01-01T00:00:00.000Z' }),
    JSON.stringify({ t: 'state', storeVersion: 1, state, checksum: 'sha256:broken' })
  ].join('\n') + '\n');

  const reopened = await openStore(root);
  assert.equal(reopened.state.meta.counter, 1);
  assert.equal(reopened.recovery.recovered, true);

  // The incomplete tail is gone, so a new transaction commits cleanly.
  await reopened.transaction((draft) => {
    draft.meta.counter = 2;
  });
  await reopened.close();
  const again = await openStore(root);
  assert.equal(again.state.meta.counter, 2);
  assert.equal(again.lastTxnSeq, 2);
});

test('a transaction that throws writes nothing', async (t) => {
  const root = await tempDir(t);
  const store = await openStore(root);
  await assert.rejects(
    store.transaction((draft) => {
      draft.meta.counter = 5;
      throw new Error('boom');
    }),
    /boom/
  );
  await store.close();
  const reopened = await openStore(root);
  assert.equal(reopened.state.meta.counter, undefined);
  assert.equal(reopened.lastTxnSeq, 0);
});

test('concurrent in-process transactions are serialized', async (t) => {
  const root = await tempDir(t);
  const store = await openStore(root);
  await Promise.all(Array.from({ length: 25 }, () =>
    store.transaction((draft) => {
      draft.counters.parallel = (draft.counters.parallel ?? 0) + 1;
    })
  ));
  assert.equal(store.state.counters.parallel, 25);
  assert.equal(store.lastTxnSeq, 25);
  await store.close();
  const reopened = await openStore(root);
  assert.equal(reopened.state.counters.parallel, 25);
});

test('compaction replaces the journal with a snapshot and preserves state', async (t) => {
  const root = await tempDir(t);
  const store = await openStore(root, { compactEveryTransactions: 1000 });
  for (let index = 1; index <= 10; index += 1) {
    await store.transaction((draft) => {
      draft.meta.counter = index;
    });
  }
  const beforeBytes = store.journalBytes;
  const result = await store.compact({ reason: 'test' });
  assert.equal(result.compacted, true);
  assert.equal(store.journalBytes < beforeBytes, true);
  await store.close();

  const reopened = await openStore(root);
  assert.equal(reopened.state.meta.counter, 10);
  assert.equal(reopened.lastTxnSeq, 10);
});

test('an older store version is migrated forward', async (t) => {
  const root = await tempDir(t);
  const legacyState = {
    schema: 'qms-state@1',
    projectId: 'prj_legacy',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastEventSeq: 2,
    events: [],
    runs: {},
    counters: {}
  };
  await writeFile(path.join(root, 'snapshot.json'), JSON.stringify({
    schema: 'qms-state-snapshot@1',
    formatVersion: 1,
    storeVersion: 0,
    lastTxnSeq: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    state: legacyState
  }, null, 2));
  await writeFile(path.join(root, 'journal.jsonl'), JSON.stringify({
    schema: 'qms-journal@1',
    formatVersion: 1,
    storeVersion: 0,
    baseTxnSeq: 1,
    createdAt: '2026-01-01T00:00:00.000Z'
  }) + '\n');

  const store = await JournalStore.open({ root, migrations: undefined });
  assert.equal(store.storeVersion, 4);
  assert.equal(store.recovery.migratedFrom, 0);
  assert.equal(store.state.counters.run, 0);
  await store.close();

  const raw = JSON.parse(await readFile(path.join(root, 'snapshot.json'), 'utf8'));
  assert.equal(raw.storeVersion, 4);
  assert.equal(raw.state.identity, null);
  assert.deepEqual(raw.state.plans, {});
  assert.deepEqual(raw.state.media.counters, { bytes: 0, files: 0 });
  assert.equal(raw.state.sync.schema, 'qms-sync-state@1');
  assert.deepEqual(raw.state.sync.scans, {});
});

test('an unknown newer store version fails closed without writing', async (t) => {
  const root = await tempDir(t);
  const snapshotPath = path.join(root, 'snapshot.json');
  const state = createInitialState({ projectId: 'prj_future', createdAt: '2026-01-01T00:00:00.000Z' });
  const payload = JSON.stringify({
    schema: 'qms-state-snapshot@1',
    formatVersion: 1,
    storeVersion: 99,
    lastTxnSeq: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    state
  });
  await writeFile(snapshotPath, payload);

  await assert.rejects(
    () => JournalStore.open({ root }),
    (error) => error.code === 'STATE_VERSION_UNSUPPORTED' && /newer/i.test(error.message)
  );
  assert.equal(await readFile(snapshotPath, 'utf8'), payload);
});

test('a newer journal header also fails closed', async (t) => {
  const root = await tempDir(t);
  const state = createInitialState({ projectId: 'prj_future', createdAt: '2026-01-01T00:00:00.000Z' });
  await writeFile(path.join(root, 'journal.jsonl'), JSON.stringify({
    schema: 'qms-journal@1',
    formatVersion: 1,
    storeVersion: 7,
    baseTxnSeq: 0,
    createdAt: '2026-01-01T00:00:00.000Z'
  }) + '\n');
  await assert.rejects(
    () => JournalStore.open({ root, initialState: state }),
    (error) => error.code === 'STATE_VERSION_UNSUPPORTED'
  );
  assert.equal(await readFile(path.join(root, 'snapshot.json'), 'utf8').catch(() => ''), '');
});

test('the write guard blocks state changes when the lock is lost', async (t) => {
  const root = await tempDir(t);
  let allow = true;
  const store = await openStore(root, {
    guard: async () => {
      if (!allow) {
        const error = new Error('lock lost');
        error.code = 'LOCK_LOST';
        throw error;
      }
    }
  });
  await store.transaction((draft) => {
    draft.meta.counter = 1;
  });
  allow = false;
  await assert.rejects(store.transaction((draft) => {
    draft.meta.counter = 2;
  }), (error) => error.code === 'LOCK_LOST');
  assert.equal(store.state.meta.counter, 1);
  assert.equal(store.lastTxnSeq, 1);
});

test('automatic compaction kicks in without deadlocking', async (t) => {
  const root = await tempDir(t);
  const store = await openStore(root, { compactEveryTransactions: 3 });
  for (let index = 1; index <= 4; index += 1) {
    await store.transaction((draft) => {
      draft.meta.counter = index;
    });
  }
  assert.equal(store.state.meta.counter, 4);
  await store.close();
  const reopened = await openStore(root);
  assert.equal(reopened.state.meta.counter, 4);
});
