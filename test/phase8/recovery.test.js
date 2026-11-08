import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  startPhase8,
  crashDuring,
  discoverAndPlan,
  downloadAll,
  selectionFor,
  preparePublishVerify,
  receiptFor,
  writeReceiptFile,
  populateQdn
} from './support.js';
import { startQdnServer } from '../../test-support/phase5/qdnServer.js';

function projectRoot(env) {
  return env.engine.projects.paths(env.project.id).root;
}

async function assetFiles(env) {
  const directory = path.join(projectRoot(env), 'media', 'assets');
  const out = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) out.push(absolute);
    }
  }
  await walk(directory);
  return out.sort();
}

test('AC8.1 kill during discovery leaves a resumable run and resumes without duplicate batches or media', async (t) => {
  const env = await startPhase8(t);
  const handle = await crashDuring(env, {
    mode: 'discover',
    options: { perPage: 50 },
    kind: 'source.discover',
    step: 'connect'
  });
  const status = await handle.recovery.status();
  assert.equal(status.recovery.interruptedRuns >= 1, true, JSON.stringify(status));
  const candidate = status.candidates.find((entry) => entry.kind === 'source.discover');
  assert.ok(candidate, JSON.stringify(status.candidates));
  assert.equal(candidate.resumable, true);
  assert.equal(candidate.action.service, 'source');

  const resumed = await handle.recovery.resume(candidate.runId);
  assert.equal(resumed.result.status, 'completed', JSON.stringify(resumed.result));
  assert.ok(resumed.result.batchId);
  const after = await handle.recovery.status();
  assert.equal(after.candidates.some((entry) => entry.runId === candidate.runId && entry.resumable), false);

  await assert.rejects(
    () => handle.recovery.resume(candidate.runId),
    (error) => error.code === 'RECOVERY_NOT_RESUMABLE'
  );
  assert.equal((await assetFiles(env)).length, 0);
});

test('AC8.1 kill during planning resumes and produces exactly one usable plan', async (t) => {
  const env = await startPhase8(t);
  await env.handle.source.discover({ mode: 'full', perPage: 50 });
  const handle = await crashDuring(env, {
    mode: 'plan',
    options: { batchSize: 2 },
    kind: 'plan.create',
    step: 'classify_start'
  });
  const status = await handle.recovery.status();
  const candidate = status.candidates.find((entry) => entry.kind === 'plan.create');
  assert.ok(candidate?.resumable, JSON.stringify(status.candidates));
  const resumed = await handle.recovery.resume(candidate.runId);
  assert.equal(resumed.result.status, 'completed', JSON.stringify(resumed.result.errors ?? []));
  const plan = await handle.planning.get(resumed.result.planId);
  assert.equal(plan.plan.status, 'ready');
  assert.equal(plan.plan.entries.length, 2);
  const mappings = handle.identity.listMappings();
  assert.equal(mappings.length, 2);
});

test('AC8.1 kill during media download resumes without duplicate files or bytes', async (t) => {
  const env = await startPhase8(t);
  const { plan } = await discoverAndPlan(env, { batchSize: 2 });
  const detail = await env.handle.planning.get(plan.planId);
  assert.ok(detail.plan.media.length >= 2, JSON.stringify(detail.plan.media));
  const handle = await crashDuring(env, {
    mode: 'download',
    options: { planId: plan.planId },
    kind: 'media.download',
    step: 'download_record'
  });
  const beforeFiles = await assetFiles(env);
  assert.equal(beforeFiles.length >= 1, true);
  const status = await handle.recovery.status();
  const candidate = status.candidates.find((entry) => entry.kind === 'media.download');
  assert.ok(candidate?.resumable, JSON.stringify(status.candidates));
  const resumed = await handle.recovery.resume(candidate.runId);
  assert.ok(['completed', 'blocked'].includes(resumed.result.status), JSON.stringify(resumed.result));
  const afterFiles = await assetFiles(env);
  assert.deepEqual(afterFiles, beforeFiles, 'resuming must not duplicate content-addressed assets');
  const inspection = await handle.media.inspect();
  assert.equal(inspection.totals.assets, beforeFiles.length);
  assert.ok(inspection.receipts.every((receipt) => receipt.status === 'verified'));
  const second = await handle.media.download({ planId: plan.planId });
  assert.ok(second.receipts.every((receipt) => receipt.reused !== false || receipt.status === 'verified'));
  assert.deepEqual(await assetFiles(env), beforeFiles);
});

