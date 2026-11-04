import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createEngine } from '../../lib/engine/index.js';
import { makePost, dataWithPosts, startPhase3 } from '../../test-support/phase3/helpers.js';

test('planning state is compact, excludes item bodies and records ordered events', async (t) => {
  const marker = 'UNIQUE_BODY_MARKER_9f4c';
  const posts = Array.from({ length: 200 }, (_, index) => makePost(index, {
    content: '<p>' + marker + ' ' + index + '</p>'
  }));
  const env = await startPhase3(t, { posts });
  const discovery = await env.handle.source.discover({ perPage: 100, progressEvery: 1000 });
  assert.equal(discovery.status, 'completed');
  const events = [];
  const unsubscribe = env.handle.events.subscribe((event) => events.push(event));
  const plan = await env.handle.planning.create({ batchSize: 200, estimateMedia: false });
  unsubscribe();
  assert.equal(plan.status, 'completed');
  assert.equal(plan.stats.selected, 200);

  const paths = env.engine.projects.paths(env.project.id);
  const journalBytes = (await stat(paths.journalFile)).size;
  const stateObjectBytes = Buffer.byteLength(JSON.stringify(env.handle.store.state), 'utf8');
  const planBytes = (await stat(plan.planFile)).size;
  const itemBytes = discovery.summary.bytes;
  const snapshotTextBefore = await readFile(paths.snapshotFile, 'utf8');
  assert.equal(snapshotTextBefore.includes(marker), false);
  await env.handle.store.compact({ reason: 'phase3-measurement' });
  const snapshotBytes = (await stat(paths.snapshotFile)).size;
  const snapshotText = await readFile(paths.snapshotFile, 'utf8');
  assert.equal(snapshotText.includes(marker), false);
  assert.ok(snapshotBytes < itemBytes / 2, 'snapshot ' + snapshotBytes + ' vs items ' + itemBytes);
  assert.ok(planBytes < itemBytes, 'plan ' + planBytes + ' vs items ' + itemBytes);
  t.diagnostic('snapshot bytes=' + snapshotBytes + ' state object bytes=' + stateObjectBytes + ' journal bytes=' + journalBytes + ' write amplification=' + (journalBytes / snapshotBytes).toFixed(2) + 'x item bytes=' + itemBytes + ' plan bytes=' + planBytes + ' txns=' + env.handle.store.lastTxnSeq);

  const seqs = events.map((event) => event.seq);
  assert.deepEqual(seqs, [...seqs].sort((left, right) => left - right));
  assert.equal(new Set(seqs).size, seqs.length);
  assert.equal(events[0].type, 'operation_started');
  assert.equal(events.at(-1).type, 'state_snapshot');
  assert.ok(events.some((event) => event.code === 'PLAN_INDEX_LOADED'));
  assert.ok(events.some((event) => event.code === 'PLAN_SELECTED'));
  assert.ok(events.some((event) => event.type === 'operation_completed'));

  await env.handle.close();
  const restarted = createEngine({ dataRoot: env.dataRoot });
  const reopened = await restarted.projects.open(env.project.id);
  t.after(() => reopened.close().catch(() => {}));
  const progress = reopened.progress(plan.runId);
  assert.equal(progress.state, 'completed');
  assert.equal(progress.progress.completed, 200);
  const replay = reopened.events.list({ runId: plan.runId });
  assert.deepEqual(replay.map((event) => event.seq), replay.map((event) => event.seq).sort((a, b) => a - b));
  const mappings = reopened.identity.listMappings({ limit: 500 });
  assert.equal(mappings.length, 200);
  assert.ok(mappings.every((mapping) => mapping.identifier.length <= 64));
  await restarted.close();
});

test('a media download holds the project lock against another engine instance', async (t) => {
  const env = await startPhase3(t, {
    mediaServer: true,
    mediaOptions: { chunkSize: 4096, chunkDelayMs: 20 },
    dataFactory: ({ mediaUrl }) => dataWithPosts([
      makePost(0, { content: '<p>Locked media</p><img src="' + mediaUrl + '/media/slow?bytes=' + (512 * 1024) + '">' })
    ]),
    settings: {
      media: { allowExternalMedia: true, maxRetries: 0 },
      disk: { reserveBytes: 0, maxBytesPerRun: 0 }
    }
  });
  await env.handle.source.discover({ perPage: 50 });
  const plan = await env.handle.planning.create({ batchSize: 1 });
  assert.equal(plan.status, 'completed');
  const controller = new AbortController();
  const download = env.handle.media.download({ planId: plan.planId, signal: controller.signal });
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (env.media.requests.some((request) => request.method === 'GET')) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const rival = createEngine({ dataRoot: env.dataRoot });
  await assert.rejects(
    () => rival.projects.open(env.project.id),
    (error) => error.code === 'PROJECT_LOCKED'
  );
  controller.abort();
  await download.catch(() => {});
});
