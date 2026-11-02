import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { ProjectLock } from '../../lib/engine/lock.js';
import { createFixedClock } from '../../lib/engine/clock.js';
import { tempDir } from '../../test-support/engine/env.js';

function lockFile(root) {
  return path.join(root, 'lock.json');
}

test('a second writer is rejected while the lock is held', async (t) => {
  const root = await tempDir(t);
  const file = lockFile(root);
  const first = await ProjectLock.acquire({ file, projectId: 'prj_locktest' });
  await assert.rejects(
    () => ProjectLock.acquire({ file, projectId: 'prj_locktest' }),
    (error) => error.code === 'PROJECT_LOCKED' && error.details.owner.pid === process.pid
  );
  await first.release();
  const second = await ProjectLock.acquire({ file, projectId: 'prj_locktest' });
  assert.equal(second.recoveredStaleLock, false);
  await second.release();
});

test('a lock owned by a dead process requires explicit stale recovery', async (t) => {
  const root = await tempDir(t);
  const file = lockFile(root);
  await writeFile(file, JSON.stringify({
    schema: 'qms-lock@1',
    projectId: 'prj_staletest',
    token: 'lock_deadbeefdeadbeef',
    pid: 999999,
    hostname: os.hostname(),
    acquiredAt: '2026-01-01T00:00:00.000Z',
    heartbeatAt: '2026-01-01T00:00:00.000Z'
  }));

  await assert.rejects(
    () => ProjectLock.acquire({ file, projectId: 'prj_staletest' }),
    (error) => error.code === 'PROJECT_LOCK_STALE' && error.details.reason === 'owner-process-gone'
  );

  const recovered = await ProjectLock.acquire({ file, projectId: 'prj_staletest', recoverStale: true });
  assert.equal(recovered.recoveredStaleLock, true);
  const entries = await readdir(root);
  assert.ok(entries.some((entry) => entry.startsWith('lock.json.stale-')));
  await recovered.release();
});

test('an expired heartbeat is stale once the clock passes the threshold', async (t) => {
  const root = await tempDir(t);
  const file = lockFile(root);
  const clock = createFixedClock('2026-01-01T00:00:00.000Z');
  const held = await ProjectLock.acquire({
    file,
    projectId: 'prj_heartbeat',
    clock,
    staleAfterMs: 10_000
  });
  clock.advance(11_000);
  await assert.rejects(
    () => ProjectLock.acquire({ file, projectId: 'prj_heartbeat', clock, staleAfterMs: 10_000 }),
    (error) => error.code === 'PROJECT_LOCK_STALE' && error.details.reason === 'heartbeat-expired'
  );
  await held.release();
});

test('heartbeats update the lock and lost locks are detected', async (t) => {
  const root = await tempDir(t);
  const file = lockFile(root);
  const lock = await ProjectLock.acquire({ file, projectId: 'prj_hb', heartbeatIntervalMs: 0 });
  const before = JSON.parse(await readFile(file, 'utf8'));
  const changed = await lock.heartbeat({ force: true });
  assert.equal(changed, true);
  const after = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(after.token, before.token);
  assert.ok(Date.parse(after.heartbeatAt) >= Date.parse(before.heartbeatAt));

  await lock.assertHeld();
  await writeFile(file, JSON.stringify({ ...after, token: 'lock_someoneelse' }));
  await assert.rejects(() => lock.assertHeld(), { code: 'LOCK_LOST' });
  await assert.rejects(() => lock.release(), { code: 'LOCK_RELEASE_DENIED' });
});

test('a corrupt lock file is never taken over implicitly', async (t) => {
  const root = await tempDir(t);
  const file = lockFile(root);
  await writeFile(file, '{not json');
  await assert.rejects(
    () => ProjectLock.acquire({ file, projectId: 'prj_corrupt' }),
    (error) => error.code === 'PROJECT_LOCK_CORRUPT'
  );
  await assert.rejects(
    () => ProjectLock.acquire({ file, projectId: 'prj_corrupt', recoverStale: true }),
    (error) => error.code === 'PROJECT_LOCK_CORRUPT'
  );
});
