import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../../lib/engine/index.js';
import { makePost, dataWithPosts, startPhase3 } from '../../test-support/phase3/helpers.js';

async function discover(handle, options = {}) {
  const result = await handle.source.discover({ mode: 'full', perPage: 100, progressEvery: 100, ...options });
  assert.equal(result.status, 'completed');
  return result;
}

function mediaPost(mediaUrl, index) {
  return makePost(index, {
    content: '<p>Prepared body ' + index + '</p><img src="' + mediaUrl + '/media/known/alpha.jpg?bytes=2048">'
  });
}

test('reserved mappings are never reported as unchanged and remain recoverable', async (t) => {
  const posts = Array.from({ length: 20 }, (_, index) => makePost(index));
  const env = await startPhase3(t, { posts });
  await discover(env.handle);

  const first = await env.handle.planning.create({ estimateMedia: false });
  assert.equal(first.status, 'completed');
  assert.equal(first.stats.selected, 15);
  assert.equal(first.stats.reserved, 0);
  assert.equal(first.plan.pendingPublication.count, 0);

  const second = await env.handle.planning.create({ estimateMedia: false });
  assert.equal(second.stats.selected, 5);
  assert.equal(second.stats.reserved, 15);
  assert.equal(second.stats.unchanged, 0);
  assert.equal(second.plan.pendingPublication.count, 15);

  const third = await env.handle.planning.create({ estimateMedia: false });
  assert.equal(third.stats.selected, 0);
  assert.equal(third.stats.reserved, 20);
  assert.equal(third.stats.unchanged, 0);
  assert.equal(third.plan.pendingPublication.count, 20);

  const mapping = env.handle.identity.mappingFor('post:1001');
  assert.equal(mapping.publicationStatus, 'reserved');
  assert.equal(mapping.localPreparation, 'reserved');
  assert.notEqual(mapping.status, 'published');
  const described = env.handle.identity.describe();
  assert.equal(described.pendingPublicationCount, 20);
  assert.equal(described.publishedCount, 0);
  assert.equal(described.remotelyVerifiedCount, 0);
});

test('includeReserved reselects unpublished mappings without changing their identity', async (t) => {
  const posts = Array.from({ length: 6 }, (_, index) => makePost(index));
  const env = await startPhase3(t, { posts });
  await discover(env.handle);
  const first = await env.handle.planning.create({ batchSize: 3, estimateMedia: false });
  assert.equal(first.status, 'completed');
  const beforeKey = Object.keys(env.handle.identity.state.mappings).sort()[0];
  const before = env.handle.identity.mappingFor(beforeKey);
  assert.ok(before);

  const repeated = await env.handle.planning.create({
    batchSize: 10,
    estimateMedia: false,
    planning: { includeReserved: true }
  });
  assert.equal(repeated.status, 'completed');
  assert.equal(repeated.stats.selected, 6);
  assert.equal(repeated.stats.reserved, 3);
  assert.equal(repeated.plan.entries.filter((entry) => entry.status === 'reserved').length, 3);
  assert.equal(repeated.plan.entries.filter((entry) => entry.status === 'new').length, 3);
  assert.ok(repeated.plan.entries.filter((entry) => entry.status === 'reserved').every((entry) => entry.pendingPublication === true));
  const after = env.handle.identity.mappingFor(beforeKey);
  assert.equal(after.identifier, before.identifier);
  assert.equal(after.name, before.name);
  assert.equal(after.publicationStatus, 'reserved');
});

test('reserved state survives reopening and repeated planning', async (t) => {
  const posts = Array.from({ length: 4 }, (_, index) => makePost(index));
  const env = await startPhase3(t, { posts });
  await discover(env.handle);
  const first = await env.handle.planning.create({ batchSize: 2, estimateMedia: false });
  assert.equal(first.status, 'completed');
  const mappingKey = Object.keys(env.handle.identity.state.mappings).sort()[0];
  const mappingBefore = env.handle.identity.mappingFor(mappingKey);
  await env.handle.close();

  const restarted = createEngine({ dataRoot: env.dataRoot });
  const reopened = await restarted.projects.open(env.project.id);
  t.after(async () => {
    await reopened.close().catch(() => {});
    await restarted.close().catch(() => {});
  });
  const mappingAfter = reopened.identity.mappingFor(mappingKey);
  assert.equal(mappingAfter.identifier, mappingBefore.identifier);
  assert.equal(mappingAfter.publicationStatus, 'reserved');
  const repeated = await reopened.planning.create({ batchSize: 2, estimateMedia: false });
  assert.equal(repeated.stats.selected, 2);
  assert.equal(repeated.stats.reserved, 2);
  assert.equal(repeated.stats.unchanged, 0);
});

test('legacy published and remote-verified mappings remain unchanged for Phase 5 compatibility', async (t) => {
  const posts = Array.from({ length: 2 }, (_, index) => makePost(index));
  const env = await startPhase3(t, { posts });
  await discover(env.handle);
  const plan = await env.handle.planning.create({ batchSize: 2, estimateMedia: false });
  assert.equal(plan.status, 'completed');

  await env.handle.store.transaction((draft) => {
    for (const mapping of Object.values(draft.identity.mappings)) {
      mapping.status = 'published';
      mapping.publicationStatus = 'published';
      mapping.publishedAt = new Date().toISOString();
    }
  });
  const afterPublish = await env.handle.planning.create({ estimateMedia: false });
  assert.equal(afterPublish.stats.unchanged, 2);
  assert.equal(afterPublish.stats.reserved, 0);
  assert.equal(afterPublish.stats.selected, 0);

  await env.handle.store.transaction((draft) => {
    for (const mapping of Object.values(draft.identity.mappings)) {
      delete mapping.publicationStatus;
      mapping.status = 'published';
    }
  });
  const legacy = await env.handle.planning.create({ estimateMedia: false });
  assert.equal(legacy.stats.unchanged, 2);
  assert.equal(legacy.stats.reserved, 0);
});

test('verified media marks local preparation but never publication', async (t) => {
  const env = await startPhase3(t, {
    mediaServer: true,
    dataFactory: ({ mediaUrl }) => dataWithPosts([mediaPost(mediaUrl, 0)]),
    settings: { media: { allowExternalMedia: true } }
  });
  await discover(env.handle);
  const plan = await env.handle.planning.create({ batchSize: 1 });
  assert.equal(plan.status, 'completed');
  assert.equal(plan.media.knownCount, 1);
  const download = await env.handle.media.download({ planId: plan.planId });
  assert.equal(download.status, 'completed');

  const mapping = env.handle.identity.mappingFor('post:1000');
  assert.equal(mapping.publicationStatus, 'reserved');
  assert.equal(mapping.localPreparation, 'prepared');
  assert.equal(mapping.status, 'reserved');
  assert.equal(env.handle.identity.describe().preparedCount, 1);
  assert.equal(env.handle.identity.describe().publishedCount, 0);

  const repeated = await env.handle.planning.create({ batchSize: 1, estimateMedia: false });
  assert.equal(repeated.stats.selected, 0);
  assert.equal(repeated.stats.reserved, 1);
  assert.equal(repeated.stats.unchanged, 0);
  assert.equal(repeated.plan.pendingPublication.prepared, 1);

  const include = await env.handle.planning.create({
    batchSize: 1,
    planning: { includeReserved: true }
  });
  assert.equal(include.status, 'completed');
  assert.equal(include.plan.entries[0].localPreparation, 'prepared');
  assert.equal(include.plan.entries[0].pendingPublication, true);
});
