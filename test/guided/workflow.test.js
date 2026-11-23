import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { startPhase3, makePost } from '../../test-support/phase3/helpers.js';
import { startQdnServer } from '../../test-support/phase5/qdnServer.js';
import { populateQdn, receiptFor } from '../phase7/support.js';
import { WorkflowService, normalizeWorkflowOptions } from '../../lib/engine/workflow.js';
import { createProjectBackup, restoreProjectBackup } from '../../lib/engine/backup.js';
import { createEngine } from '../../lib/engine/index.js';

async function settle(service) { await service.promise; return service.status(); }
test('guided preparation survives reopen and checks publication before advancing the next content group', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(1), makePost(2), makePost(3)], settings: { extra: { website: { cms: 'generic-cms', tagline: 'Guided acceptance' } } } });
  let service = new WorkflowService(env.handle);
  await service.preview({ mode: 'sample', limit: 3, batchSize: 2, contentTypes: ['post'] });
  let state = await settle(service);
  assert.equal(state.status, 'review', JSON.stringify(state));
  assert.equal(state.total, 3);
  await service.prepare(); state = await settle(service);
  assert.equal(state.status, 'ready', JSON.stringify(state));
  assert.equal(state.cursor, 0);
  const zip = unzipSync(await readFile(state.bundle.absolutePath));
  assert.ok(zip['handoff.json']);
  service = new WorkflowService(env.handle);
  assert.equal((await service.status()).handoffId, state.handoffId);
  const node = await startQdnServer(); t.after(() => node.close());
  const handoff = await env.handle.publication.get(state.handoffId);
  const manifest = await populateQdn(node, env, { ...handoff.handoff, handoffPath: (await env.handle.publication.list()).find((entry) => entry.handoffId === state.handoffId).handoffPath });
  const createPlan = env.handle.planning.create.bind(env.handle.planning);
  env.handle.planning.create = async () => { throw new Error('Simulated next-group disk interruption'); };
  await service.verify(node.url, null, receiptFor(manifest, 'guidedfirst'));
  state = await settle(service);
  assert.equal(state.status, 'failed', JSON.stringify(state));
  assert.equal(state.cursor, 2);
  assert.equal(state.handoffId, null);
  await assert.rejects(service.verify(node.url, null, receiptFor(manifest, 'guidedfirst')), /No publication package/);
  env.handle.planning.create = createPlan;
  await service.prepare();
  state = await settle(service);
  assert.equal(state.cursor, 2, JSON.stringify(state));
  assert.equal(state.status, 'ready', JSON.stringify(state));
  assert.equal(state.error, null, JSON.stringify(state));
  assert.equal(state.batchItemCount, 1, JSON.stringify(state));
  assert.notEqual(state.handoffId, handoff.handoffId);
  const second = await env.handle.publication.get(state.handoffId);
  const secondManifest = await populateQdn(node, env, { ...second.handoff, handoffPath: (await env.handle.publication.list()).find((entry) => entry.handoffId === state.handoffId).handoffPath });
  await service.verify(node.url, null, receiptFor(secondManifest, 'guidedsecond'));
  state = await settle(service);
  assert.equal(state.status, 'published', JSON.stringify(state));
  assert.equal(state.cursor, 3);
});

test('full guided selection reads multiple content pages without enumerating the media library', async (t) => {
  const env = await startPhase3(t, { posts: Array.from({ length: 105 }, (_, index) => makePost(index + 1)) });
  const service = new WorkflowService(env.handle);
  await service.preview({ mode: 'archive', contentTypes: ['post'], batchSize: 15 });
  const state = await settle(service);
  assert.equal(state.status, 'review', JSON.stringify(state.error));
  assert.equal(state.total, 105);
  const requests = env.wp.requests;
  assert.ok(!requests.some((request) => /\/media/.test(request.path ?? request.url ?? '') && !(request.query?.include)));
});

test('backup restores the same project identity and refuses to overwrite a current project', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(1)] });
  const root = await mkdtemp(path.join(os.tmpdir(), 'qms-backup-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'project.tar.gz');
  await createProjectBackup(env.handle, file);
  await assert.rejects(restoreProjectBackup(env.dataRoot, file), /already exists/);
  const restoredRoot = path.join(root, 'restored');
  const result = await restoreProjectBackup(restoredRoot, file);
  assert.equal(result.projectId, env.project.id);
  const engine = createEngine({ dataRoot: restoredRoot });
  const restored = await engine.projects.open(result.projectId, { recoverStaleLock: true });
  assert.equal(restored.project.identity.siteId, env.handle.project.identity.siteId);
  await restored.close();
});

