import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, stat } from 'node:fs/promises';
import { JournalStore } from '../../lib/engine/storage/journal.js';
import { createEngine } from '../../lib/engine/index.js';
import { tempDir } from '../../test-support/engine/env.js';

const execFileAsync = promisify(execFile);

test('a process killed mid-journal-write leaves recoverable committed state', async (t) => {
  const root = await tempDir(t);
  const helper = path.join(import.meta.dirname, '..', '..', 'test-support', 'engine', 'crashChild.mjs');

  await assert.rejects(
    execFileAsync(process.execPath, [helper, root, 'torn']),
    (error) => error.signal === 'SIGKILL' || error.code === null
  );

  const store = await JournalStore.open({
    root,
    projectId: 'prj_testproject',
    initialState: { schema: 'qms-state@1', projectId: 'prj_testproject', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lastEventSeq: 0, events: [], runs: {}, counters: {}, meta: {} }
  });
  assert.equal(store.recovery.recovered, true);
  assert.ok(store.recovery.truncatedBytes > 0);
  assert.equal(store.state.counters.crash, 2);
  assert.equal(store.lastTxnSeq, 2);
  await store.transaction((draft) => {
    draft.counters.crash = 3;
    draft.meta.recovered = true;
  });
  await store.close();

  const reopened = await JournalStore.open({ root, projectId: 'prj_testproject' });
  assert.equal(reopened.state.counters.crash, 3);
  assert.equal(reopened.state.meta.recovered, true);
  assert.equal(reopened.recovery.recovered, false);
});

test('a killed project process leaves a stale lock and recoverable event state', async (t) => {
  const dataRoot = await tempDir(t);
  const helper = path.join(import.meta.dirname, '..', '..', 'test-support', 'engine', 'crashProject.mjs');

  await assert.rejects(
    execFileAsync(process.execPath, [helper, dataRoot, 'Killed Project'], { timeout: 20_000 }),
    (error) => error.signal === 'SIGKILL' || error.code === null
  );

  const engine = createEngine({ dataRoot });
  const [summary] = await engine.projects.list();
  assert.equal(summary.name, 'Killed Project');

  await assert.rejects(
    () => engine.projects.open(summary.id),
    (error) => error.code === 'PROJECT_LOCK_STALE'
  );

  const handle = await engine.projects.open(summary.id, { recoverStaleLock: true });
  assert.equal(handle.store.recovery.recovered, true);
  // Two transactions committed before the kill; the third (torn) is discarded.
  // Reopening then appends its own state_snapshot event at seq 3.
  assert.equal(handle.snapshot().storage.lastEventSeq, 3);
  const events = handle.events.list();
  assert.deepEqual(events.map((event) => event.seq), [1, 2, 3]);
  assert.equal(events[0].type, 'state_snapshot');
  assert.equal(events[1].type, 'progress_updated');
  assert.equal(events[2].type, 'state_snapshot');

  const [next] = await handle.events.emit({
    type: 'progress_updated',
    code: 'AFTER_RECOVERY',
    message: 'recovered writer continues',
    progress: { completed: 1, total: 1 }
  });
  assert.equal(next.seq, 4);
  await handle.close();

  const staleLocks = (await readdir(summary.storageRoot)).filter((entry) => entry.startsWith('lock.json.stale-'));
  assert.equal(staleLocks.length, 1);
});

test('a stray snapshot temp file does not affect recovery', async (t) => {
  const dataRoot = await tempDir(t);
  const engine = createEngine({ dataRoot });
  const project = await engine.projects.create({ name: 'Temp File' });
  const handle = await engine.projects.open(project.id);
  await handle.events.emit({ type: 'warning_emitted', code: 'TEST', message: 'x' });
  await handle.close();

  const { writeFile } = await import('node:fs/promises');
  const stray = path.join(project.storageRoot, 'state', 'snapshot.json.999.tmp');
  await writeFile(stray, '{"schema": "truncated');

  const reopened = await engine.projects.open(project.id);
  assert.equal(reopened.events.list().length, 3);
  await reopened.close();
  assert.ok(await stat(stray)); // left untouched, never read as state
  await readFile(stray, 'utf8');
});
