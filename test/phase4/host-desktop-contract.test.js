import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcConnection } from '../../lib/engine/host/client.js';
import { ENGINE_VERSION } from '../../lib/engine/index.js';
import { startWordpressFixtureServer, createFixtureData } from '../../test-support/wordpress/fixtureServer.js';
import { makePost, dataWithPosts } from '../../test-support/phase3/helpers.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the desktop host contract exposes only engine methods and validates target input', async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'qms-host-desktop-'));
  const wp = await startWordpressFixtureServer({ data: dataWithPosts([makePost(1)]) });
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
    await rm(dataRoot, { recursive: true, force: true });
  });

  const info = await client.request('engine.info');
  assert.equal(info.apiVersion, 'qms-engine@1');
  assert.equal(info.version, ENGINE_VERSION);
  assert.ok(info.adapters.some((adapter) => adapter.id === 'wordpress'));

  await assert.rejects(
    () => client.request('shell.exec', { command: 'id' }),
    (error) => error.code === 'UNKNOWN_METHOD'
  );

  const created = await client.request('project.create', {
    name: 'Desktop Contract Project',
    source: { adapter: 'wordpress', baseUrl: wp.url },
    target: { qdnName: 'DesktopContract' }
  });
  assert.match(created.id, /^prj_/);
  assert.match(created.siteId, /^site_/);

  const opened = await client.request('project.open', { projectId: created.id });
  assert.equal(opened.project.id, created.id);
  assert.equal(opened.snapshot.identity.siteId, created.siteId);

  const valid = await client.request('identity.validateTarget', { target: { qdnName: 'ValidName' } });
  assert.equal(valid.qdnName, 'ValidName');
  await assert.rejects(
    () => client.request('identity.validateTarget', { target: { qdnName: 'x' } }),
    (error) => error.code === 'TARGET_NAME_INVALID'
  );

  const disk = await client.request('disk.check', { projectId: created.id, knownBytes: 1024, disk: { reserveBytes: 0, maxBytesPerRun: 0 } });
  assert.equal(disk.fits, true);
  assert.ok(disk.availableBytes > 0);

  const events = [];
  const unsubscribe = client.onEvent((event) => events.push(event));
  const validation = await client.request('source.validate', { projectId: created.id, adapterId: 'wordpress' });
  assert.equal(validation.status, 'completed');
  assert.equal(validation.report.ok, true);
  assert.ok(events.some((event) => event.type === 'operation_started'));
  assert.ok(events.some((event) => event.type === 'operation_completed'));
  unsubscribe();

  const closed = await client.request('project.close', { projectId: created.id });
  assert.equal(closed.closed, true);
});
