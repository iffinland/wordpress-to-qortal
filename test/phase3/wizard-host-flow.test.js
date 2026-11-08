import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { JsonRpcConnection } from '../../lib/engine/host/client.js';
import { tempDir } from '../../test-support/engine/env.js';
import { startWordpressFixtureServer, createFixtureData } from '../../test-support/wordpress/fixtureServer.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

function datedPost(index, date) {
  return {
    id: 5000 + index,
    slug: 'wizard-post-' + index,
    title: 'Wizard post ' + index,
    content: '<p>Wizard body ' + index + '</p>',
    excerpt: '<p>Wizard excerpt ' + index + '</p>',
    date,
    date_gmt: date,
    modified: date,
    modified_gmt: date,
    status: 'publish',
    author: 7,
    featured_media: 0,
    categories: [],
    tags: []
  };
}

async function startHost(t, dataRoot) {
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'bin', 'qms-host.js')], {
    cwd: REPO_ROOT,
    env: { ...process.env, QMS_DATA_ROOT: dataRoot, QMS_REPO_ROOT: REPO_ROOT },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  t.after(() => child.kill('SIGTERM'));
  const connection = new JsonRpcConnection({ input: child.stdout, output: child.stdin });
  t.after(() => connection.close());
  return { connection, getStderr: () => stderr };
}

const planOptions = (after, before) => ({
  batchSize: 5,
  filters: { contentTypes: ['post', 'page'], after, before },
  planning: { includeReserved: false, includePages: true },
  disk: {
    reserveBytes: 0,
    maxBytesPerRun: 0,
    maxFileBytes: 256 * 1024 * 1024,
    maxFilesPerRun: 500,
    unknownSizePolicy: 'reject'
  },
  media: { allowExternalMedia: false, concurrency: 4 },
  estimateMedia: false,
  persist: false
});

test('the packaged-host JSON-RPC surface drives wizard discovery to a five-post plan preview', async (t) => {
  const dataRoot = await tempDir(t);
  const data = createFixtureData();
  data.posts = [
    datedPost(1, '2026-11-01T10:00:00'),
    datedPost(2, '2026-11-02T10:00:00'),
    datedPost(3, '2026-11-03T10:00:00'),
    datedPost(4, '2026-11-04T10:00:00'),
    datedPost(5, '2026-11-05T10:00:00'),
    datedPost(6, '2026-10-01T10:00:00')
  ];
  data.pages = [];
  data.media = [];
  const wp = await startWordpressFixtureServer({ data });
  t.after(() => wp.close());
  const { connection, getStderr } = await startHost(t, dataRoot);

  const project = await connection.request('project.create', {
    name: 'Wizard host flow',
    source: { adapter: 'wordpress', baseUrl: wp.url },
    target: { qdnName: 'developer iffi' },
    settings: {
      disk: { reserveBytes: 0, maxBytesPerRun: 0 },
      media: { allowLoopback: true, maxRetries: 0, retryDelayMs: 0 }
    }
  });
  assert.match(project.id, /^prj_/);

  const discovered = await connection.request('source.discover', {
    projectId: project.id,
    adapterId: 'wordpress',
    contentTypes: ['post', 'page'],
    mode: 'full',
    perPage: 100
  });
  assert.equal(discovered.status, 'completed', getStderr());
  assert.ok(discovered.batchId);

  const preview = await connection.request('plan.create', {
    projectId: project.id,
    ...planOptions('2026-11-01T00:00:00.000Z', '2026-11-05T23:59:59.999Z')
  });
  assert.equal(preview.status, 'completed', getStderr());
  assert.equal(preview.plan.status, 'ready');
  assert.equal(preview.stats.selected, 5);
  assert.equal(preview.plan.entries.filter((entry) => entry.qdn).length, 5);

  const empty = await connection.request('plan.create', {
    projectId: project.id,
    ...planOptions('2026-10-05T00:00:00.000Z', '2026-10-21T23:59:59.999Z')
  });
  assert.equal(empty.status, 'completed');
  assert.equal(empty.stats.selected, 0);
  assert.equal(empty.plan.selection.empty, true);
  assert.equal(empty.plan.filterDiagnostics.publishedAfterBefore, 5);
  assert.equal(empty.plan.filterDiagnostics.publishedBeforeAfter, 1);

  const saved = await connection.request('project.update', {
    projectId: project.id,
    patch: {
      settings: {
        desktopWizard: {
          step: 5,
          completedSteps: [1, 2, 3, 4],
          adapterId: 'wordpress',
          sourceUrl: wp.url,
          authMode: 'none',
          connection: { status: 'completed', report: { ok: true } },
          targetQdnName: 'developer iffi',
          siteTitle: 'Wizard host flow',
          siteDescription: '',
          preferences: { batchSize: 5 },
          planId: null,
          updatedAt: new Date().toISOString()
        }
      }
    }
  });
  const wizard = saved.project.settings.desktopWizard;
  // The engine stores the patch verbatim; the desktop IPC layer performs the
  // legacy numeric migration before this call. Prove no data was dropped.
  assert.deepEqual(wizard.completedSteps, [1, 2, 3, 4]);
  assert.equal(wizard.preferences.batchSize, 5);
});
