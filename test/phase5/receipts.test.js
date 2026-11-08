import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startPhase3, makePost } from '../../test-support/phase3/helpers.js';
import { startQdnServer } from '../../test-support/phase5/qdnServer.js';
import { createReceipt } from '../../lib/engine/publication/receipts.js';

const ADDRESS = 'QZLJV7wbaFyxaoZQsjm6rb9MWMiDzWsqM2';

async function prepare(t, options = {}) {
  const env = await startPhase3(t, { posts: [makePost(1), makePost(2)], ...options });
  await env.handle.source.discover({ mode: 'full', perPage: 50 });
  const plan = await env.handle.planning.create({ batchSize: 2, estimateMedia: false });
  const selection = plan.plan.entries.filter((entry) => entry.status === 'new').map((entry) => entry.sourceKey);
  const handoff = await env.handle.publication.prepare({ planId: plan.planId, selection });
  return { env, plan, handoff };
}

async function populate(server, env, handoff) {
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

function receiptFor(stored, status = 'submitted') {
  return createReceipt({
    handoff: stored.handoff,
    receiptId: 'rcp_' + 'a'.repeat(20),
    publisher: { accountAddress: ADDRESS, name: stored.handoff.target.qdnName, appVersion: '0.5.0' },
    results: stored.handoff.resources.map((resource) => ({
      resourceId: resource.id,
      service: resource.service,
      name: resource.name,
      identifier: resource.identifier,
      status,
      txSignature: status === 'submitted' ? 'sig-' + resource.id : null
    })),
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:05:00.000Z'
  });
}

test('a receipt is Publisher evidence only; exact QDN read-back promotes mappings', async (t) => {
  const { env, handoff } = await prepare(t);
  const server = await startQdnServer();
  t.after(() => server.close());
  const stored = await env.handle.publication.get(handoff.handoffId);
  const receipt = receiptFor(stored);
  const imported = await env.handle.publication.importReceipt({ handoffId: handoff.handoffId, receipt });
  assert.equal(imported.independentVerificationRequired, true);
  assert.equal(imported.resources.every((resource) => resource.status === 'submitted'), true);
  assert.equal(env.handle.identity.mappingFor('post:1001').publicationStatus, 'reserved');

  await populate(server, env, handoff);
  const verified = await env.handle.publication.verify({
    handoffId: handoff.handoffId,
    nodeUrl: server.url,
    attempts: 1,
    intervalMs: 0
  });
  assert.equal(verified.counts.remote_verified, stored.handoff.resources.length);
  assert.equal(env.handle.identity.mappingFor('post:1001').publicationStatus, 'remote_verified');
  assert.ok(env.handle.identity.mappingFor('post:1001').remoteVerifiedAt);
  assert.equal(env.handle.publication.list()[0].status, 'remote_verified');
});

test('pending, mismatched and unavailable reads stay unverified and preserve ambiguity', async (t) => {
  const { env, handoff } = await prepare(t);
  const stored = await env.handle.publication.get(handoff.handoffId);
  await env.handle.publication.importReceipt({ handoffId: handoff.handoffId, receipt: receiptFor(stored, 'ambiguous') });
  assert.equal((await env.handle.publication.get(handoff.handoffId)).resources.every((resource) => resource.status === 'ambiguous'), true);

  const empty = await startQdnServer();
  t.after(() => empty.close());
  const pending = await env.handle.publication.verify({
    handoffId: handoff.handoffId,
    nodeUrl: empty.url,
    attempts: 1,
    intervalMs: 0
  });
  assert.equal(pending.counts.pending, stored.handoff.resources.length);
  assert.equal((await env.handle.publication.get(handoff.handoffId)).resources.every((resource) => resource.status === 'pending_confirmation'), true);
  assert.equal(env.handle.identity.mappingFor('post:1001').publicationStatus, 'reserved');

  const mismatch = await startQdnServer();
  t.after(() => mismatch.close());
  const manifest = await populate(mismatch, env, handoff);
  const first = manifest.resources.find((resource) => resource.kind === 'content');
  mismatch.set({ service: first.service, name: first.name, identifier: first.identifier, bytes: Buffer.from('wrong bytes') });
  const ambiguous = await env.handle.publication.verify({
    handoffId: handoff.handoffId,
    nodeUrl: mismatch.url,
    attempts: 1,
    intervalMs: 0
  });
  assert.equal(ambiguous.counts.ambiguous >= 1, true);
  assert.equal(env.handle.identity.mappingFor(first.sourceKey ?? 'post:1001').publicationStatus, 'reserved');
});

test('a receipt missing resources imports them as ambiguous and marks the handoff partial', async (t) => {
  const { env, handoff } = await prepare(t);
  const stored = await env.handle.publication.get(handoff.handoffId);
  const first = stored.handoff.resources[0];
  const receipt = createReceipt({
    handoff: stored.handoff,
    receiptId: 'rcp_partial12345678',
    publisher: { accountAddress: ADDRESS, name: stored.handoff.target.qdnName, appVersion: '0.5.0' },
    results: [{
      resourceId: first.id,
      service: first.service,
      name: first.name,
      identifier: first.identifier,
      status: 'submitted'
    }],
    createdAt: '2026-01-01T00:00:00.000Z'
  });
  const imported = await env.handle.publication.importReceipt({ handoffId: handoff.handoffId, receipt });
  assert.equal(imported.status, 'partial');
  assert.equal(imported.resources.filter((resource) => resource.reason && resource.reason.includes('did not include')).length >= 1, true);
  assert.equal((await env.handle.publication.get(handoff.handoffId)).handoff.status, 'partial');
});

test('receipts are cross-project rejected and survive restart with partial states', async (t) => {
  const { env, handoff } = await prepare(t);
  const stored = await env.handle.publication.get(handoff.handoffId);
  const receipt = receiptFor(stored, 'failed');
  await env.handle.publication.importReceipt({ handoffId: handoff.handoffId, receipt });
  assert.equal((await env.handle.publication.get(handoff.handoffId)).resources.every((resource) => resource.status === 'failed'), true);
  await env.handle.close();

  const reopened = await env.engine.projects.open(env.project.id);
  t.after(() => reopened.close().catch(() => {}));
  assert.equal((await reopened.publication.get(handoff.handoffId)).resources.every((resource) => resource.status === 'failed'), true);
  assert.ok(reopened.publication.history().some((entry) => entry.type === 'receipt_imported'));

  const other = await env.engine.projects.create({
    name: 'Second Site',
    source: { adapter: 'wordpress', baseUrl: env.wp.url },
    target: { qdnName: 'OtherSite' },
    settings: { disk: { reserveBytes: 0, maxBytesPerRun: 0 }, media: { allowLoopback: true } }
  });
  const otherHandle = await env.engine.projects.open(other.id);
  t.after(() => otherHandle.close().catch(() => {}));
  await otherHandle.source.discover({ mode: 'full', perPage: 50 });
  const otherPlan = await otherHandle.planning.create({ batchSize: 1, estimateMedia: false });
  const otherSelection = otherPlan.plan.entries.filter((entry) => entry.status === 'new').map((entry) => entry.sourceKey);
  const otherHandoff = await otherHandle.publication.prepare({ planId: otherPlan.planId, selection: otherSelection });
  const otherStored = await otherHandle.publication.get(otherHandoff.handoffId);
  const foreignReceipt = createReceipt({
    handoff: {
      ...stored.handoff,
      projectId: otherStored.handoff.projectId,
      siteId: otherStored.handoff.siteId
    },
    receiptId: 'rcp_' + 'b'.repeat(20),
    publisher: { accountAddress: ADDRESS, name: otherStored.handoff.target.qdnName, appVersion: '0.5.0' },
    results: stored.handoff.resources.map((resource) => ({
      resourceId: resource.id,
      service: resource.service,
      name: resource.name,
      identifier: resource.identifier,
      status: 'submitted'
    })),
    createdAt: '2026-01-01T00:00:00.000Z'
  });
  await assert.rejects(
    () => reopened.publication.importReceipt({ handoffId: handoff.handoffId, receipt: foreignReceipt }),
    (error) => error.code === 'PUBLICATION_CROSS_PROJECT'
  );
});
