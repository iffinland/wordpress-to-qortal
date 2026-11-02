import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import { createEngine } from '../../lib/engine/index.js';
import { makePost, startPhase3 } from '../../test-support/phase3/helpers.js';

async function discover(handle, options = {}) {
  const result = await handle.source.discover({ perPage: 100, progressEvery: 100, ...options });
  assert.equal(result.status, 'completed');
  return result;
}

test('the default plan selects exactly 15 items and subsequent plans do not duplicate them', async (t) => {
  const posts = Array.from({ length: 20 }, (_, index) => makePost(index));
  const env = await startPhase3(t, { posts });
  await discover(env.handle);
  const first = await env.handle.planning.create({ estimateMedia: false });
  assert.equal(first.status, 'completed');
  assert.equal(first.stats.selected, 15);
  assert.equal(first.plan.selection.batchSize, 15);
  assert.equal(first.plan.entries.filter((entry) => ['new', 'modified', 'route_changed'].includes(entry.status)).length, 15);
  assert.equal(first.plan.estimates.totalResources, 15);
  assert.equal(first.plan.estimates.feePerResource, 0.01);
  assert.equal(first.plan.estimates.estimatedFee, 0.15);
  assert.equal(first.plan.estimates.feeCurrency, 'QORT');

  const second = await env.handle.planning.create({ estimateMedia: false });
  assert.equal(second.status, 'completed');
  assert.equal(second.stats.selected, 5);
  assert.equal(second.stats.unchanged, 15);

  const third = await env.handle.planning.create({ estimateMedia: false });
  assert.equal(third.status, 'completed');
  assert.equal(third.stats.selected, 0);
  assert.equal(third.stats.unchanged, 20);
});

test('batch size is configurable, deterministic and invalid values are rejected', async (t) => {
  const env = await startPhase3(t, { posts: Array.from({ length: 8 }, (_, index) => makePost(index)) });
  await discover(env.handle);
  const previewA = await env.handle.planning.create({ batchSize: 3, estimateMedia: false, persist: false });
  const previewB = await env.handle.planning.create({ batchSize: 3, estimateMedia: false, persist: false });
  assert.equal(previewA.planId, previewB.planId);
  assert.deepEqual(
    previewA.plan.entries.map((entry) => entry.sourceKey),
    previewB.plan.entries.map((entry) => entry.sourceKey)
  );
  assert.equal(previewA.stats.selected, 3);
  for (const invalid of [0, -1, 1.5, '15', 1001]) {
    await assert.rejects(
      () => env.handle.planning.create({ batchSize: invalid }),
      (error) => error.code === 'CONFIG_INVALID'
    );
  }
});

test('date filters select deterministically and modified filters are independent', async (t) => {
  const posts = [
    makePost(1, { date: '2024-01-01T00:00:00', date_gmt: '2024-01-01T00:00:00' }),
    makePost(2, { date: '2024-01-10T00:00:00', date_gmt: '2024-01-10T00:00:00' }),
    makePost(3, { date: '2024-02-01T00:00:00', date_gmt: '2024-02-01T00:00:00' }),
    makePost(4, { date: '2024-03-01T00:00:00', date_gmt: '2024-03-01T00:00:00' })
  ];
  const env = await startPhase3(t, { posts });
  await discover(env.handle);
  const filtered = await env.handle.planning.create({
    batchSize: 10,
    estimateMedia: false,
    persist: false,
    filters: { after: '2024-01-05T00:00:00Z', before: '2024-02-15T00:00:00Z' }
  });
  assert.equal(filtered.stats.selected, 2);
  assert.deepEqual(filtered.plan.entries.map((entry) => entry.sourceKey), ['post:1003', 'post:1002']);
  const ascending = await env.handle.planning.create({
    batchSize: 10,
    estimateMedia: false,
    persist: false,
    planning: { order: 'asc' },
    filters: { after: '2024-01-05T00:00:00Z', before: '2024-02-15T00:00:00Z' }
  });
  assert.deepEqual(ascending.plan.entries.map((entry) => entry.sourceKey), ['post:1002', 'post:1003']);
  const modified = await env.handle.planning.create({
    batchSize: 10,
    estimateMedia: false,
    persist: false,
    filters: { modifiedAfter: '2024-01-09T00:00:00Z' }
  });
  assert.ok(modified.stats.selected >= 1);
  assert.ok(modified.plan.entries.every((entry) => entry.sourceModifiedAt && Date.parse(entry.sourceModifiedAt) >= Date.parse('2024-01-09T00:00:00Z')));
});

