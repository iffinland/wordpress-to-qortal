import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createEngine } from '../../lib/engine/index.js';
import { startPhase7, fullScan, makeSyncPost, publishAndVerify, recentIso } from './support.js';

function projectRoot(env) {
  return env.engine.projects.paths(env.project.id).root;
}

test('full scan records explicit evidence, a watermark, a report and a catalog', async (t) => {
  const env = await startPhase7(t);
  const scan = await fullScan(env.handle);
  assert.equal(scan.status, 'completed');
  assert.equal(scan.complete, true);
  assert.equal(scan.planningAllowed, true);
  assert.equal(scan.counts.new, 3);
  assert.equal(scan.counts.scanned, 3);
  assert.equal(scan.noChanges, false);
  assert.ok(scan.reportPath);
  assert.ok(scan.catalogPath);
  const report = JSON.parse(await readFile(path.join(projectRoot(env), scan.reportPath), 'utf8'));
  assert.equal(report.schema, 'qms-sync-report@1');
  assert.equal(report.networkDeleted, false);
  assert.equal(report.counts.new, 3);
  const catalog = JSON.parse(await readFile(path.join(projectRoot(env), scan.catalogPath), 'utf8'));
  assert.equal(catalog.schema, 'qms-sync-catalog@1');
  assert.equal(catalog.sourceScanId, scan.scanId);
  assert.equal(catalog.networkDeleted, false);

  const status = await env.handle.sync.status();
  const mark = status.watermarks.wordpress;
  assert.equal(mark.scanId, scan.scanId);
  assert.equal(mark.mode, 'full');
  assert.ok(mark.lastCompletedAt);
  assert.ok(mark.fullCompletedAt);
  assert.equal(status.hasCompletedFullScan, true);

  await env.handle.close();
  const restarted = createEngine({ dataRoot: env.dataRoot });
  const reopened = await restarted.projects.open(env.project.id);
  t.after(() => reopened.close().catch(() => {}));
  const history = await reopened.sync.history();
  assert.equal(history.length, 1);
  assert.equal(history[0].scanId, scan.scanId);
  assert.equal(history[0].status, 'completed');
  const reloaded = await reopened.sync.get(scan.scanId);
  assert.equal(reloaded.counts.new, 3);
  assert.equal(reloaded.reportPath, scan.reportPath);
});

test('AC7.1/AC7.3 a new post is published once and unchanged posts are not republished', async (t) => {
  const env = await startPhase7(t, { posts: [makeSyncPost(1), makeSyncPost(2)] });
  const scan = await fullScan(env.handle);
  assert.equal(scan.counts.new, 2);
  const plan = await env.handle.sync.preparePlan({ scanId: scan.scanId, estimateMedia: false });
  assert.equal(plan.status, 'completed');
  assert.equal(plan.stats.selected, 2);
  const selection = plan.plan.entries
    .filter((entry) => ['new', 'modified', 'route_changed', 'reserved'].includes(entry.status))
    .map((entry) => entry.sourceKey);
  assert.equal(selection.length, 2);
  const published = await publishAndVerify(t, env, plan.plan, selection);
  assert.equal(published.verified.counts.remote_verified, published.verified.resources.length);
  assert.equal(env.handle.identity.mappingFor('post:1001').publicationStatus, 'remote_verified');

  const second = await env.handle.sync.check({ mode: 'incremental' });
  assert.equal(second.status, 'completed', JSON.stringify(second));
  assert.equal(second.counts.new, 0);
  assert.equal(second.counts.modified, 0);
  assert.equal(second.counts.unchanged, 2);
  assert.ok(second.delta.unchanged.every((entry) => entry.reason === 'NOT_MODIFIED_SINCE_WATERMARK'));
  const noPlan = await env.handle.sync.preparePlan({ scanId: second.scanId, estimateMedia: false });
  assert.equal(noPlan.planId, null);
  assert.equal(noPlan.noChanges, true);

  env.wp.data.posts.push(makeSyncPost(4, {
    date: recentIso(-2 * 60 * 60 * 1000),
    date_gmt: recentIso(-2 * 60 * 60 * 1000),
    modified: recentIso(-60 * 60 * 1000),
    modified_gmt: recentIso(-60 * 60 * 1000)
  }));
  const third = await env.handle.sync.check({ mode: 'incremental' });
  assert.equal(third.status, 'completed', JSON.stringify(third));
  assert.equal(third.counts.new, 1);
  assert.equal(third.counts.unchanged, 2);
  assert.equal(third.delta.new[0].sourceKey, 'post:1004');
  const thirdPlan = await env.handle.sync.preparePlan({ scanId: third.scanId, estimateMedia: false });
  assert.equal(thirdPlan.stats.selected, 1);
  assert.equal(thirdPlan.plan.entries[0].sourceKey, 'post:1004');
});

