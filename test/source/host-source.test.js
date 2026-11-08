import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { JsonRpcConnection } from '../../lib/engine/host/client.js';
import { startWordpressFixtureServer } from '../../test-support/wordpress/fixtureServer.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

async function startHost(t) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'qms-host-source-'));
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'bin', 'qms.js'), 'host'], {
    cwd: REPO_ROOT,
    env: { ...process.env, QMS_DATA_ROOT: dataRoot },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const connection = new JsonRpcConnection({ input: child.stdout, output: child.stdin });
  t.after(async () => {
    connection.close();
    child.kill('SIGTERM');
    await rm(dataRoot, { recursive: true, force: true });
  });
  return { dataRoot, child, connection };
}

test('the host exposes source adapters, validation and discovery', async (t) => {
  const server = await startWordpressFixtureServer();
  t.after(() => server.close());
  const { connection } = await startHost(t);

  const info = await connection.request('engine.info');
  assert.equal(info.sourceContract, 'qms-source-adapter@1');
  assert.equal(info.contentSchema, 'qms-content@1');
  assert.equal(info.adapters[0].id, 'wordpress');

  const adapters = await connection.request('source.list');
  assert.deepEqual(adapters.map((adapter) => adapter.id), ['wordpress']);
  const capabilities = await connection.request('source.capabilities', { adapterId: 'wordpress' });
  assert.deepEqual(capabilities.capabilities.contentTypes, ['post', 'page']);

  const project = await connection.request('project.create', {
    name: 'Host Source',
    source: { adapter: 'wordpress', baseUrl: server.url }
  });
  await connection.request('project.open', { projectId: project.id });

  const validation = await connection.request('source.validate', { projectId: project.id });
  assert.equal(validation.status, 'completed');
  assert.equal(validation.report.site.name, 'Fixture News');

  const notifications = [];
  connection.onEvent((event) => notifications.push(event));
  const discovery = await connection.request('source.discover', {
    projectId: project.id,
    mode: 'full',
    perPage: 2,
    progressEvery: 1,
    maxItems: 4
  });
  assert.equal(discovery.status, 'completed');
  assert.equal(discovery.summary.items, 4);
  assert.equal(discovery.summary.truncated, true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(notifications.length > 0);
  const seqs = notifications.map((event) => event.seq);
  assert.deepEqual(seqs, [...seqs].sort((left, right) => left - right));
  const progress = await connection.request('run.progress', { projectId: project.id, runId: discovery.runId });
  assert.equal(progress.state, 'completed');

  const events = await connection.request('run.events', { projectId: project.id, runId: discovery.runId });
  assert.ok(events.some((event) => event.code === 'SOURCE_PROGRESS'));
});
