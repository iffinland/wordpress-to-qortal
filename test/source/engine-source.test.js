import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../../lib/engine/index.js';
import { startWordpressFixtureServer, createFixtureData } from '../../test-support/wordpress/fixtureServer.js';

async function engineFixture(t, options = {}) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'qms-source-test-'));
  const server = await startWordpressFixtureServer(options);
  const engine = createEngine({ dataRoot });
  t.after(async () => {
    await engine.close().catch(() => {});
    await server.close().catch(() => {});
    await rm(dataRoot, { recursive: true, force: true });
  });
  return { dataRoot, server, engine };
}

async function createProject(engine, server, name = 'Fixture Project') {
  return engine.projects.create({
    name,
    source: { adapter: 'wordpress', baseUrl: server.url },
    settings: { fixture: true }
  });
}

async function filesUnder(directory) {
  try {
    return await readdir(directory, { recursive: true, withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

test('source discovery writes a verified batch, index, latest pointer and sync history', async (t) => {
  const { engine, server } = await engineFixture(t);
  const project = await createProject(engine, server);
  const handle = await engine.projects.open(project.id);

  assert.equal(handle.source.capabilities().id, 'wordpress');
  const result = await handle.source.discover({ mode: 'full', perPage: 2, progressEvery: 1 });
  assert.equal(result.status, 'completed');
  assert.equal(result.summary.items, 12);
  assert.equal(result.report.unsupported.length, 7);
  assert.ok(result.report.warnings.some((warning) => warning.code === 'FEATURED_MEDIA_UNAVAILABLE'));

  const latest = JSON.parse(await readFile(result.paths.latestFile, 'utf8'));
  assert.equal(latest.schema, 'qms-source-latest@1');
  assert.equal(latest.batchId, result.batchId);
  assert.equal(latest.counts.items, 12);

  const index = JSON.parse(await readFile(path.join(result.paths.batchDir, 'index.json'), 'utf8'));
  assert.equal(index.schema, 'qms-content-index@1');
  assert.equal(index.entries.length, 12);
  const first = index.entries.find((entry) => entry.id === 'src_wordpress_post-101');
  assert.match(first.contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.status, 'new');
  assert.ok(first.firstSeenAt);
  assert.ok(first.lastSeenAt);

  const item = JSON.parse(await readFile(path.join(result.paths.batchDir, first.file), 'utf8'));
  assert.equal(item.schema, 'qms-content@1');
  assert.equal(item.title, 'Corbett’s & News');

  const history = JSON.parse(await readFile(result.paths.syncHistoryFile, 'utf8'));
  assert.equal(history.schema, 'qms-sync-history@1');
  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].contentRoot ?? history.entries[0].counts.contentRoot, result.summary.contentRoot);

  const batch = JSON.parse(await readFile(path.join(result.paths.batchDir, 'batch.json'), 'utf8'));
  assert.equal(batch.status, 'completed');
  assert.equal(batch.batchId, result.batchId);
});

test('re-running discovery reports unchanged content and identical hashes', async (t) => {
  const { engine, server } = await engineFixture(t);
  const project = await createProject(engine, server);
  const handle = await engine.projects.open(project.id);
  const first = await handle.source.discover({ mode: 'full', perPage: 3, progressEvery: 10 });
  const second = await handle.source.discover({ mode: 'full', perPage: 3, progressEvery: 10 });
  assert.equal(first.summary.contentRoot, second.summary.contentRoot);
  assert.equal(second.summary.unchanged, first.summary.items);
  assert.equal(second.summary.new, 0);
  assert.equal(second.summary.updated, 0);
  const latest = JSON.parse(await readFile(second.paths.latestFile, 'utf8'));
  assert.equal(latest.batchId, second.batchId);
  const history = JSON.parse(await readFile(second.paths.syncHistoryFile, 'utf8'));
  assert.equal(history.entries.length, 2);
});

test('discovery events are ordered and progress reconstructs after reopen', async (t) => {
  const { engine, server } = await engineFixture(t);
  const project = await createProject(engine, server);
  const handle = await engine.projects.open(project.id);
  const events = [];
  const unsubscribe = handle.events.subscribe((event) => events.push(event));
  const result = await handle.source.discover({ mode: 'full', perPage: 2, progressEvery: 2 });
  unsubscribe();
  assert.equal(result.status, 'completed');
  assert.ok(events.length > 8);
  const seqs = events.map((event) => event.seq);
  assert.deepEqual(seqs, [...seqs].sort((left, right) => left - right));
  assert.equal(new Set(seqs).size, seqs.length);
  assert.equal(events[0].type, 'operation_started');
  assert.equal(events.at(-1).type, 'state_snapshot');
  assert.ok(events.some((event) => event.type === 'operation_completed'));
  const finalProgress = handle.progress(result.runId);
  assert.equal(finalProgress.state, 'completed');
  assert.equal(finalProgress.phase, 'finalize');
  await handle.close();

  const reopened = await engine.projects.open(project.id);
  const reconstructed = reopened.progress(result.runId);
  assert.equal(reconstructed.state, 'completed');
  assert.equal(reconstructed.progress.completed, 5);
  assert.equal(reconstructed.progress.total, 5);
  const replay = reopened.events.list({ runId: result.runId });
  assert.deepEqual(replay.map((event) => event.seq), replay.map((event) => event.seq).sort((left, right) => left - right));
});

test('projects stay isolated for source configuration, events and artifacts', async (t) => {
  const { engine, server } = await engineFixture(t);
  const first = await createProject(engine, server, 'First');
  const second = await createProject(engine, server, 'Second');
  const firstHandle = await engine.projects.open(first.id);
  const secondPaths = engine.projects.paths(second.id);
  const secondFilesBefore = await filesUnder(path.join(secondPaths.artifactsDir, 'source'));
  assert.equal(secondFilesBefore.length, 0);

  const result = await firstHandle.source.discover({ mode: 'full', perPage: 5, progressEvery: 5 });
  assert.equal(result.status, 'completed');
  const secondFilesAfter = await filesUnder(path.join(secondPaths.artifactsDir, 'source'));
  assert.equal(secondFilesAfter.length, 0);
  assert.equal(firstHandle.events.list().length > 0, true);
  const secondHandle = await engine.projects.open(second.id);
  assert.equal(secondHandle.events.list().some((event) => event.type === 'operation_started'), false);
  assert.equal(secondHandle.project.source.baseUrl, server.url);
  assert.equal(secondHandle.project.id === first.id, false);
});

test('authentication secrets never reach project state, events or artifacts', async (t) => {
  const { engine, server } = await engineFixture(t, {
    requireAuth: true,
    authMode: 'application_password'
  });
  const project = await createProject(engine, server);
  const handle = await engine.projects.open(project.id);
  const events = [];
  handle.events.subscribe((event) => events.push(event));
  const result = await handle.source.discover({
    mode: 'full',
    perPage: 5,
    progressEvery: 5,
    auth: {
      mode: 'application_password',
      username: 'fixture-user',
      appPassword: 'fixture-app-password'
    }
  });
  assert.equal(result.status, 'completed');
  const root = engine.projects.paths(project.id).root;
  const files = await filesUnder(root);
  const contents = [];
  for (const entry of files) {
    if (entry.isFile()) {
      contents.push(await readFile(path.join(entry.parentPath ?? entry.path, entry.name), 'utf8'));
    }
  }
  const haystack = contents.join('\n') + JSON.stringify(events);
  assert.equal(haystack.includes('fixture-app-password'), false);
  assert.equal(haystack.includes('fixture-user'), false);
  assert.equal(haystack.toLowerCase().includes('authorization'), false);
  assert.equal(haystack.includes('fixture-password'), false);
  await handle.close();
});

test('cancellation stops discovery and never publishes a latest pointer', async (t) => {
  const { engine, server } = await engineFixture(t, { delayMs: 40 });
  const project = await createProject(engine, server);
  const handle = await engine.projects.open(project.id);
  let runId = null;
  const started = new Promise((resolve) => {
    const unsubscribe = handle.events.subscribe((event) => {
      if (event.type === 'operation_started') {
        runId = event.run_id;
        unsubscribe();
        resolve();
      }
    });
  });
  const discovery = handle.source.discover({ mode: 'full', perPage: 1, progressEvery: 1 });
  await started;
  assert.ok(runId);
  await handle.runs.cancel(runId);
  const result = await discovery;
  assert.equal(result.status, 'cancelled');
  const paths = engine.projects.paths(project.id);
  await assert.rejects(
    () => readFile(path.join(paths.artifactsDir, 'source', 'wordpress', 'latest.json'), 'utf8'),
    (error) => error.code === 'ENOENT'
  );
  const batch = JSON.parse(await readFile(path.join(result.batchDir, 'batch.json'), 'utf8'));
  assert.equal(batch.status, 'cancelled');
  const progress = handle.progress(runId);
  assert.equal(progress.state, 'cancelled');
  assert.equal(progress.cancelled, true);
});

test('a failed discovery leaves a failed batch and no latest pointer', async (t) => {
  const { engine } = await engineFixture(t);
  const failing = await startWordpressFixtureServer({ malformed: true });
  t.after(() => failing.close());
  const project = await createProject(engine, failing);
  const handle = await engine.projects.open(project.id);
  const result = await handle.source.discover({ mode: 'full', perPage: 5 });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'SOURCE_INVALID_RESPONSE');
  const batch = JSON.parse(await readFile(path.join(result.batchDir, 'batch.json'), 'utf8'));
  assert.equal(batch.status, 'failed');
  const paths = engine.projects.paths(project.id);
  await assert.rejects(
    () => readFile(path.join(paths.artifactsDir, 'source', 'wordpress', 'latest.json'), 'utf8'),
    (error) => error.code === 'ENOENT'
  );
});

test('maxItems produces an explicitly truncated completed batch', async (t) => {
  const { engine, server } = await engineFixture(t);
  const project = await createProject(engine, server);
  const handle = await engine.projects.open(project.id);
  const result = await handle.source.discover({ mode: 'full', perPage: 2, progressEvery: 10, maxItems: 3 });
  assert.equal(result.status, 'completed');
  assert.equal(result.summary.items, 3);
  assert.equal(result.summary.truncated, true);
  const report = JSON.parse(await readFile(result.paths.reportFile, 'utf8'));
  assert.equal(report.truncated, true);
});

test('source validation emits events and does not import content', async (t) => {
  const { engine, server } = await engineFixture(t);
  const project = await createProject(engine, server);
  const handle = await engine.projects.open(project.id);
  const result = await handle.source.validate();
  assert.equal(result.status, 'completed');
  assert.equal(result.report.site.name, 'Fixture News');
  assert.ok(handle.events.list({ runId: result.runId }).some((event) => event.code === 'SOURCE_VALIDATED'));
  const sourceDir = path.join(engine.projects.paths(project.id).artifactsDir, 'source');
  assert.equal((await filesUnder(sourceDir)).length, 0);
});

test('a full archive does not grow the Phase 1 state store by item content', async (t) => {
  const data = createFixtureData();
  data.posts = Array.from({ length: 600 }, (_, index) => ({
    id: 20_000 + index,
    slug: `archive-${index}`,
    title: `Archive ${index}`,
    content: '<p>Archive body</p>',
    excerpt: '',
    date: '2023-01-01T00:00:00',
    date_gmt: '2023-01-01T00:00:00',
    modified: '2023-01-01T00:00:00',
    modified_gmt: '2023-01-01T00:00:00',
    status: 'publish',
    author: 7,
    featured_media: 0,
    categories: [],
    tags: []
  }));
  const { engine, server } = await engineFixture(t, { data });
  const project = await createProject(engine, server);
  const handle = await engine.projects.open(project.id);
  const result = await handle.source.discover({ mode: 'full', perPage: 100, progressEvery: 500 });
  assert.equal(result.status, 'completed');
  assert.ok(result.summary.items >= 600);
  const stateBytes = (await readFile(handle.paths.journalFile, 'utf8')).length +
    (await readFile(handle.paths.snapshotFile, 'utf8')).length;
  const itemBytes = result.summary.bytes;
  assert.ok(itemBytes > 100_000);
  // Metadata, event envelopes and run records are persisted; full item bodies are not.
  assert.ok(stateBytes < itemBytes / 4, `state ${stateBytes} vs items ${itemBytes}`);
});