test('AC7.2 a modified old post is detected regardless of its publication date', async (t) => {
  const env = await startPhase7(t, {
    posts: [makeSyncPost(1, {
      date: '2020-01-01T00:00:00',
      date_gmt: '2020-01-01T00:00:00',
      modified: '2020-01-02T00:00:00',
      modified_gmt: '2020-01-02T00:00:00'
    })]
  });
  const scan = await fullScan(env.handle);
  assert.equal(scan.counts.new, 1);
  await env.handle.sync.preparePlan({ scanId: scan.scanId, estimateMedia: false });

  env.wp.data.posts[0].content = '<p>This old post was edited later.</p>';
  env.wp.data.posts[0].modified = recentIso(-30 * 60 * 1000);
  env.wp.data.posts[0].modified_gmt = recentIso(-30 * 60 * 1000);

  const incremental = await env.handle.sync.check({ mode: 'incremental' });
  assert.equal(incremental.status, 'completed', JSON.stringify(incremental));
  assert.equal(incremental.counts.modified, 1);
  assert.equal(incremental.delta.modified[0].sourceKey, 'post:1001');
  assert.equal(incremental.delta.modified[0].reason, 'SOURCE_CONTENT_CHANGED');
  assert.equal(incremental.query.modified_after !== undefined, true);
  const plan = await env.handle.sync.preparePlan({ scanId: incremental.scanId, estimateMedia: false });
  assert.equal(plan.stats.modified, 1);
  assert.equal(plan.stats.selected, 1);
});

test('AC7.4/AC7.5 withdrawal is local only, audited, excluded from the catalog and never claims a network delete', async (t) => {
  const env = await startPhase7(t);
  const first = await fullScan(env.handle);
  await env.handle.sync.preparePlan({ scanId: first.scanId, estimateMedia: false });
  const mappingBefore = { ...env.handle.identity.mappingFor('post:1001') };

  env.wp.data.posts = env.wp.data.posts.filter((post) => post.id !== 1001);
  const second = await fullScan(env.handle);
  assert.equal(second.status, 'completed');
  assert.equal(second.counts.withdrawn, 1);
  assert.equal(second.withdrawals.appliedCount, 1);
  assert.equal(second.withdrawals.networkDeleted, false);
  assert.equal(second.withdrawals.qdnDataPreserved, true);

  const mappingAfter = env.handle.identity.mappingFor('post:1001');
  assert.equal(mappingAfter.status, 'withdrawn');
  assert.equal(mappingAfter.service, mappingBefore.service);
  assert.equal(mappingAfter.name, mappingBefore.name);
  assert.equal(mappingAfter.identifier, mappingBefore.identifier);
  assert.equal(mappingAfter.contentHash, mappingBefore.contentHash);

  const withdrawals = await env.handle.sync.withdrawalList();
  assert.equal(withdrawals.length, 1);
  assert.equal(withdrawals[0].networkDeleted, false);
  assert.equal(withdrawals[0].qdnDataPreserved, true);
  assert.ok(withdrawals[0].history.some((entry) => entry.action === 'withdraw_local'));

  const visible = await env.handle.sync.catalog({ includeWithdrawn: false });
  assert.equal(visible.length, 2);
  assert.equal((await env.handle.sync.catalog({ includeWithdrawn: true })).length, 3);
  const catalog = JSON.parse(await readFile(path.join(projectRoot(env), second.catalogPath), 'utf8'));
  assert.equal(catalog.counts.visible, 2);
  assert.equal(catalog.counts.withdrawn, 1);
  assert.equal(catalog.networkDeleted, false);

  await assert.rejects(
    () => env.handle.sync.preparePlan({ scanId: second.scanId, selection: ['post:1001'], estimateMedia: false }),
    (error) => error.code === 'PUBLICATION_CONFLICT'
  );

  const tombstones = await env.handle.sync.prepareTombstones({ scanId: second.scanId, note: 'Operator selected a prepared marker.' });
  assert.equal(tombstones.preparedCount, 1);
  assert.equal(tombstones.published, false);
  assert.equal(tombstones.networkDeleted, false);
  const tombstone = JSON.parse(await readFile(path.join(projectRoot(env), tombstones.prepared[0].relativePath), 'utf8'));
  assert.equal(tombstone.schema, 'qms-tombstone@1');
  assert.equal(tombstone.networkDeleted, false);
  assert.match(tombstone.notice, /does not delete or modify/);
});

