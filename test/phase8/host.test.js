import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { JsonRpcConnection } from '../../lib/engine/host/client.js';
import { ENGINE_VERSION } from '../../lib/engine/index.js';
import { tempDir } from '../../test-support/engine/env.js';
import { startWordpressFixtureServer, createFixtureData } from '../../test-support/wordpress/fixtureServer.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

async function startHost(t, dataRoot) {
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'bin', 'qms.js'), 'host'], {
    cwd: REPO_ROOT,
    env: { ...process.env, QMS_DATA_ROOT: dataRoot },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  t.after(() => child.kill('SIGTERM'));
  const connection = new JsonRpcConnection({ input: child.stdout, output: child.stdin });
  t.after(() => connection.close());
  return { child, connection };
}

test('the host exposes the Phase 8 recovery, cleanup, history and support RPC surface', async (t) => {
  const dataRoot = await tempDir(t);
  const wp = await startWordpressFixtureServer({ data: createFixtureData() });
  t.after(() => wp.close());
  const { connection } = await startHost(t, dataRoot);

  const info = await connection.request('engine.info');
  assert.equal(info.version, ENGINE_VERSION);
  assert.equal(info.recoveryCheckpointSchema, 'qms-recovery-checkpoint@1');
  assert.equal(info.recoveryStageSchema, 'qms-recovery-stage@1');
  assert.equal(info.cleanupPreviewSchema, 'qms-cleanup-preview@1');
  assert.equal(info.auditEntrySchema, 'qms-audit-entry@1');
  assert.equal(info.supportBundleSchema, 'qms-support-bundle@1');

  const project = await connection.request('project.create', {
    name: 'Phase 8 Host Project',
    source: { adapter: 'wordpress', baseUrl: wp.url },
    target: { qdnName: 'PhaseEightHost' },
    settings: {
      disk: { reserveBytes: 0, maxBytesPerRun: 0, unknownSizePolicy: 'estimate', unknownSizeBytes: 1024 },
      media: { allowLoopback: true }
    }
  });
  await connection.request('source.discover', { projectId: project.id, perPage: 50 });
  await connection.request('plan.create', { projectId: project.id, batchSize: 2 });

  const recovery = await connection.request('recovery.status', { projectId: project.id });
  assert.equal(recovery.schema, 'qms-recovery-status@1');
  assert.deepEqual(recovery.candidates, []);
  assert.deepEqual(recovery.ambiguousResources, []);

  const preview = await connection.request('cleanup.preview', { projectId: project.id, retentionDays: 14 });
  assert.equal(preview.schema, 'qms-cleanup-preview@1');
  assert.equal(preview.eligible, false);

  await assert.rejects(
    () => connection.request('cleanup.start', { projectId: project.id }),
    (error) => error.code === 'CLEANUP_NOT_ELIGIBLE'
  );

  const emptyCleanups = await connection.request('cleanup.list', { projectId: project.id });
  assert.deepEqual(emptyCleanups, []);

  const history = await connection.request('history.list', { projectId: project.id, limit: 50 });
  assert.equal(Array.isArray(history), true);
  assert.ok(history.some((entry) => entry.type === 'run_started'));

  const exported = await connection.request('history.export', { projectId: project.id, reason: 'host-test' });
  assert.ok(exported.relativePath.startsWith('history/snapshots/'));
  assert.ok(exported.entries >= 1);

  const bundle = await connection.request('support.bundle', {
    projectId: project.id,
    appInfo: { version: '0.6.0' },
    settings: { password: 'CANARY-HOST-SECRET' },
    keyring: { status: 'locked' }
  });
  assert.equal(bundle.schema, 'qms-support-bundle@1');
  assert.ok(bundle.bytes > 0);
  const bundleInfo = await stat(bundle.path);
  assert.equal(bundleInfo.mode & 0o777, 0o600);

  await assert.rejects(
    () => connection.request('recovery.resume', { projectId: project.id }),
    (error) => error.code === 'INVALID_ARGUMENT'
  );
  await assert.rejects(
    () => connection.request('shell.exec', { command: 'id' }),
    (error) => error.code === 'UNKNOWN_METHOD'
  );
});

