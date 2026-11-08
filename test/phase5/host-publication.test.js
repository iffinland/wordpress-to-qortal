import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcConnection } from '../../lib/engine/host/client.js';
import { createReceipt } from '../../lib/engine/publication/receipts.js';
import { startWordpressFixtureServer } from '../../test-support/wordpress/fixtureServer.js';
import { makePost, dataWithPosts } from '../../test-support/phase3/helpers.js';
import { startQdnServer } from '../../test-support/phase5/qdnServer.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the stdio host exposes the publication handoff, receipt and verification contract', async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'qms-host-publication-'));
  const wp = await startWordpressFixtureServer({ data: dataWithPosts([makePost(1), makePost(2)]) });
  const qdn = await startQdnServer();
  const child = spawn(process.execPath, [path.join(repoRoot, 'bin/qms-host.js')], {
    cwd: repoRoot,
    env: { ...process.env, QMS_DATA_ROOT: dataRoot },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const client = new JsonRpcConnection({ input: child.stdout, output: child.stdin });
  t.after(async () => {
    client.close();
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await wp.close().catch(() => {});
    await qdn.close().catch(() => {});
    await rm(dataRoot, { recursive: true, force: true });
  });

  const info = await client.request('engine.info');
  assert.equal(info.handoffSchema, 'qms-publication-handoff@1');
  assert.equal(info.receiptSchema, 'qms-publication-receipt@1');
  assert.equal(info.maxPublishBatchResources, 20);

  const created = await client.request('project.create', {
    name: 'Host Publication Project',
    source: { adapter: 'wordpress', baseUrl: wp.url },
    target: { qdnName: 'HostPublication' },
    settings: { disk: { reserveBytes: 0, maxBytesPerRun: 0 }, media: { allowLoopback: true } }
  });
  await client.request('project.open', { projectId: created.id });
  await client.request('source.discover', { projectId: created.id, perPage: 50 });
  const plan = await client.request('plan.create', { projectId: created.id, batchSize: 2, estimateMedia: false });
  assert.equal(plan.status, 'completed');
  const selection = plan.plan.entries.filter((entry) => entry.status === 'new').map((entry) => entry.sourceKey);
  const prepared = await client.request('publication.prepare', {
    projectId: created.id,
    planId: plan.planId,
    selection
  });
  assert.equal(prepared.status, 'handoff_ready');
  assert.equal(prepared.packageValidated, true);
  // BUG-002 regression: every prepared resource must carry the publication
  // state the desktop table renders. Older records had only "state", and the
  // renderer crashed with a blank window when status was absent.
  assert.ok(prepared.resources.length > 0);
  for (const resource of prepared.resources) {
    assert.equal(resource.status, 'handoff_ready');
    assert.equal(resource.state, 'handoff_ready');
  }

  const listed = await client.request('publication.list', { projectId: created.id });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].handoffId, prepared.handoffId);
  const detail = await client.request('publication.get', { projectId: created.id, handoffId: prepared.handoffId });
  assert.equal(detail.packageValid, true);
  assert.equal(detail.resources.length, prepared.resources.length);
  const batches = await client.request('publication.batches', { projectId: created.id, handoffId: prepared.handoffId });
  assert.ok(batches.length >= 1);
  assert.ok(batches.every((batch) => batch.length <= 20));

  const receipt = createReceipt({
    handoff: detail.handoff,
    receiptId: 'rcp_host12345678',
    publisher: { accountAddress: 'QZLJV7wbaFyxaoZQsjm6rb9MWMiDzWsqM2', name: 'HostPublication', appVersion: '0.5.0' },
    results: detail.handoff.resources.map((resource) => ({
      resourceId: resource.id,
      service: resource.service,
      name: resource.name,
      identifier: resource.identifier,
      status: 'submitted'
    })),
    createdAt: '2026-11-01T00:00:00.000Z'
  });
  const imported = await client.request('publication.importReceipt', {
    projectId: created.id,
    handoffId: prepared.handoffId,
    receipt
  });
  assert.equal(imported.independentVerificationRequired, true);

  const root = path.join(dataRoot, 'projects', created.id);
  const manifest = JSON.parse(await readFile(path.join(root, prepared.handoffPath, 'handoff.json'), 'utf8'));
  for (const resource of manifest.resources) {
    qdn.set({
      service: resource.service,
      name: resource.name,
      identifier: resource.identifier,
      bytes: await readFile(path.join(root, prepared.handoffPath, resource.relativePath)),
      contentType: resource.contentType
    });
  }
  const verified = await client.request('publication.verify', {
    projectId: created.id,
    handoffId: prepared.handoffId,
    nodeUrl: qdn.url,
    attempts: 1,
    intervalMs: 0
  });
  assert.equal(verified.counts.remote_verified, manifest.resources.length);

  await client.request('project.close', { projectId: created.id });
});
