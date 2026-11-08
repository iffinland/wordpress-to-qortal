import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../../lib/engine/index.js';
import {
  startWordpressFixtureServer,
  createFixtureData,
  createLargeFixtureData
} from '../../test-support/wordpress/fixtureServer.js';

async function engineFixture(t, options = {}) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'qms-bounded-scan-'));
  const server = await startWordpressFixtureServer(options);
  const engine = createEngine({ dataRoot });
  t.after(async () => {
    await engine.close().catch(() => {});
    await server.close().catch(() => {});
    await rm(dataRoot, { recursive: true, force: true });
  });
  return { dataRoot, server, engine };
}

async function createProject(engine, server, name = 'Bounded Scan Project') {
  return engine.projects.create({
    name,
    source: { adapter: 'wordpress', baseUrl: server.url },
    settings: { fixture: true }
  });
}

function requestOf(server, suffix) {
  return server.requests.filter((request) => request.path.endsWith(suffix));
}

function largestFullInventoryRequestCount(counts) {
  const posts = Number(counts.posts) || 0;
  const pages = Number(counts.pages) || 0;
  const terms = (Number(counts.categories) || 0) + (Number(counts.tags) || 0);
  const media = Number(counts.media) || 0;
  return Math.ceil((posts + pages) / 100) + Math.ceil(terms / 100) + Math.ceil(media / 100);
}

test('NASA-scale quick scan fetches one bounded post page and only referenced terms and media', async (t) => {
  const data = createLargeFixtureData({ posts: 36_000, media: 250_000, categories: 2_053, tags: 50 });
  const { engine, server } = await engineFixture(t, { data });
  const project = await createProject(engine, server);
  const handle = await engine.projects.open(project.id);
  server.requests.length = 0;

  const result = await handle.source.discover({
    mode: 'quick',
    contentTypes: ['post'],
    perPage: 3,
    selection: { perPage: 3, maxPages: 1, maxItems: 3 }
  });

  assert.equal(result.status, 'completed', JSON.stringify(result.error ?? {}));
  assert.equal(result.mode, 'quick');
  assert.equal(result.scope.scanned, 3);
  assert.equal(result.scope.postsScanned, 3);
  assert.equal(result.scope.totalAvailable.post, 36_000);
  assert.equal(result.scope.worstCasePages, 1);
  assert.ok(result.scope.mediaDependencies <= 4, JSON.stringify(result.scope));
  assert.ok(result.scope.termsReferenced <= 4, JSON.stringify(result.scope));
  assert.ok(result.scope.apiRequests <= 10, 'quick scan must stay bounded: ' + result.scope.apiRequests);
  assert.equal(server.requests.length, result.scope.apiRequests);

  const postRequests = requestOf(server, '/wp-json/wp/v2/posts');
  assert.equal(postRequests.length, 1);
  assert.equal(postRequests[0].query.page, '1');
  assert.equal(postRequests[0].query.per_page, '3');
  assert.ok(postRequests[0].query._fields, 'quick scan must trim content payloads with _fields');

  const categoryRequests = requestOf(server, '/wp-json/wp/v2/categories');
  const tagRequests = requestOf(server, '/wp-json/wp/v2/tags');
  assert.equal(categoryRequests.length, 1);
  assert.equal(tagRequests.length, 1);
  assert.equal(categoryRequests[0].query.include, '1,2');
  assert.equal(tagRequests[0].query.include, '10,11');

  const mediaRequests = requestOf(server, '/wp-json/wp/v2/media');
  assert.equal(mediaRequests.length, 1);
  assert.ok(mediaRequests[0].query.include, 'quick scan may only request explicit media dependencies');
  assert.equal(mediaRequests[0].query.per_page, '100');
  assert.ok(mediaRequests[0].query.include.split(',').includes('301'));
  assert.ok(mediaRequests[0].query.include.split(',').includes('777'));
  assert.equal(mediaRequests.some((request) => !request.query.include), false);

  const index = JSON.parse(await readFile(result.paths.indexFile, 'utf8'));
  const keys = index.entries.map((entry) => entry.sourceKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes('post:101'));
  assert.ok(keys.includes('post:102'));
  assert.ok(keys.includes('post:103'));
  assert.ok(keys.includes('category:1'));
  assert.ok(keys.includes('tag:10'));
  assert.ok(keys.includes('media:301'));
  assert.ok(keys.includes('media:777'));
  assert.equal(keys.some((key) => key.startsWith('media:10000')), false);

  const latest = JSON.parse(await readFile(result.paths.latestFile, 'utf8'));
  assert.equal(latest.mode, 'quick');
  assert.equal(latest.scope.mode, 'quick');
  assert.equal(latest.scope.bounded, true);

  const theoreticalFullRequests = largestFullInventoryRequestCount({
    posts: 36_000,
    media: 250_000,
    categories: 2_053,
    tags: 50
  });
  assert.ok(theoreticalFullRequests > 2_800, String(theoreticalFullRequests));
  assert.ok(result.scope.apiRequests * 100 < theoreticalFullRequests, 'bounded scan must be far smaller than full inventory');
});