test('unpublished source status is detected, withdrawn locally and hidden from the catalog', async (t) => {
  const env = await startPhase7(t, { posts: [makeSyncPost(1), makeSyncPost(2)] });
  const first = await fullScan(env.handle);
  await env.handle.sync.preparePlan({ scanId: first.scanId, estimateMedia: false });
  env.wp.data.posts[1].status = 'draft';
  const second = await fullScan(env.handle, { query: { status: 'publish,draft' } });
  assert.equal(second.status, 'completed');
  // A status filter is scoped: observed status changes may withdraw, but the
  // scan has no missing-item authority and must not advance the watermark.
  assert.equal(second.scope.coverage, 'scoped');
  assert.equal(second.withdrawalEligible, false);
  assert.equal(second.watermarkAdvanced, false);
  assert.equal(second.counts.unpublished >= 1, true);
  assert.equal(second.counts.withdrawn, 1);
  assert.equal(second.delta.unpublished.some((entry) => entry.sourceKey === 'post:1002' && entry.reason === 'SOURCE_STATUS_DRAFT'), true);
  assert.equal(second.delta.withdrawn[0].sourceKey, 'post:1002');
  assert.equal(second.delta.withdrawn[0].reason, 'SOURCE_STATUS_DRAFT');
  assert.equal(env.handle.identity.mappingFor('post:1002').status, 'withdrawn');
  const withdrawals = await env.handle.sync.withdrawalList();
  assert.equal(withdrawals.some((entry) => entry.sourceKey === 'post:1002' && entry.reason === 'SOURCE_STATUS_DRAFT'), true);
  assert.equal(withdrawals.every((entry) => entry.networkDeleted === false), true);
  const visible = await env.handle.sync.catalog({ includeWithdrawn: false });
  assert.deepEqual(visible.map((entry) => entry.sourceKey), ['post:1001']);
});

test('withdrawal review policy leaves the mapping active and records a blocking conflict', async (t) => {
  const env = await startPhase7(t);
  const first = await fullScan(env.handle);
  await env.handle.sync.preparePlan({ scanId: first.scanId, estimateMedia: false });
  env.wp.data.posts = env.wp.data.posts.filter((post) => post.id !== 1002);
  const review = await fullScan(env.handle, { autoApplyWithdrawals: false });
  assert.equal(review.counts.withdrawn, 1);
  assert.equal(review.withdrawals.appliedCount, 0);
  assert.equal(env.handle.identity.mappingFor('post:1002').status !== 'withdrawn', true);
  const conflicts = await env.handle.sync.conflicts();
  assert.equal(conflicts.some((conflict) => conflict.kind === 'WITHDRAWAL_CONFLICT' && conflict.status === 'open'), true);
  await assert.rejects(
    () => env.handle.sync.assertPublicationSafe({ sourceKeys: ['post:1002'] }),
    (error) => error.code === 'PUBLICATION_CONFLICT'
  );
  const resolved = await env.handle.sync.resolveConflict({
    conflictId: conflicts.find((conflict) => conflict.sourceKey === 'post:1002').id,
    resolution: 'withdraw_local',
    note: 'Operator chose local withdrawal.'
  });
  assert.equal(resolved.status, 'resolved');
  assert.equal(env.handle.identity.mappingFor('post:1002').status, 'withdrawn');
});

