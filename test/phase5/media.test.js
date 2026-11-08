import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startPhase3, makePost, dataWithPosts } from '../../test-support/phase3/helpers.js';

function mediaPost(mediaUrl) {
  return makePost(1, { content: '<p>Media</p><img src="' + mediaUrl + '/media/known/alpha.jpg?bytes=2048">' });
}

async function mediaEnv(t) {
  const env = await startPhase3(t, {
    mediaServer: true,
    settings: { media: { allowExternalMedia: true } },
    dataFactory: ({ mediaUrl }) => dataWithPosts([mediaPost(mediaUrl)])
  });
  await env.handle.source.discover({ mode: 'full', perPage: 50 });
  return env;
}

test('media resources are included as exact bytes and content depends on them', async (t) => {
  const env = await mediaEnv(t);
  const plan = await env.handle.planning.create({ batchSize: 1 });
  assert.equal(plan.status, 'completed');
  const download = await env.handle.media.download({ planId: plan.planId, concurrency: 1 });
  assert.equal(download.status, 'completed');
  const selection = plan.plan.entries.filter((entry) => entry.status === 'new').map((entry) => entry.sourceKey);
  const handoff = await env.handle.publication.prepare({ planId: plan.planId, selection });
  const root = path.join(env.engine.projects.paths(env.project.id).root, handoff.handoffPath);
  const manifest = JSON.parse(await readFile(path.join(root, 'handoff.json'), 'utf8'));
  const media = manifest.resources.find((resource) => resource.kind === 'media');
  const content = manifest.resources.find((resource) => resource.kind === 'content');
  assert.ok(media);
  assert.equal(media.service, 'IMAGE');
  assert.equal(media.contentType, 'image/jpeg');
  assert.ok(content.dependsOn.includes(media.id));
  assert.ok(media.order < content.order);
  const bytes = await readFile(path.join(root, media.relativePath));
  assert.equal(bytes.length, media.bytes);
  assert.equal('sha256:' + (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'), media.sha256);
  assert.doesNotMatch(JSON.stringify(manifest), /assetPath|\/home\/|\/tmp\//);
});

test('a handoff refuses selected content whose media is not locally verified', async (t) => {
  const env = await mediaEnv(t);
  const plan = await env.handle.planning.create({ batchSize: 1 });
  const selection = plan.plan.entries.filter((entry) => entry.status === 'new').map((entry) => entry.sourceKey);
  await assert.rejects(
    () => env.handle.publication.prepare({ planId: plan.planId, selection }),
    (error) => error.code === 'PUBLICATION_NOT_READY'
  );
});

test('two independent sites with the same source ids get disjoint QDN identifiers', async (t) => {
  const first = await startPhase3(t, { posts: [makePost(1)], target: 'SharedName' });
  await first.handle.source.discover({ mode: 'full', perPage: 50 });
  const firstPlan = await first.handle.planning.create({ batchSize: 1, estimateMedia: false });
  const firstHandoff = await first.handle.publication.prepare({
    planId: firstPlan.planId,
    selection: firstPlan.plan.entries.filter((entry) => entry.status === 'new').map((entry) => entry.sourceKey)
  });
  const secondProject = await first.engine.projects.create({
    name: 'Second Independent Site',
    source: { adapter: 'wordpress', baseUrl: first.wp.url },
    target: { qdnName: 'SharedName' },
    settings: { disk: { reserveBytes: 0, maxBytesPerRun: 0 }, media: { allowLoopback: true } }
  });
  const second = await first.engine.projects.open(secondProject.id);
  t.after(() => second.close().catch(() => {}));
  await second.source.discover({ mode: 'full', perPage: 50 });
  const secondPlan = await second.planning.create({ batchSize: 1, estimateMedia: false });
  const secondHandoff = await second.publication.prepare({
    planId: secondPlan.planId,
    selection: secondPlan.plan.entries.filter((entry) => entry.status === 'new').map((entry) => entry.sourceKey)
  });
  const firstContent = firstHandoff.resources.find((resource) => resource.kind === 'content');
  const secondContent = secondHandoff.resources.find((resource) => resource.kind === 'content');
  assert.equal(firstContent.service, 'DOCUMENT');
  assert.equal(secondContent.service, 'DOCUMENT');
  assert.notEqual(firstContent.identifier, secondContent.identifier);
  assert.notEqual(firstHandoff.identity?.siteId ?? first.project.siteId, secondHandoff.identity?.siteId ?? secondProject.siteId);
});
