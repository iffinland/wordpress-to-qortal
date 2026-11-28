import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startPhase3, makePost, dataWithPosts } from '../../test-support/phase3/helpers.js';
import { createFixedClock } from '../../lib/engine/clock.js';
import { WorkflowService } from '../../lib/engine/workflow.js';
import { reviewDestination, approveDestination } from '../../lib/engine/destination.js';
import { createProjectBackup, restoreProjectBackup } from '../../lib/engine/backup.js';
import { createEngine } from '../../lib/engine/index.js';
const settle = async workflow => { await workflow.promise; return workflow.status(); };

test('an automatic update after six offline days includes changes since the previous successful check', async t => {
  const e = await startPhase3(t, { posts: [makePost(1)] });
  const clock = createFixedClock('2026-11-20T12:00:00Z'); e.handle.sync.clock = clock;
  const first = await e.handle.sync.check({ mode: 'full' });
  await e.handle.sync.preparePlan({ scanId: first.scanId, estimateMedia: false });
  e.wp.data.posts[0].content = '<p>Changed while the operator was offline</p>';
  e.wp.data.posts[0].modified = e.wp.data.posts[0].modified_gmt = '2026-11-21T12:00:00';
  clock.set('2026-11-26T12:00:00Z');
  const next = await e.handle.sync.check({ mode: 'auto' });
  assert.equal(next.status, 'completed'); assert.equal(next.counts.modified, 1);
  assert.equal(next.query.modified_after, '2026-11-18T12:00:00.000Z');
});

test('an unfinished public item remains actionable after a repeated update check', async t => {
  const e = await startPhase3(t, { posts: [makePost(1)] });
  const scan = await e.handle.sync.check({ mode: 'full' });
  await e.handle.sync.preparePlan({ scanId: scan.scanId, estimateMedia: false });
  const next = await e.handle.sync.check({ mode: 'full' }); assert.equal(next.counts.unpublished, 1);
  const plan = await e.handle.sync.preparePlan({ scanId: next.scanId, planning: { includeReserved: true }, estimateMedia: false });
  assert.equal(plan.stats.selected, 1); assert.notEqual(plan.noChanges, true);
});

test('guided updates download new media and create a complete publication bundle', async t => {
  const e = await startPhase3(t, { mediaServer: true, dataFactory: ({ mediaUrl }) => dataWithPosts([makePost(1, { content: '<p>Update</p><img src="' + mediaUrl + '/media/known/a.jpg?bytes=2048">' })]), settings: { media: { allowExternalMedia: true } } });
  const workflow = new WorkflowService(e.handle);
  await workflow.preview({ mode: 'updates', contentTypes: ['post'] });
  const reviewed = await settle(workflow); assert.equal(reviewed.status, 'review'); assert.equal(reviewed.total, 1);
  await workflow.prepare(); const ready = await settle(workflow);
  assert.equal(ready.status, 'ready', ready.error?.message); assert.ok(ready.bundle.bytes > 0);
  const detail = await e.handle.publication.get(ready.handoffId); assert.ok(detail.resources.some(resource => resource.kind === 'media'));
});

test('guided status finds a package created from the technical view after a guided review', async t => {
  const e = await startPhase3(t, { posts: [makePost(1)] }); const workflow = new WorkflowService(e.handle);
  await workflow.preview({ mode: 'sample', limit: 1 }); await settle(workflow);
  const plan = await e.handle.planning.create({ batchSize: 1 });
  const handoff = await e.handle.publication.prepare({ planId: plan.planId, selection: plan.plan.entries.filter(entry => entry.qdn).map(entry => entry.sourceKey) });
  const state = await workflow.status(); assert.equal(state.status, 'ready'); assert.equal(state.handoffId, handoff.handoffId);
  await assert.rejects(workflow.reset(), /existing publication/);
});

test('archive, reactivate, remove and restore keep the exact project and site identities', async t => {
  const e = await startPhase3(t, { posts: [makePost(1)] }); const id = e.project.id; const identity = e.handle.project.identity;
  await e.handle.close(); await e.engine.projects.archive(id);
  assert.equal((await e.engine.projects.list()).length, 0);
  await e.engine.projects.unarchive(id); assert.deepEqual((await e.engine.projects.get(id)).project.identity, identity);
  await e.engine.projects.archive(id, { deleteLocalData: true });
  const trash = await e.engine.projects.listTrash(); assert.equal(trash.length, 1);
  await e.engine.projects.restoreTrash(trash[0].trashId);
  assert.equal((await e.engine.projects.list())[0].id, id); assert.deepEqual((await e.engine.projects.get(id)).project.identity, identity);
  assert.equal((await e.engine.projects.listTrash()).length, 0);
});