test('AC7.6 a QDN external change is persisted and blocks overwrite until explicitly authorized', async (t) => {
  const env = await startPhase7(t, { posts: [makeSyncPost(1)] });
  const scan = await fullScan(env.handle);
  await env.handle.sync.preparePlan({ scanId: scan.scanId, estimateMedia: false });
  const mapping = env.handle.identity.mappingFor('post:1001');
  const observed = await env.handle.sync.recordQdnEvidence({
    sourceKey: 'post:1001',
    sha256: 'sha256:externally-modified',
    bytes: 123,
    service: mapping.service,
    name: mapping.name,
    identifier: mapping.identifier,
    source: 'fixture-readback'
  });
  assert.equal(observed.changed, true);
  assert.equal(observed.conflict.kind, 'QDN_EXTERNAL_CHANGE');
  assert.equal(observed.conflict.evidence.local.mapping.identifier, mapping.identifier);
  assert.equal(observed.conflict.evidence.qdn.sha256, 'sha256:externally-modified');
  await assert.rejects(
    () => env.handle.sync.assertPublicationSafe({ sourceKeys: ['post:1001'] }),
    (error) => error.code === 'PUBLICATION_CONFLICT'
  );

  await env.handle.sync.resolveConflict({
    conflictId: observed.conflict.id,
    resolution: 'keep_qdn',
    note: 'Keep the externally observed version.'
  });
  await assert.rejects(
    () => env.handle.sync.assertPublicationSafe({ sourceKeys: ['post:1001'] }),
    (error) => error.code === 'PUBLICATION_CONFLICT'
  );

  const authorized = await env.handle.sync.resolveConflict({
    conflictId: observed.conflict.id,
    resolution: 'take_source',
    note: 'Owner authorizes replacing the external resource.'
  });
  assert.equal(authorized.authorization.overwriteQdn, true);
  const safe = await env.handle.sync.assertPublicationSafe({ sourceKeys: ['post:1001'] });
  assert.equal(safe.safe, true);

  await env.handle.close();
  const restarted = createEngine({ dataRoot: env.dataRoot });
  const reopened = await restarted.projects.open(env.project.id);
  t.after(() => reopened.close().catch(() => {}));
  const persisted = (await reopened.sync.conflicts({ includeResolved: true }))
    .find((conflict) => conflict.id === observed.conflict.id);
  assert.equal(persisted.status, 'resolved');
  assert.equal(persisted.resolution, 'take_source');
  assert.ok(persisted.history.some((entry) => entry.action === 'resolve'));
});

test('AC7.7 a failed source scan is never reported as a successful no-change sync', async (t) => {
  const env = await startPhase7(t);
  env.wp.setFailStatus(500);
  const failed = await fullScan(env.handle);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.complete, false);
  assert.equal(failed.planningAllowed, false);
  assert.equal(failed.noChanges, false);
  assert.equal(failed.counts, null);
  assert.ok(failed.error);
  const stored = await env.handle.sync.get(failed.scanId);
  assert.equal(stored.status, 'failed');
  assert.equal(stored.planningAllowed, false);
  assert.equal(stored.complete, false);
  const status = await env.handle.sync.status();
  assert.equal(status.watermarks.wordpress, undefined);
  await assert.rejects(
    () => env.handle.sync.preparePlan({ scanId: failed.scanId, estimateMedia: false }),
    (error) => error.code === 'SYNC_SCAN_INCOMPLETE'
  );
});

test('AC7.8 a truncated scan does not infer deletions, advance watermarks or rewrite the catalog', async (t) => {
  const env = await startPhase7(t);
  const first = await fullScan(env.handle);
  await env.handle.sync.preparePlan({ scanId: first.scanId, estimateMedia: false });
  const markBefore = (await env.handle.sync.status()).watermarks.wordpress;
  const catalogBefore = await readFile(path.join(projectRoot(env), first.catalogPath), 'utf8');

  const partial = await fullScan(env.handle, { maxItems: 2 });
  assert.equal(partial.status, 'incomplete');
  assert.equal(partial.complete, false);
  assert.equal(partial.planningAllowed, false);
  assert.equal(partial.counts.withdrawn, 0);
  assert.equal(partial.withdrawals.pending, 0);
  assert.ok(partial.warnings.some((warning) => warning.code === 'SYNC_SCAN_INCOMPLETE'));
  const markAfter = (await env.handle.sync.status()).watermarks.wordpress;
  assert.equal(markAfter.lastCompletedAt, markBefore.lastCompletedAt);
  await assert.rejects(
    () => env.handle.sync.writeCatalog({ scanId: partial.scanId }),
    (error) => error.code === 'SYNC_SCAN_INCOMPLETE'
  );
  await assert.rejects(
    () => env.handle.sync.preparePlan({ scanId: partial.scanId, estimateMedia: false }),
    (error) => error.code === 'SYNC_SCAN_INCOMPLETE'
  );
  assert.equal(await readFile(path.join(projectRoot(env), first.catalogPath), 'utf8'), catalogBefore);
});