test('explicit full inventory still enumerates and records full mode', async (t) => {
  const { engine, server } = await engineFixture(t, { data: createFixtureData() });
  const project = await createProject(engine, server);
  const handle = await engine.projects.open(project.id);
  const result = await handle.source.discover({ mode: 'full', perPage: 100, progressEvery: 100 });

  assert.equal(result.status, 'completed', JSON.stringify(result.error ?? {}));
  assert.equal(result.mode, 'full');
  assert.equal(result.scope.mode, 'full');
  assert.equal(result.scope.bounded, false);
  const latest = JSON.parse(await readFile(result.paths.latestFile, 'utf8'));
  assert.equal(latest.mode, 'full');
  assert.equal(latest.scope.mode, 'full');
});

test('pause at a safe boundary survives restart and resume without redoing the content page', async (t) => {
  const data = createLargeFixtureData({ posts: 36_000, media: 250_000, categories: 2_053, tags: 50 });
  const { dataRoot, engine, server } = await engineFixture(t, { data, delayMs: 80 });
  const project = await createProject(engine, server);
  let handle = await engine.projects.open(project.id);
  server.requests.length = 0;

  let pauseRequested = false;
  const paused = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('pause window was missed')), 15_000);
    const unsubscribe = handle.events.subscribe((event) => {
      if (pauseRequested) return;
      if (event.type !== 'progress_updated' || event.phase !== 'select') return;
      if (event.details?.mode !== 'quick') return;
      pauseRequested = true;
      clearTimeout(timeout);
      unsubscribe();
      void handle.runs.pause(event.run_id).then(() => resolve(event.run_id)).catch(reject);
    });
  });

  const discovery = handle.source.discover({
    mode: 'quick',
    contentTypes: ['post'],
    perPage: 3,
    selection: { perPage: 3, maxPages: 1, maxItems: 3 }
  });
  const runId = await paused;
  const pausedResult = await discovery;
  assert.equal(pausedResult.status, 'paused', JSON.stringify(pausedResult));
  const pageRequestsBefore = requestOf(server, '/wp-json/wp/v2/posts').filter((request) => request.query.page === '1').length;
  assert.equal(pageRequestsBefore, 1);

  await handle.close();
  const engine2 = createEngine({ dataRoot });
  t.after(async () => { await engine2.close().catch(() => {}); });
  handle = await engine2.projects.open(project.id);
  const status = await handle.recovery.status();
  const candidate = status.candidates.find((entry) => entry.kind === 'source.discover' && entry.runId === runId);
  assert.ok(candidate, JSON.stringify(status.candidates));
  assert.equal(candidate.resumable, true);
  assert.ok(['content_page', 'content_fetched', 'terms_page'].includes(candidate.step), JSON.stringify(candidate));

  const resumed = await handle.recovery.resume(candidate.runId);
  assert.equal(resumed.result.status, 'completed', JSON.stringify(resumed.result.error ?? resumed.result));
  const pageRequestsAfter = requestOf(server, '/wp-json/wp/v2/posts').filter((request) => request.query.page === '1').length;
  assert.equal(pageRequestsAfter, pageRequestsBefore, 'resume must not re-fetch the completed content page');

  const result = resumed.result;
  const index = JSON.parse(await readFile(result.paths.indexFile, 'utf8'));
  const keys = index.entries.map((entry) => entry.sourceKey);
  assert.equal(new Set(keys).size, keys.length, 'resume must not duplicate index entries');
  assert.equal(keys.filter((key) => key.startsWith('post:')).length, 3);
  assert.equal(keys.filter((key) => key.startsWith('media:')).length, result.scope.mediaDependencies);

  const after = await handle.recovery.status();
  assert.equal(after.candidates.some((entry) => entry.runId === candidate.runId && entry.resumable), false);
});