test('AC8.1 kill during handoff preparation resumes and never duplicates a handoff', async (t) => {
  const env = await startPhase8(t);
  const { plan } = await discoverAndPlan(env, { batchSize: 2 });
  await downloadAll(env, plan.planId);
  const selection = selectionFor(plan);
  const handle = await crashDuring(env, {
    mode: 'prepare',
    options: { planId: plan.planId, selection },
    stage: 'stg_prepare'
  });
  const status = await handle.recovery.status();
  const stage = status.candidates.find((entry) => entry.stageId?.startsWith('stg_prepare'));
  assert.ok(stage?.resumable, JSON.stringify(status.candidates));
  const resumed = await handle.recovery.resume(stage.stageId);
  assert.ok(resumed.result.handoffId);
  const handoffs = Object.values(handle.store.state.publication.handoffs);
  assert.equal(handoffs.length, 1);
  const again = await handle.publication.prepare({ planId: plan.planId, selection });
  assert.equal(again.reused, true);
  assert.equal(again.handoffId, resumed.result.handoffId);
  assert.equal(Object.values(handle.store.state.publication.handoffs).length, 1);
});

test('AC8.1 kill between receipt write and state commit resumes the stored receipt exactly once', async (t) => {
  const env = await startPhase8(t);
  const { plan } = await discoverAndPlan(env, { batchSize: 2 });
  await downloadAll(env, plan.planId);
  const handoff = await env.handle.publication.prepare({ planId: plan.planId, selection: selectionFor(plan) });
  const server = await startQdnServer();
  t.after(() => server.close());
  await populateQdn(server, env, handoff);
  const stored = await env.handle.publication.get(handoff.handoffId);
  const receipt = receiptFor(stored.handoff, { suffix: 'b' });
  const receiptPath = await writeReceiptFile(env, stored.handoff, receipt, 'receipt-crash.json');

  const handle = await crashDuring(env, {
    mode: 'receipt',
    options: { handoffId: handoff.handoffId, receiptPath },
    stage: 'stg_receipt',
    step: 'receipt_written'
  });
  const status = await handle.recovery.status();
  const stage = status.candidates.find((entry) => entry.stageId?.startsWith('stg_receipt'));
  assert.ok(stage?.resumable, JSON.stringify(status.candidates));
  const resumed = await handle.recovery.resume(stage.stageId);
  assert.equal(resumed.result.receiptId, receipt.receiptId);
  const resources = await handle.publication.resourceStates({ handoffId: handoff.handoffId });
  assert.ok(resources.every((resource) => ['pending_confirmation', 'submitted'].includes(resource.status)));
  const again = await handle.publication.importReceipt({ handoffId: handoff.handoffId, receipt });
  assert.equal(again.receiptId, receipt.receiptId);
  assert.equal((await handle.publication.resourceStates({ handoffId: handoff.handoffId })).length, resources.length);
});

test('AC8.1 kill during verification resumes to exact remote_verified and never duplicates resources', async (t) => {
  const env = await startPhase8(t);
  const { plan } = await discoverAndPlan(env, { batchSize: 2 });
  await downloadAll(env, plan.planId);
  const handoff = await env.handle.publication.prepare({ planId: plan.planId, selection: selectionFor(plan) });
  const server = await startQdnServer();
  t.after(() => server.close());
  await populateQdn(server, env, handoff);
  const stored = await env.handle.publication.get(handoff.handoffId);
  const receipt = receiptFor(stored.handoff, { suffix: 'd' });
  await env.handle.publication.importReceipt({ handoffId: handoff.handoffId, receipt });

  const handle = await crashDuring(env, {
    mode: 'verify',
    options: { handoffId: handoff.handoffId, nodeUrl: server.url, attempts: 1, intervalMs: 0 },
    stage: 'stg_verify',
    step: 'verify_start'
  });
  const status = await handle.recovery.status();
  const stage = status.candidates.find((entry) => entry.stageId?.startsWith('stg_verify'));
  assert.ok(stage?.resumable, JSON.stringify(status.candidates));
  const resumed = await handle.recovery.resume(stage.stageId);
  assert.equal(resumed.result.counts.remote_verified, stored.handoff.resources.length);
  const resources = await handle.publication.resourceStates({ handoffId: handoff.handoffId });
  assert.ok(resources.every((resource) => resource.status === 'remote_verified'));
  const verifiedAgain = await handle.publication.verify({
    handoffId: handoff.handoffId,
    nodeUrl: server.url,
    attempts: 1,
    intervalMs: 0
  });
  assert.equal(verifiedAgain.resources.length, resources.length);
  assert.equal((await handle.publication.resourceStates({ handoffId: handoff.handoffId })).length, resources.length);
});

