import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { startPhase3, makePost, dataWithPosts } from '../../test-support/phase3/helpers.js';
import { startQdnServer } from '../../test-support/phase5/qdnServer.js';
import { createEngine } from '../../lib/engine/index.js';
import { createReceipt } from '../../lib/engine/publication/receipts.js';

const execFileAsync = promisify(execFile);
export const ADDRESS = 'QZLJV7wbaFyxaoZQsjm6rb9MWMiDzWsqM2';
const WORKER = path.join(import.meta.dirname, '..', '..', 'test-support', 'phase8', 'crashWorker.mjs');

export function mediaPost(mediaUrl, index = 0, size = 2048, extra = {}) {
  return makePost(index, {
    content: '<p>Phase 8 media body ' + index + '</p><img src="' + mediaUrl + '/media/known/alpha.jpg?bytes=' + size + '&p=' + index + '">',
    ...extra
  });
}

export async function startPhase8(t, options = {}) {
  const env = await startPhase3(t, {
    mediaServer: true,
    dataFactory: ({ mediaUrl }) => dataWithPosts([
      mediaPost(mediaUrl, 0, 2048),
      mediaPost(mediaUrl, 1, 2048)
    ]),
    settings: { media: { allowExternalMedia: true } },
    ...options
  });
  env.projectRoot = env.engine.projects.paths(env.project.id).root;
  env.reopen = async ({ recoverStaleLock = true, engineOptions = {} } = {}) => {
    await env.handle.close().catch(() => {});
    const engine = createEngine({ dataRoot: env.dataRoot, ...engineOptions });
    env.engine = engine;
    env.handle = await engine.projects.open(env.project.id, { recoverStaleLock });
    return env.handle;
  };
  t.after(async () => {
    await env.handle?.close().catch(() => {});
  });
  return env;
}

/**
 * Run one real engine operation in a child process and SIGKILL it at the
 * configured checkpoint. The parent must not hold the project lock.
 */
export async function crashDuring(env, { mode, options = {}, kind = null, step = null, stage = null, after = null }) {
  await env.handle.close();
  const childEnv = { ...process.env };
  delete childEnv.QMS_DATA_ROOT;
  if (kind) childEnv.QMS_CRASH_KIND = kind;
  if (step) childEnv.QMS_CRASH_STEP = step;
  if (stage) childEnv.QMS_CRASH_STAGE = stage;
  if (after !== null) childEnv.QMS_CRASH_AFTER = String(after);
  let killed = false;
  try {
    await execFileAsync(process.execPath, [WORKER, env.dataRoot, env.project.id, mode, JSON.stringify(options)], {
      env: childEnv,
      timeout: 120000
    });
  } catch (error) {
    killed = error.signal === 'SIGKILL' || error.code === null || error.signal === 'SIGKILL';
    if (!killed) throw error;
  }
  assert.equal(killed, true, 'the crash worker should have been killed at a checkpoint');
  const engine = createEngine({ dataRoot: env.dataRoot });
  env.engine = engine;
  env.handle = await engine.projects.open(env.project.id, { recoverStaleLock: true });
  return env.handle;
}

export async function discoverAndPlan(env, { batchSize = 2, perPage = 50, settings = {} } = {}) {
  const discovery = await env.handle.source.discover({ perPage, ...(settings.discover ?? {}) });
  assert.equal(discovery.status, 'completed', JSON.stringify(discovery.error ?? {}));
  const plan = await env.handle.planning.create({ batchSize, ...(settings.planning ?? {}) });
  assert.equal(plan.status, 'completed', JSON.stringify(plan.errors ?? []));
  return { discovery, plan };
}

export async function downloadAll(env, planId) {
  const download = await env.handle.media.download({ planId });
  assert.ok(['completed', 'blocked'].includes(download.status), JSON.stringify(download));
  return download;
}

export function selectionFor(plan) {
  return plan.plan.entries
    .filter((entry) => ['new', 'modified', 'route_changed', 'reserved'].includes(entry.status))
    .map((entry) => entry.sourceKey);
}

export function receiptFor(handoff, { status = 'submitted', suffix = 'a', results = null } = {}) {
  return createReceipt({
    handoff,
    receiptId: 'rcp_' + String(suffix).repeat(20).slice(0, 20),
    publisher: {
      accountAddress: ADDRESS,
      name: handoff.target.qdnName,
      appVersion: '0.6.0'
    },
    results: results ?? handoff.resources.map((resource) => ({
      resourceId: resource.id,
      service: resource.service,
      name: resource.name,
      identifier: resource.identifier,
      status,
      txSignature: 'sig_' + resource.id
    })),
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:05:00.000Z'
  });
}

export async function populateQdn(server, env, handoff) {
  const root = path.join(env.engine.projects.paths(env.project.id).root, handoff.handoffPath);
  const manifest = JSON.parse(await readFile(path.join(root, 'handoff.json'), 'utf8'));
  for (const resource of manifest.resources) {
    const bytes = await readFile(path.join(root, resource.relativePath));
    server.set({
      service: resource.service,
      name: resource.name,
      identifier: resource.identifier,
      bytes,
      contentType: resource.contentType
    });
  }
  return manifest;
}

export async function preparePublishVerify(t, env, { plan, selection, attempts = 1, server = null, receiptStatus = 'submitted' } = {}) {
  const handoff = await env.handle.publication.prepare({
    planId: plan.planId,
    selection: selection ?? selectionFor(plan)
  });
  const qdn = server ?? await startQdnServer();
  if (!server && typeof t?.after === 'function') t.after(() => qdn.close());
  await populateQdn(qdn, env, handoff);
  const stored = await env.handle.publication.get(handoff.handoffId);
  await env.handle.publication.importReceipt({
    handoffId: handoff.handoffId,
    receipt: receiptFor(stored.handoff, { status: receiptStatus })
  });
  const verified = await env.handle.publication.verify({
    handoffId: handoff.handoffId,
    nodeUrl: qdn.url,
    attempts,
    intervalMs: 0
  });
  return { handoff, qdn, verified };
}

export async function writeReceiptFile(env, handoff, receipt, name = 'receipt-a.json') {
  const directory = path.join(env.dataRoot, 'phase8-inputs');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, name);
  await writeFile(file, JSON.stringify(receipt), 'utf8');
  return file;
}