test('a stale running checkpoint is reconciled at open and is not offered for resume', async (t) => {
  const { dataRoot, engine, server } = await engineFixture(t, { data: createFixtureData() });
  const project = await createProject(engine, server);
  let handle = await engine.projects.open(project.id);
  const context = await handle.runs.start({ kind: 'source.discover', phase: 'connect', meta: { adapterId: 'wordpress' } });
  await context.checkpoint({
    step: 'terms_done',
    phase: 'terms',
    cursor: 10,
    total: 10,
    resumable: true,
    resume: { service: 'source', method: 'discover', params: { perPage: 50 } },
    details: { batchId: 'bat_stalecheckpoint' }
  });
  await context.complete({ ok: true });
  const paths = engine.projects.paths(project.id);
  const checkpointFile = path.join(paths.recoveryRunsDir, context.runId + '.json');
  const checkpoint = JSON.parse(await readFile(checkpointFile, 'utf8'));
  checkpoint.status = 'running';
  checkpoint.resumable = true;
  checkpoint.resume = { service: 'source', method: 'discover', params: { perPage: 50 } };
  await writeFile(checkpointFile, JSON.stringify(checkpoint), 'utf8');
  await handle.close();

  const engine2 = createEngine({ dataRoot });
  t.after(async () => { await engine2.close().catch(() => {}); });
  handle = await engine2.projects.open(project.id);
  const reconciled = handle.recoveryReport?.reconciledCheckpoints ?? [];
  assert.ok(reconciled.some((entry) => entry.runId === context.runId && entry.to === 'completed'), JSON.stringify(handle.recoveryReport));
  const updated = JSON.parse(await readFile(checkpointFile, 'utf8'));
  assert.equal(updated.status, 'completed');
  assert.equal(updated.resumable, false);
  const status = await handle.recovery.status();
  assert.equal(status.candidates.some((entry) => entry.runId === context.runId && entry.resumable), false);
});

test('single-flight guard refuses a second overlapping discovery', async (t) => {
  const { engine, server } = await engineFixture(t, { data: createLargeFixtureData({ posts: 100, media: 100, categories: 5, tags: 2 }), delayMs: 80 });
  const project = await createProject(engine, server);
  const handle = await engine.projects.open(project.id);
  const first = handle.source.discover({
    mode: 'quick',
    contentTypes: ['post'],
    perPage: 3,
    selection: { perPage: 3, maxPages: 1, maxItems: 3 }
  });
  await assert.rejects(
    () => handle.source.discover({
      mode: 'quick',
      contentTypes: ['post'],
      perPage: 3,
      selection: { perPage: 3, maxPages: 1, maxItems: 3 }
    }),
    (error) => error.code === 'OPERATION_ALREADY_RUNNING'
  );
  const result = await first;
  assert.equal(result.status, 'completed', JSON.stringify(result.error ?? {}));
});

test('cancel stops the scan, keeps the project and never records a completed inventory', async (t) => {
  const data = createLargeFixtureData({ posts: 36_000, media: 250_000, categories: 2_053, tags: 50 });
  const { dataRoot, engine, server } = await engineFixture(t, { data, delayMs: 80 });
  const project = await createProject(engine, server);
  const handle = await engine.projects.open(project.id);
  server.requests.length = 0;

  let cancelRequested = false;
  const cancelledSignal = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('cancel window was missed')), 15_000);
    const unsubscribe = handle.events.subscribe((event) => {
      if (cancelRequested) return;
      if (event.type !== 'progress_updated' || event.phase !== 'select') return;
      if (event.details?.mode !== 'quick') return;
      cancelRequested = true;
      clearTimeout(timeout);
      unsubscribe();
      void handle.runs.cancel(event.run_id, 'Acceptance cancel').then(() => resolve(event.run_id)).catch(reject);
    });
  });

  const discovery = handle.source.discover({
    mode: 'quick',
    contentTypes: ['post'],
    perPage: 3,
    selection: { perPage: 3, maxPages: 1, maxItems: 3 }
  });
  const runId = await cancelledSignal;
  const result = await discovery;

  assert.equal(result.status, 'cancelled', JSON.stringify(result));
  assert.equal(result.runId, runId);
  assert.ok(server.requests.length <= 10, 'cancel must not extend the bounded request budget: ' + server.requests.length);

  // A cancelled scan must never look like a completed "no changes" sync: there
  // is no latest pointer at all, so no watermark advanced and no deletion or
  // orphan inference can be derived from it.
  const paths = engine.projects.paths(project.id);
  const latestFile = path.join(paths.artifactsDir, 'source', 'wordpress', 'latest.json');
  await assert.rejects(
    () => readFile(latestFile, 'utf8'),
    (error) => error.code === 'ENOENT'
  );

  const status = await handle.recovery.status();
  assert.equal(status.candidates.some((entry) => entry.runId === runId && entry.resumable), false);
  await handle.close();

  // The project itself, its settings and its identity survive cancellation.
  const engine2 = createEngine({ dataRoot });
  t.after(async () => { await engine2.close().catch(() => {}); });
  const reopened = await engine2.projects.open(project.id);
  assert.equal(reopened.project.name, project.name);
  assert.equal(reopened.project.source.baseUrl, server.url);
  const afterCancel = await reopened.recovery.status();
  assert.equal(afterCancel.candidates.some((entry) => entry.runId === runId), false);
});