test('ambiguous publication state from an interrupted submission requires reconciliation and never resubmits', async (t) => {
  const env = await startPhase8(t);
  const { plan } = await discoverAndPlan(env, { batchSize: 2 });
  await downloadAll(env, plan.planId);
  const handoff = await env.handle.publication.prepare({ planId: plan.planId, selection: selectionFor(plan) });
  const server = await startQdnServer();
  t.after(() => server.close());
  await populateQdn(server, env, handoff);
  // Simulate a crash after a publisher submitted but before any receipt was imported.
  await env.handle.store.transaction((draft) => {
    for (const resource of Object.values(draft.publication.resources)) {
      resource.status = 'submitted';
      resource.state = 'submitted';
    }
    const handoffRecord = draft.publication.handoffs[handoff.handoffId];
    handoffRecord.status = 'submitted';
    handoffRecord.resources = handoffRecord.resources.map((resource) => ({ ...resource, status: 'submitted' }));
  });
  await env.reopen();
  const status = await env.handle.recovery.status();
  assert.equal(status.ambiguousResources.length > 0, true, JSON.stringify(status));
  assert.ok(status.ambiguousResources.every((entry) => entry.requiresReconciliation === true));
  const requestsBefore = server.requests.length;
  const reconciled = await env.handle.recovery.reconcilePublication({ handoffId: handoff.handoffId, nodeUrl: server.url });
  assert.equal(reconciled.resubmitted, false);
  assert.equal(reconciled.verified, reconciled.reconciled);
  assert.equal(server.requests.length > requestsBefore, true);
  const resources = await env.handle.publication.resourceStates({ handoffId: handoff.handoffId });
  assert.ok(resources.every((resource) => resource.status === 'remote_verified'));
  assert.ok(resources.every((resource) => resource.txSignature == null || typeof resource.txSignature === 'string'));
});

test('network loss during verification leaves evidence unverified and a later read-back verifies it', async (t) => {
  const env = await startPhase8(t);
  const { plan } = await discoverAndPlan(env, { batchSize: 2 });
  await downloadAll(env, plan.planId);
  const handoff = await env.handle.publication.prepare({ planId: plan.planId, selection: selectionFor(plan) });
  const server = await startQdnServer();
  await populateQdn(server, env, handoff);
  const stored = await env.handle.publication.get(handoff.handoffId);
  await env.handle.publication.importReceipt({
    handoffId: handoff.handoffId,
    receipt: receiptFor(stored.handoff, { suffix: 'e' })
  });
  const url = server.url;
  await server.close();
  const failed = await env.handle.publication.verify({
    handoffId: handoff.handoffId,
    nodeUrl: url,
    attempts: 1,
    intervalMs: 0
  });
  assert.equal(failed.counts.remote_verified ?? 0, 0, JSON.stringify(failed.counts));
  const resources = await env.handle.publication.resourceStates({ handoffId: handoff.handoffId });
  assert.ok(resources.every((resource) => resource.status !== 'remote_verified'));
  const live = await startQdnServer();
  t.after(() => live.close());
  await populateQdn(live, env, handoff);
  const verified = await env.handle.publication.verify({
    handoffId: handoff.handoffId,
    nodeUrl: live.url,
    attempts: 1,
    intervalMs: 0
  });
  assert.equal(verified.counts.remote_verified, resources.length);
});

test('power loss (torn checkpoint file) is reported without breaking recovery or opening the project', async (t) => {
  const env = await startPhase8(t);
  await env.handle.source.discover({ mode: 'full', perPage: 50 });
  const handle = await crashDuring(env, {
    mode: 'plan',
    options: { batchSize: 2 },
    kind: 'plan.create',
    step: 'classify_start'
  });
  const runs = Object.values(handle.store.state.runs);
  const interrupted = runs.find((run) => run.state === 'interrupted');
  assert.ok(interrupted, JSON.stringify(runs.map((run) => run.state)));
  const checkpointFile = path.join(projectRoot(env), 'recovery', 'runs', interrupted.id + '.json');
  const raw = await readFile(checkpointFile, 'utf8');
  await writeFile(checkpointFile, raw.slice(0, Math.floor(raw.length / 2)), 'utf8');
  await env.reopen();
  const status = await env.handle.recovery.status();
  assert.equal(status.corruptCheckpoints.length > 0, true, JSON.stringify(status.corruptCheckpoints));
  assert.ok(env.handle.project);
  // Cleanup preview must still work with a corrupt checkpoint present.
  const preview = await env.handle.cleanup.preview({});
  assert.equal(preview.schema, 'qms-cleanup-preview@1');
});


test('pause is a safe resumable boundary and cleanup refuses while an operation is active', async (t) => {
  const env = await startPhase8(t);
  const context = await env.handle.runs.start({ kind: 'source.discover', phase: 'connect', meta: { adapterId: 'wordpress' } });
  await context.checkpoint({
    step: 'connect',
    phase: 'connect',
    resumable: true,
    resume: { service: 'source', method: 'discover', params: { perPage: 50 } },
    details: { pausedByTest: true }
  });
  await assert.rejects(
    () => env.handle.cleanup.start({}),
    (error) => error.code === 'CLEANUP_ACTIVE_RUN'
  );
  await env.handle.runs.pause(context.runId);
  await context.cancel('paused by test');
  const run = env.handle.store.state.runs[context.runId];
  assert.equal(run.state, 'paused');
  const status = await env.handle.recovery.status();
  const candidate = status.candidates.find((entry) => entry.runId === context.runId);
  assert.ok(candidate, JSON.stringify(status.candidates));
  assert.equal(candidate.state, 'paused');
  assert.equal(candidate.resumable, true);
  await env.handle.runs.cancel(context.runId).catch(() => {});
});

