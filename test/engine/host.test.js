import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { JsonRpcConnection } from '../../lib/engine/host/client.js';
import { tempDir } from '../../test-support/engine/env.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

async function startHost(t, dataRoot) {
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'bin', 'qms.js'), 'host'], {
    cwd: REPO_ROOT,
    env: { ...process.env, QMS_DATA_ROOT: dataRoot },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  t.after(async () => {
    child.kill('SIGTERM');
  });
  const connection = new JsonRpcConnection({ input: child.stdout, output: child.stdin });
  t.after(() => connection.close());
  return { child, connection, getStderr: () => stderr };
}

test('the stdio host exposes projects, runs and ordered event notifications', async (t) => {
  const dataRoot = await tempDir(t);
  const { connection, getStderr } = await startHost(t, dataRoot);

  const info = await connection.request('engine.info');
  assert.equal(info.apiVersion, 'qms-engine@1');
  assert.equal(info.eventSchema, 'qms-event@1');
  assert.ok(info.eventTypes.includes('operation_cancelled'));

  const project = await connection.request('project.create', {
    name: 'Host Project',
    profileId: 'corbettreport'
  });
  assert.match(project.id, /^prj_/);
  assert.equal(project.resourcePrefix, 'cr');

  const notifications = [];
  connection.onEvent((event) => notifications.push(event));

  const opened = await connection.request('project.open', { projectId: project.id });
  assert.equal(opened.project.name, 'Host Project');
  assert.equal(opened.snapshot.storage.storeVersion, 1);

  const result = await connection.request('project.validate', { projectId: project.id });
  assert.equal(result.status, 'completed');

  // All validate events arrive as qms.event notifications before the response.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(notifications.length >= 6, getStderr());
  const seqs = notifications.map((event) => event.seq);
  assert.deepEqual(seqs, [...seqs].sort((left, right) => left - right));
  assert.equal(new Set(seqs).size, seqs.length);
  const types = new Set(notifications.map((event) => event.type));
  assert.ok(types.has('operation_started'));
  assert.ok(types.has('progress_updated'));
  assert.ok(types.has('operation_completed'));
  assert.ok(types.has('state_snapshot'));

  const progress = await connection.request('run.progress', {
    projectId: project.id,
    runId: result.runId
  });
  assert.equal(progress.state, 'completed');
  assert.deepEqual(progress.progress, { completed: 3, total: 3, bytes: 0 });

  const compacted = await connection.request('state.compact', { projectId: project.id });
  assert.equal(compacted.compacted, true);

  const closed = await connection.request('project.close', { projectId: project.id });
  assert.equal(closed.closed, true);

  await assert.rejects(
    () => connection.request('guild.unknown', {}),
    (error) => error.code === 'UNKNOWN_METHOD'
  );

  const reopened = await connection.request('project.open', { projectId: project.id });
  assert.equal(reopened.snapshot.runs.length, 1);
  assert.equal(reopened.snapshot.runs[0].state, 'completed');
  await connection.request('project.close', { projectId: project.id });
});

test('the host rejects malformed requests and invalid project ids', async (t) => {
  const dataRoot = await tempDir(t);
  const { connection, child } = await startHost(t, dataRoot);
  await assert.rejects(
    () => connection.request('project.get', { projectId: '../../etc' }),
    (error) => error.code === 'INVALID_PROJECT_ID'
  );
  child.stdin.write('{not json\n');
  await new Promise((resolve) => setTimeout(resolve, 100));
  // A parse error must not kill the host.
  const info = await connection.request('engine.info');
  assert.equal(info.apiVersion, 'qms-engine@1');
});