test('invalid content scope is rejected before any network operation', () => {
  assert.throws(() => normalizeWorkflowOptions({ mode: 'archive', contentTypes: [] }), /Select posts/);
  assert.throws(() => normalizeWorkflowOptions({ mode: 'range', after: '2026-02-01', before: '2026-01-01' }), /start date/);
  assert.throws(() => normalizeWorkflowOptions({ mode: 'sample', limit: 1001 }), /between 1 and 100/);
});

test('paused archive discovery resumes from its checkpoint without refetching page one', async (t) => {
  const env = await startPhase3(t, { posts: Array.from({ length: 105 }, (_, index) => makePost(index + 1)), wpOptions: { delayMs: 2 } });
  let service = new WorkflowService(env.handle);
  let requested = false;
  const journal = env.handle.runs.journal;
  const originalCheckpoint = journal.onRunCheckpoint.bind(journal);
  journal.onRunCheckpoint = async (checkpoint) => {
    const result = await originalCheckpoint(checkpoint);
    if (!requested && checkpoint.kind === 'source.discover' && checkpoint.step === 'content_page' && checkpoint.cursor >= 100) { requested = true; await service.pause(); }
    return result;
  };
  const options = { mode: 'archive', contentTypes: ['post'], batchSize: 15 };
  await service.preview(options);
  let state = await settle(service);
  journal.onRunCheckpoint = originalCheckpoint;
  assert.equal(requested, true);
  assert.equal(state.status, 'paused', JSON.stringify(state.error));
  const before = env.wp.requests.filter((entry) => entry.path.endsWith('/posts') && entry.query.page === '1').length;
  service = new WorkflowService(env.handle);
  await service.preview(options, null, { resume: true }); state = await settle(service);
  assert.equal(state.status, 'review', JSON.stringify(state.error));
  assert.equal(state.total, 105);
  assert.equal(env.wp.requests.filter((entry) => entry.path.endsWith('/posts') && entry.query.page === '1').length, before);
});

test('an invalid confirmation leaves the existing package available for checking, without regeneration', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(1)] });
  const service = new WorkflowService(env.handle);
  await service.preview({ mode: 'sample', limit: 1 }); await settle(service);
  await service.prepare(); const prepared = await settle(service);
  await service.verify('http://127.0.0.1:1', null, { invalid: true });
  const failed = await settle(service);
  assert.equal(failed.status, 'ready');
  assert.equal(failed.handoffId, prepared.handoffId);
  assert.equal((await env.handle.publication.list()).length, 1);
});

test('a legacy prepared handoff is adopted without replacing its identity or creating a duplicate', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(1)] });
  await env.handle.source.discover({ mode: 'full', contentTypes: ['post'] });
  const plan = await env.handle.planning.create({ batchSize: 1 });
  const handoff = await env.handle.publication.prepare({ planId: plan.planId, selection: plan.plan.entries.filter((entry) => entry.qdn).map((entry) => entry.sourceKey) });
  const service = new WorkflowService(env.handle);
  const adopted = await service.status();
  assert.equal(adopted.status, 'ready');
  assert.equal(adopted.handoffId, handoff.handoffId);
  assert.equal((await env.handle.publication.list()).length, 1);
});

test('article preview returns plain text without fetching embedded images or accepting outside items', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(1, { content: '<p>Hello <strong>reader</strong>.</p><script>dangerous()</script><iframe src="https://example.invalid"></iframe><img src="https://example.invalid/unrequested.png">' })] });
  const service = new WorkflowService(env.handle);
  await service.preview({ mode: 'sample', limit: 1 });
  const state = await settle(service);
  const requests = env.wp.requests.length;
  const item = await service.item(state.sourceKeys[0]);
  assert.match(item.text, /Hello reader/);
  assert.doesNotMatch(item.text, /dangerous|<script|<img|iframe/);
  assert.deepEqual(item.images, []);
  assert.equal(env.wp.requests.length, requests);
  await assert.rejects(service.item('wordpress:post:outside'), /outside/);
});
