import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startPhase7, fullScan, makeSyncPost } from './support.js';

function projectRoot(env) {
  return env.engine.projects.paths(env.project.id).root;
}

test('a scoped full scan cannot infer missing-item withdrawals or advance the watermark', async (t) => {
  const env = await startPhase7(t, { posts: [makeSyncPost(1), makeSyncPost(2), makeSyncPost(3)] });
  const first = await fullScan(env.handle);
  assert.equal(first.scope.coverage, 'full-site');
  assert.equal(first.withdrawalEligible, true);
  assert.equal(first.watermarkAdvanced, true);
  await env.handle.sync.preparePlan({ scanId: first.scanId, estimateMedia: false });
  const markBefore = (await env.handle.sync.status()).watermarks.wordpress;

  // Two mapped items disappear from the source, but the scan only searches a
  // third of the site. Pre-remediation this mass-withdrew all missing items.
  env.wp.data.posts = env.wp.data.posts.filter((post) => post.id === 1001);
  const scopedScan = await env.handle.sync.check({
    mode: 'full',
    query: { search: 'Synthetic post 1' },
    autoApplyWithdrawals: true
  });

  assert.equal(scopedScan.status, 'completed', JSON.stringify(scopedScan));
  assert.equal(scopedScan.complete, true);
  assert.equal(scopedScan.scope.coverage, 'scoped');
  assert.equal(scopedScan.withdrawalEligible, false);
  assert.equal(scopedScan.watermarkAdvanced, false);
  assert.equal(scopedScan.counts.withdrawn, 0);
  assert.equal(scopedScan.delta.withdrawn.length, 0);
  assert.equal(scopedScan.withdrawals.appliedCount, 0);
  assert.equal(scopedScan.withdrawals.blockedByScope, 0);
  assert.ok(scopedScan.warnings.some((warning) => warning.code === 'SYNC_FULL_SCAN_SCOPED'));
  assert.equal(env.handle.identity.mappingFor('post:1002').status !== 'withdrawn', true);
  assert.equal(env.handle.identity.mappingFor('post:1003').status !== 'withdrawn', true);

  const markAfter = (await env.handle.sync.status()).watermarks.wordpress;
  assert.equal(markAfter.lastCompletedAt, markBefore.lastCompletedAt);
  assert.equal(markAfter.fullCompletedAt, markBefore.fullCompletedAt);

  const report = JSON.parse(await readFile(path.join(projectRoot(env), scopedScan.reportPath), 'utf8'));
  assert.equal(report.scope.coverage, 'scoped');
  assert.equal(report.withdrawalEligible, false);
  assert.equal(report.watermarkAdvanced, false);
  assert.equal(report.networkDeleted, false);
  assert.equal(report.delta.withdrawn.length, 0);
});

test('scoped withdrawal requests are rejected even when a legacy delta is present', async (t) => {
  const env = await startPhase7(t, { posts: [makeSyncPost(1), makeSyncPost(2)] });
  const first = await fullScan(env.handle);
  await env.handle.sync.preparePlan({ scanId: first.scanId, estimateMedia: false });
  env.wp.data.posts = env.wp.data.posts.filter((post) => post.id === 1001);
  const scopedScan = await env.handle.sync.check({ mode: 'full', query: { search: 'Synthetic post 1' } });

  // Simulate state written by a pre-remediation engine that classified absence
  // during a scoped scan. The API boundary must still refuse to apply it.
  await env.handle.store.transaction((draft) => {
    draft.sync.scans[scopedScan.scanId].delta.withdrawn.push({
      sourceKey: 'post:1002',
      contentType: 'post',
      title: null,
      contentHash: 'sha256:legacy',
      classification: 'withdrawn',
      reason: 'MISSING_FROM_COMPLETE_SOURCE_SCAN'
    });
  });
  await assert.rejects(
    () => env.handle.sync.withdraw({ scanId: scopedScan.scanId, sourceKeys: ['post:1002'] }),
    (error) => error.code === 'SYNC_WITHDRAWAL_NOT_ELIGIBLE'
  );
  assert.equal(env.handle.identity.mappingFor('post:1002').status !== 'withdrawn', true);
});

test('a complete full-site reconciliation still detects genuine withdrawals', async (t) => {
  const env = await startPhase7(t, { posts: [makeSyncPost(1), makeSyncPost(2), makeSyncPost(3)] });
  const first = await fullScan(env.handle);
  await env.handle.sync.preparePlan({ scanId: first.scanId, estimateMedia: false });
  env.wp.data.posts = env.wp.data.posts.filter((post) => post.id === 1001);

  const second = await fullScan(env.handle);
  assert.equal(second.scope.coverage, 'full-site');
  assert.equal(second.withdrawalEligible, true);
  assert.equal(second.counts.withdrawn, 2);
  assert.equal(second.withdrawals.appliedCount, 2);
  assert.equal(second.withdrawals.networkDeleted, false);
  assert.equal(env.handle.identity.mappingFor('post:1002').status, 'withdrawn');
  assert.equal(env.handle.identity.mappingFor('post:1003').status, 'withdrawn');
  const report = JSON.parse(await readFile(path.join(projectRoot(env), second.reportPath), 'utf8'));
  assert.equal(report.withdrawalEligible, true);
  assert.equal(report.withdrawals.blockedByScope, 0);
});

test('content-type subsets are scoped and cannot withdraw unlisted types', async (t) => {
  const env = await startPhase7(t, {
    posts: [makeSyncPost(1)],
    data: null
  });
  // startPhase7 builds posts-only data; a posts-only content type is still a
  // subset of the adapter capability set ['post', 'page'].
  const first = await fullScan(env.handle);
  await env.handle.sync.preparePlan({ scanId: first.scanId, estimateMedia: false });
  const subset = await env.handle.sync.check({ mode: 'full', contentTypes: ['post'] });
  assert.equal(subset.scope.coverage, 'scoped');
  assert.equal(subset.scope.reasons.some((reason) => reason.code === 'PARTIAL_CONTENT_TYPES'), true);
  assert.equal(subset.withdrawalEligible, false);
  assert.equal(subset.watermarkAdvanced, false);
});