test('plans survive a restart and remain inspectable', async (t) => {
  const env = await startPhase3(t, { posts: Array.from({ length: 4 }, (_, index) => makePost(index)) });
  await discover(env.handle);
  const created = await env.handle.planning.create({ batchSize: 2, estimateMedia: false });
  assert.equal(created.status, 'completed');
  await env.handle.close();
  const restarted = createEngine({ dataRoot: env.dataRoot });
  const reopened = await restarted.projects.open(env.project.id);
  t.after(() => reopened.close().catch(() => {}));
  const loaded = await reopened.planning.get(created.planId);
  assert.equal(loaded.plan.planId, created.planId);
  assert.equal(loaded.plan.status, 'ready');
  assert.equal(loaded.plan.stats.selected, 2);
  assert.equal(reopened.planning.list().length, 1);
  await restarted.close();
});

test('two projects with overlapping source ids and slugs get isolated mappings', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(1), makePost(2)], target: 'SharedSiteName' });
  const secondProject = await env.engine.projects.create({
    name: 'Second Site',
    source: { adapter: 'wordpress', baseUrl: env.wp.url },
    target: { qdnName: 'SharedSiteName' },
    settings: { disk: { reserveBytes: 0, maxBytesPerRun: 0 }, media: { allowLoopback: true } }
  });
  const second = await env.engine.projects.open(secondProject.id);
  t.after(() => second.close().catch(() => {}));

  await discover(env.handle);
  await discover(second);
  const firstPlan = await env.handle.planning.create({ batchSize: 2, estimateMedia: false });
  const secondPlan = await second.planning.create({ batchSize: 2, estimateMedia: false });
  assert.equal(firstPlan.status, 'completed');
  assert.equal(secondPlan.status, 'completed');

  const firstMapping = env.handle.identity.mappingFor('post:1001');
  const secondMapping = second.identity.mappingFor('post:1001');
  assert.equal(firstMapping.sourceKey, secondMapping.sourceKey);
  assert.equal(firstMapping.name, secondMapping.name);
  assert.notEqual(firstMapping.identifier, secondMapping.identifier);
  assert.notEqual(firstMapping.identifier, secondMapping.identifier);
  assert.equal(env.handle.identity.state.mappings['post:1002'].identifier === second.identity.state.mappings['post:1002'].identifier, false);
});

test('a truncated discovery batch is treated as incomplete and never as deletion proof', async (t) => {
  const env = await startPhase3(t, { posts: Array.from({ length: 6 }, (_, index) => makePost(index)) });
  const discovery = await env.handle.source.discover({ perPage: 2, maxItems: 3 });
  assert.equal(discovery.status, 'completed');
  assert.equal(discovery.summary.truncated, true);
  const plan = await env.handle.planning.create({ batchSize: 10, estimateMedia: false });
  assert.equal(plan.status, 'completed');
  assert.ok(plan.warnings.some((warning) => warning.code === 'SOURCE_BATCH_TRUNCATED'));
  assert.equal(plan.stats.withdrawn, 0);
  assert.ok(plan.stats.scanned <= 3);
});

test('a large archive is scanned as metadata and only a bounded item set is planned', async (t) => {
  const posts = Array.from({ length: 1500 }, (_, index) => makePost(index));
  const env = await startPhase3(t, { posts });
  const discovery = await env.handle.source.discover({ perPage: 500, progressEvery: 1000 });
  assert.equal(discovery.status, 'completed');
  const plan = await env.handle.planning.create({ batchSize: 15, estimateMedia: false });
  assert.equal(plan.status, 'completed');
  assert.equal(plan.stats.scanned, 1500);
  assert.equal(plan.stats.selected, 15);
  assert.equal(plan.plan.entries.filter((entry) => entry.status === 'new').length, 15);
});

test('unsupported indexed content types are reported instead of silently dropped', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(0)] });
  const discovery = await discover(env.handle);
  await appendFile(discovery.paths.batchDir + '/index.jsonl', JSON.stringify({
    id: 'src_custom_1',
    sourceKey: 'custom:1',
    sourceType: 'custom',
    contentType: 'custom_type',
    title: 'Unsupported custom item',
    slug: 'custom-item',
    contentHash: 'sha256:' + 'a'.repeat(64),
    file: 'items/src_custom_1.json',
    bytes: 10
  }) + '\n');
  const plan = await env.handle.planning.create({ batchSize: 5, estimateMedia: false });
  assert.equal(plan.status, 'completed');
  assert.equal(plan.stats.unsupported, 1);
  assert.ok(plan.warnings.some((warning) => warning.code === 'UNSUPPORTED_CONTENT_TYPE'));
  assert.ok(plan.plan.entries.some((entry) => entry.status === 'unsupported' && entry.sourceKey === 'custom:1'));
});

test('planning requires a configured target name before any identity is written', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(1)], target: 'SyntheticSite' });
  await env.handle.update({ target: { qdnName: null } }).catch(() => {});
  // A null target is accepted for an empty mapping set, but planning refuses.
  await assert.rejects(
    () => env.handle.planning.create({ estimateMedia: false }),
    (error) => error.code === 'TARGET_NAME_REQUIRED' || error.code === 'TARGET_NAME_INVALID'
  );
});
