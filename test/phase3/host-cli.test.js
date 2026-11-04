import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { JsonRpcConnection } from '../../lib/engine/host/client.js';
import { startWordpressFixtureServer } from '../../test-support/wordpress/fixtureServer.js';
import { startMediaServer } from '../../test-support/media/server.js';
import { makePost, dataWithPosts } from '../../test-support/phase3/helpers.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

function postsWithMedia(mediaUrl, count = 2) {
  return dataWithPosts(Array.from({ length: count }, (_, index) => {
    const pathName = index % 2 === 0 ? '/media/known/alpha.jpg' : '/media/known/beta.png';
    return makePost(index, {
      content: '<p>Media ' + index + '</p><img src="' + mediaUrl + pathName + '?bytes=1024&p=' + index + '">'
    });
  }));
}

async function startHost(t) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'qms-host-phase3-'));
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'bin', 'qms.js'), 'host'], {
    cwd: REPO_ROOT,
    env: { ...process.env, QMS_DATA_ROOT: dataRoot },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const connection = new JsonRpcConnection({ input: child.stdout, output: child.stdin });
  t.after(async () => {
    connection.close();
    child.kill('SIGTERM');
    await rm(dataRoot, { recursive: true, force: true });
  });
  return { dataRoot, child, connection, getStderr: () => stderr };
}

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, 'bin', 'qms.js'), ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

test('the host exposes identity, planning, media download and inspection', async (t) => {
  const media = await startMediaServer();
  t.after(() => media.close());
  const wp = await startWordpressFixtureServer({ data: postsWithMedia(media.url, 2) });
  t.after(() => wp.close());
  const { connection, getStderr } = await startHost(t);

  const info = await connection.request('engine.info');
  assert.equal(info.planSchema, 'qms-plan@1');
  assert.equal(info.identitySchema, 'qms-identity-state@1');

  const project = await connection.request('project.create', {
    name: 'Host Phase 3',
    source: { adapter: 'wordpress', baseUrl: wp.url },
    target: { qdnName: 'HostSyntheticSite' },
    settings: {
      disk: { reserveBytes: 0, maxBytesPerRun: 0 },
      media: { allowLoopback: true, allowExternalMedia: true, maxRetries: 0, retryDelayMs: 0 }
    }
  });
  const opened = await connection.request('project.open', { projectId: project.id });
  assert.match(opened.snapshot.identity.siteId, /^site_/);

  const notifications = [];
  connection.onEvent((event) => notifications.push(event));
  const discovery = await connection.request('source.discover', {
    projectId: project.id,
    perPage: 10
  });
  assert.equal(discovery.status, 'completed');

  const plan = await connection.request('plan.create', {
    projectId: project.id,
    batchSize: 2,
    estimateMedia: true
  });
  assert.equal(plan.status, 'completed', getStderr());
  assert.equal(plan.stats.selected, 2);
  assert.equal(plan.media.knownCount, 2);

  const loaded = await connection.request('plan.get', { projectId: project.id, planId: plan.planId });
  assert.equal(loaded.plan.planId, plan.planId);
  assert.equal((await connection.request('plan.list', { projectId: project.id })).length, 1);

  const download = await connection.request('media.download', {
    projectId: project.id,
    planId: plan.planId,
    concurrency: 2
  });
  assert.equal(download.status, 'completed', getStderr());
  assert.equal(download.counts.verified, 2);
  const inspection = await connection.request('media.inspect', { projectId: project.id });
  assert.equal(inspection.totals.assets, 2);
  assert.equal(inspection.downloads.verified, 2);

  const identity = await connection.request('identity.get', { projectId: project.id });
  assert.equal(identity.identity.siteId, opened.snapshot.identity.siteId);
  assert.equal(identity.identity.mappingCount, 2);
  assert.equal(identity.mappings.length, 2);

  await new Promise((resolve) => setTimeout(resolve, 100));
  const seqs = notifications.map((event) => event.seq);
  assert.deepEqual(seqs, [...seqs].sort((left, right) => left - right));
  assert.equal(new Set(seqs).size, seqs.length);
  assert.ok(notifications.some((event) => event.code === 'PLAN_SELECTED'));
  assert.ok(notifications.some((event) => event.code === 'MEDIA_VERIFIED'));
});

test('the qms CLI exposes identity, plan, media and disk commands', async (t) => {
  const media = await startMediaServer();
  t.after(() => media.close());
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'qms-cli-phase3-'));
  const wp = await startWordpressFixtureServer({ data: postsWithMedia(media.url, 2) });
  t.after(async () => {
    await wp.close();
    await rm(dataRoot, { recursive: true, force: true });
  });
  const env = { QMS_DATA_ROOT: dataRoot };

  const created = await runCli([
    'project', 'create', '--name', 'CLI Phase 3', '--source-url', wp.url,
    '--qdn-name', 'CliSyntheticSite', '--batch-size', '2', '--json'
  ], env);
  assert.equal(created.code, 0, created.stderr);
  const project = JSON.parse(created.stdout);
  assert.match(project.siteId, /^site_/);

  const discovery = await runCli(['source', 'discover', project.id, '--per-page', '10', '--json'], env);
  assert.equal(discovery.code, 0, discovery.stderr);

  const planResult = await runCli([
    'plan', 'create', project.id, '--batch-size', '2', '--reserve-gib', '0',
    '--allow-external', '--allow-loopback', '--json'
  ], env);
  assert.equal(planResult.code, 0, planResult.stderr);
  const plan = JSON.parse(planResult.stdout);
  assert.equal(plan.status, 'completed');
  assert.equal(plan.stats.selected, 2);

  const planGet = await runCli(['plan', 'get', project.id, plan.planId, '--json'], env);
  assert.equal(planGet.code, 0, planGet.stderr);
  assert.equal(JSON.parse(planGet.stdout).plan.planId, plan.planId);

  const download = await runCli([
    'media', 'download', project.id, '--plan', plan.planId, '--reserve-gib', '0',
    '--allow-external', '--allow-loopback', '--concurrency', '2', '--json'
  ], env);
  assert.equal(download.code, 0, download.stderr);
  assert.equal(JSON.parse(download.stdout).status, 'completed');

  const inspect = await runCli(['media', 'inspect', project.id, '--json'], env);
  assert.equal(inspect.code, 0, inspect.stderr);
  assert.equal(JSON.parse(inspect.stdout).totals.assets, 2);

  const identity = await runCli(['identity', 'show', project.id, '--json'], env);
  assert.equal(identity.code, 0, identity.stderr);
  assert.equal(JSON.parse(identity.stdout).identity.mappingCount, 2);

  const disk = await runCli(['disk', 'check', project.id, '--reserve-gib', '0', '--json'], env);
  assert.equal(disk.code, 0, disk.stderr);
  assert.equal(JSON.parse(disk.stdout).fits, true);

  const plans = await runCli(['plan', 'list', project.id, '--json'], env);
  assert.equal(plans.code, 0, plans.stderr);
  assert.equal(JSON.parse(plans.stdout).length, 1);
});