test('interrupted classification resumes from a crash-safe checkpoint without duplicating the delta', async (t) => {
  const posts = Array.from({ length: 5 }, (_, index) => makeSyncPost(index + 1));
  const env = await startPhase7(t, { posts });
  let scan = await fullScan(env.handle, { classifyBatchSize: 2 });
  assert.equal(scan.status, 'interrupted');
  assert.equal(scan.complete, false);
  assert.equal(scan.planningAllowed, false);
  assert.equal(scan.recoverable, true);

  let rounds = 0;
  while (scan.status === 'interrupted' && rounds < 10) {
    scan = await env.handle.sync.resume({ scanId: scan.scanId });
    rounds += 1;
  }
  assert.equal(scan.status, 'completed');
  assert.equal(scan.counts.new, 5);
  assert.equal(scan.counts.scanned, 5);
  const history = await env.handle.sync.history();
  assert.equal(history.length, 1);
  assert.equal(history[0].scanId, scan.scanId);
  assert.equal(history[0].status, 'completed');
  const plan = await env.handle.sync.preparePlan({ scanId: scan.scanId, estimateMedia: false });
  assert.equal(plan.stats.selected, 5);
});

test('a scan left running by a crash is recovered as interrupted and cannot plan', async (t) => {
  const env = await startPhase7(t);
  const scan = await fullScan(env.handle);
  await env.handle.store.transaction((draft) => {
    const current = draft.sync.scans[scan.scanId];
    current.status = 'scanning';
    current.complete = false;
    current.planningAllowed = true;
  });
  const recovery = await env.handle.sync.recover();
  assert.equal(recovery.interrupted >= 1, true);
  const recovered = await env.handle.sync.get(scan.scanId);
  assert.equal(recovered.status, 'interrupted');
  assert.equal(recovered.planningAllowed, false);
  await assert.rejects(
    () => env.handle.sync.preparePlan({ scanId: scan.scanId, estimateMedia: false }),
    (error) => error.code === 'SYNC_SCAN_INCOMPLETE'
  );
});

test('AC7.9 an existing verified migration is adopted without changing QDN identities', async (t) => {
  const env = await startPhase7(t, { posts: [makeSyncPost(1), makeSyncPost(2)] });
  const scan = await fullScan(env.handle);
  const plan = await env.handle.sync.preparePlan({ scanId: scan.scanId, estimateMedia: false });
  const selection = plan.plan.entries.map((entry) => entry.sourceKey);
  const published = await publishAndVerify(t, env, plan.plan, selection);
  assert.equal(published.verified.counts.remote_verified, published.verified.resources.length);
  const triplesBefore = {};
  for (const key of selection) {
    const mapping = env.handle.identity.mappingFor(key);
    triplesBefore[key] = { service: mapping.service, name: mapping.name, identifier: mapping.identifier };
  }
  await env.handle.store.transaction((draft) => {
    draft.sync.adoptions = [];
    draft.sync.watermarks = {};
    draft.sync.scans = {};
  });
  const before = await env.handle.sync.status();
  assert.equal(before.adoptionRequired, true);
  const adoption = await env.handle.sync.adoptExisting({ note: 'Existing Phase 6 project opened in Phase 7.' });
  assert.equal(adoption.adopted, true);
  assert.equal(adoption.changedIdentities, false);
  assert.equal(adoption.mappingCount, 2);
  assert.equal(adoption.verifiedResourceCount >= 2, true);
  assert.deepEqual(adoption.issues, []);
  for (const key of selection) {
    const mapping = env.handle.identity.mappingFor(key);
    assert.deepEqual(
      { service: mapping.service, name: mapping.name, identifier: mapping.identifier },
      triplesBefore[key]
    );
  }
  const after = await env.handle.sync.status();
  assert.equal(after.adoptionRequired, false);
  assert.equal(after.adoptionCount, 1);
  await env.handle.close();
  const restarted = createEngine({ dataRoot: env.dataRoot });
  const reopened = await restarted.projects.open(env.project.id);
  t.after(() => reopened.close().catch(() => {}));
  const reports = await reopened.sync.adoptionReports();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].changedIdentities, false);
});