test('permanent deletion needs the exact local project name and cannot escape the trash folder', async t => {
  const e = await startPhase3(t); await e.handle.close();
  await e.engine.projects.archive(e.project.id, { deleteLocalData: true }); const [item] = await e.engine.projects.listTrash();
  await assert.rejects(e.engine.projects.purgeTrash(item.trashId, 'wrong'), /exact project name/);
  await assert.rejects(e.engine.projects.restoreTrash('../projects'), /Invalid deleted project/);
  await e.engine.projects.purgeTrash(item.trashId, item.name); assert.equal((await e.engine.projects.listTrash()).length, 0);
});

test('a prepared backup reopens in a different workspace without changing its handoff identity', async t => {
  const e = await startPhase3(t, { posts: [makePost(1)] }); const workflow = new WorkflowService(e.handle);
  await workflow.preview({ mode: 'sample', limit: 1 }); await settle(workflow); await workflow.prepare(); const prepared = await settle(workflow);
  const root = await mkdtemp(path.join(os.tmpdir(), 'qms-continuation-')); const file = path.join(root, 'backup.gz');
  try {
    await createProjectBackup(e.handle, file); await assert.rejects(restoreProjectBackup(e.dataRoot, file), /already exists/);
    const dest = path.join(root, 'restored'); await restoreProjectBackup(dest, file); const engine = createEngine({ dataRoot: dest });
    try { const handle = await engine.projects.open(e.project.id); const state = await new WorkflowService(handle).status(); assert.equal(state.handoffId, prepared.handoffId); assert.ok(state.bundle.absolutePath.startsWith(dest)); }
    finally { await engine.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('separate projects can share a source but a shared website address needs explicit destination approval', async t => {
  const e = await startPhase3(t, { posts: [makePost(1)], settings: { extra: { website: { cms: 'generic-cms', service: 'APP' } } } });
  const second = await e.engine.projects.create({ name: 'Another independent archive', source: e.handle.project.source, target: e.handle.project.target, settings: e.handle.project.settings });
  assert.notEqual(second.siteId, e.project.siteId);
  await e.handle.source.discover({ mode: 'full', contentTypes: ['post'] }); const plan = await e.handle.planning.create({ batchSize: 1 });
  const options = { planId: plan.planId, selection: plan.plan.entries.filter(entry => entry.qdn).map(entry => entry.sourceKey) };
  await assert.rejects(e.handle.publication.prepare(options), /Another local project/);
  const review = await reviewDestination(e.handle); assert.equal(review.remote.status, 'unknown'); assert.equal(review.needsConfirmation, true);
  await assert.rejects(approveDestination(e.handle, 'stale'), /changed/);
  await approveDestination(e.handle, review.token); const prepared = await e.handle.publication.prepare(options); assert.ok(prepared.handoffId);
});

test('changing a source URL with existing imported identities is refused without altering the project', async t => {
  const e = await startPhase3(t, { posts: [makePost(1)] }); await e.handle.source.discover({ mode: 'full' }); await e.handle.planning.create({ batchSize: 1 });
  await assert.rejects(e.handle.update({ source: { baseUrl: 'https://another.example' } }), /independent project/);
  assert.equal(e.handle.project.source.baseUrl, e.wp.url);
});

test('a never-submitted package can be explicitly set aside to correct its Qortal destination', async t => {
  const e = await startPhase3(t, { posts: [makePost(1)] }); const workflow = new WorkflowService(e.handle);
  await workflow.preview({ mode: 'sample', limit: 1 }); await settle(workflow); await workflow.prepare(); const ready = await settle(workflow);
  await assert.rejects(workflow.discard({ handoffId: ready.handoffId }), /Confirm/);
  await workflow.discard({ handoffId: ready.handoffId, notSubmitted: true });
  await assert.rejects(e.handle.publication.exportBundle(ready.handoffId), /superseded/i);
  const preview = await e.handle.identity.migrationPreview({ target: { qdnName: 'CorrectedDestination' } });
  await e.handle.identity.applyMigration({ token: preview.token });
  await workflow.preview({ mode: 'updates' }); const review = await settle(workflow);
  assert.equal(review.status, 'review'); assert.equal(review.total, 1);
  await workflow.prepare(); const next = await settle(workflow); assert.equal(next.status, 'ready', next.error?.message);
  assert.notEqual(next.handoffId, ready.handoffId);
  const detail = await e.handle.publication.get(next.handoffId); assert.ok(detail.resources.every(resource => resource.name === 'CorrectedDestination'));
});

test('a package with submission evidence cannot be set aside as never submitted', async t => {
  const e = await startPhase3(t, { posts: [makePost(1)] }); const workflow = new WorkflowService(e.handle);
  await workflow.preview({ mode: 'sample', limit: 1 }); await settle(workflow); await workflow.prepare(); const ready = await settle(workflow);
  await e.handle.store.transaction(draft => { draft.publication.handoffs[ready.handoffId].resources[0].txSignature = 'known-submission'; });
  await assert.rejects(workflow.discard({ handoffId: ready.handoffId, notSubmitted: true }), /publication evidence/);
});

test('cancelling a guided check preserves the project and offers a fresh selection', async t => {
  const e = await startPhase3(t, { posts: Array.from({ length: 105 }, (_, i) => makePost(i + 1)), wpOptions: { delayMs: 2 } });
  const workflow = new WorkflowService(e.handle);
  const journal = e.handle.runs.journal; const checkpoint = journal.onRunCheckpoint.bind(journal); let cancelled = false;
  journal.onRunCheckpoint = async value => { const result = await checkpoint(value); if (!cancelled && value.kind === 'source.discover' && value.cursor >= 100) { cancelled = true; await workflow.cancel(); } return result; };
  await workflow.preview({ mode: 'archive' }); const stopped = await settle(workflow); assert.equal(cancelled, true); assert.equal(stopped.status, 'cancelled');
  journal.onRunCheckpoint = checkpoint;
  assert.equal((await e.engine.projects.get(e.project.id)).project.id, e.project.id);
  await workflow.preview({ mode: 'sample', limit: 1 }); assert.equal((await settle(workflow)).status, 'review');
});

test('a stale restore staging folder cannot break listing real projects', async t => {
  const e = await startPhase3(t); const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(e.dataRoot, 'projects', '.restore-interrupted'));
  assert.equal((await e.engine.projects.list())[0].id, e.project.id);
});

test('a submitted legacy package is offered for exact checking without exporting or preparing it again', async t => {
  const { receiptFor, populateQdn } = await import('../phase7/support.js');
  const { startQdnServer } = await import('../../test-support/phase5/qdnServer.js');
  const { rm } = await import('node:fs/promises');
  const e = await startPhase3(t, { posts: [makePost(1)] }); const first = new WorkflowService(e.handle);
  await first.preview({ mode: 'sample', limit: 1 }); await settle(first); await first.prepare(); const prepared = await settle(first);
  const detail = await e.handle.publication.get(prepared.handoffId);
  await e.handle.publication.importReceipt({ handoffId: prepared.handoffId, receipt: receiptFor(detail.handoff, 'legacycheck') });
  await rm(path.join(e.handle.paths.root, 'workflow.json'));
  let exported = false; e.handle.publication.exportBundle = async () => { exported = true; throw new Error('Must not re-export a submitted package'); };
  const workflow = new WorkflowService(e.handle); const state = await workflow.status();
  assert.equal(state.status, 'attention'); assert.equal(state.handoffId, prepared.handoffId); assert.equal(state.bundle, null); assert.equal(exported, false);
  await assert.rejects(workflow.preview({ mode: 'sample', limit: 1 }), /Finish or verify/);
  const node = await startQdnServer(); t.after(() => node.close());
  const handoff = (await e.handle.publication.list()).find(entry => entry.handoffId === state.handoffId);
  await populateQdn(node, e, handoff);
  await workflow.verify(node.url); const verified = await settle(workflow);
  assert.equal(verified.status, 'published'); assert.equal(exported, false); assert.equal((await e.handle.publication.list()).length, 1);
});