test('a scan request without an explicit mode is rejected instead of becoming a full inventory', async (t) => {
  const { engine, server } = await engineFixture(t, { data: createFixtureData() });
  const project = await createProject(engine, server);
  const handle = await engine.projects.open(project.id);
  server.requests.length = 0;

  await assert.rejects(
    () => handle.source.discover({ perPage: 10 }),
    (error) => error.code === 'SOURCE_SCAN_MODE_REQUIRED'
  );
  await assert.rejects(
    () => handle.source.discover({ mode: 'everything', perPage: 10 }),
    (error) => error.code === 'SOURCE_SCAN_MODE_REQUIRED'
  );
  // Nothing may be fetched when the mode is ambiguous.
  assert.equal(server.requests.length, 0, 'an ambiguous mode must not touch the source');
  await handle.close();
});

test('a quick scan beside an interrupted full inventory stays bounded and leaves the full checkpoint intact', async (t) => {
  const { dataRoot, engine, server } = await engineFixture(t, {
    data: createLargeFixtureData({ posts: 36_000, media: 250_000, categories: 2_053, tags: 50 })
  });
  const project = await createProject(engine, server);
  const first = await engine.projects.open(project.id);

  // Simulate the owner's NASA state: an interrupted full inventory that already
  // indexed taxonomy terms and part of the media library when the app quit.
  const stale = await first.runs.start({
    kind: 'source.discover',
    phase: 'terms',
    meta: { adapterId: 'wordpress', mode: 'full' }
  });
  await stale.checkpoint({
    step: 'terms_page',
    phase: 'terms',
    cursor: 1020,
    total: 2094,
    resumable: true,
    resume: {
      service: 'source',
      method: 'discover',
      params: { mode: 'full', perPage: 100, selection: {} }
    },
    details: { batchId: 'bat_ownerfullcheckpoint' }
  });
  const paths = engine.projects.paths(project.id);
  const checkpointFile = path.join(paths.recoveryRunsDir, stale.runId + '.json');
  const checkpoint = JSON.parse(await readFile(checkpointFile, 'utf8'));
  checkpoint.status = 'running';
  checkpoint.resumable = true;
  await writeFile(checkpointFile, JSON.stringify(checkpoint), 'utf8');
  await first.close();

  // Restart: the stale full inventory must be reconciled as an interrupted
  // operation owned by its own checkpoint, never adopted by a new quick scan.
  const engine2 = createEngine({ dataRoot });
  t.after(async () => { await engine2.close().catch(() => {}); });
  const handle = await engine2.projects.open(project.id);
  server.requests.length = 0;

  const quick = await handle.source.discover({
    mode: 'quick',
    contentTypes: ['post'],
    perPage: 3,
    selection: { perPage: 3, maxPages: 1, maxItems: 3 }
  });

  assert.equal(quick.status, 'completed', JSON.stringify(quick.error ?? {}));
  assert.equal(quick.mode, 'quick');
  assert.equal(quick.scope.scanned, 3);
  assert.ok(quick.scope.apiRequests <= 10, 'quick scan must stay bounded: ' + quick.scope.apiRequests);
  assert.ok(server.requests.length <= 10, 'quick scan must not crawl: ' + server.requests.length);
  assert.equal(requestOf(server, '/wp-json/wp/v2/posts').length, 1);
  assert.notEqual(quick.batchId, 'bat_ownerfullcheckpoint');

  const preserved = JSON.parse(await readFile(checkpointFile, 'utf8'));
  assert.equal(preserved.cursor, 1020, 'the interrupted full checkpoint must keep its cursor');
  assert.equal(preserved.resume.params.mode, 'full', 'the interrupted operation keeps its own mode');
  assert.notEqual(preserved.runId, quick.runId ?? quick.batchId);
});
