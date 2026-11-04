import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { JsonRpcConnection } from '../../lib/engine/host/client.js';
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

test('the host exposes the Phase 7 synchronization RPC surface', async (t) => {
  const dataRoot = await tempDir(t);
  const wp = await startWordpressFixtureServer({ data: createFixtureData() });
  t.after(() => wp.close());
  const { connection } = await startHost(t, dataRoot);

  const info = await connection.request('engine.info');
  assert.equal(info.syncSchema, 'qms-sync-state@1');
  assert.equal(info.syncScanSchema, 'qms-sync-scan@1');
  assert.equal(info.syncConflictSchema, 'qms-sync-conflict@1');

  const project = await connection.request('project.create', {
    name: 'Sync Host Project',
    source: { adapter: 'wordpress', baseUrl: wp.url },
    target: { qdnName: 'SyncHostSite' },
    settings: {
      disk: { reserveBytes: 0, maxBytesPerRun: 0, unknownSizePolicy: 'estimate', unknownSizeBytes: 1024 },
      media: { allowLoopback: true }
    }
  });
  const scan = await connection.request('sync.check', {
    projectId: project.id,
    mode: 'full',
    perPage: 50
  });
  assert.equal(scan.status, 'completed');
  assert.equal(scan.counts.new > 0, true);
  assert.equal(scan.planningAllowed, true);

  const status = await connection.request('sync.status', { projectId: project.id });
  assert.equal(status.latestScan.scanId, scan.scanId);
  assert.equal(status.latestScan.status, 'completed');

  const plan = await connection.request('sync.plan', {
    projectId: project.id,
    scanId: scan.scanId,
    estimateMedia: false
  });
  assert.equal(plan.status, 'completed');
  assert.ok(plan.planId);
  assert.equal(plan.stats.selected > 0, true);

  const conflicts = await connection.request('sync.conflicts', { projectId: project.id });
  assert.deepEqual(conflicts, []);
  const history = await connection.request('sync.history', { projectId: project.id });
  assert.equal(history[0].scanId, scan.scanId);
  const catalog = await connection.request('sync.catalog', { projectId: project.id });
  assert.equal(Array.isArray(catalog), true);
});
