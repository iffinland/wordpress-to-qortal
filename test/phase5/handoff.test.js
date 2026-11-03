import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertHandoffManifest,
  sealDocument,
  sha256Bytes,
  validateHandoffPackage,
  HANDOFF_SCHEMA
} from '../../lib/engine/publication/index.js';
import { assertReceipt, createReceipt } from '../../lib/engine/publication/receipts.js';
import { startPhase3, makePost } from '../../test-support/phase3/helpers.js';

async function prepareOne(t, options = {}) {
  const env = await startPhase3(t, { posts: [makePost(1), makePost(2), makePost(3)], ...options });
  await env.handle.source.discover({ perPage: 50 });
  const plan = await env.handle.planning.create({ batchSize: 3, estimateMedia: false });
  assert.equal(plan.status, 'completed');
  const selection = plan.plan.entries
    .filter((entry) => ['new', 'modified'].includes(entry.status))
    .map((entry) => entry.sourceKey);
  const handoff = await env.handle.publication.prepare({ planId: plan.planId, selection });
  return { env, plan, handoff, selection };
}

test('a handoff package carries exact validated bytes, ordering and no secrets or absolute paths', async (t) => {
  const { env, handoff } = await prepareOne(t);
  const dir = path.join(env.engine.projects.paths(env.project.id).root, handoff.handoffPath);
  const raw = await readFile(path.join(dir, 'handoff.json'), 'utf8');
  const manifest = JSON.parse(raw);
  assert.equal(manifest.schema, HANDOFF_SCHEMA);
  assert.equal(manifest.resources.length, 11);
  assert.deepEqual(
    [...new Set(manifest.resources.map((resource) => resource.kind))],
    ['content', 'index', 'manifest']
  );
  assert.equal(manifest.resources.at(-1).kind, 'manifest');
  assert.ok(manifest.resources.filter((resource) => resource.kind === 'content').every((resource) => resource.order < manifest.resources.at(-1).order));
  assert.doesNotMatch(raw, /assetPath|password|private_key|seed|mnemonic/i);
  for (const resource of manifest.resources) {
    assert.ok(resource.relativePath.startsWith('payload/'));
    assert.doesNotMatch(resource.relativePath, /(^|\/)\.\.(\/|$)/);
    const bytes = await readFile(path.join(dir, resource.relativePath));
    assert.equal(bytes.length, resource.bytes);
    assert.equal(sha256Bytes(bytes), resource.sha256);
  }
  const verified = await validateHandoffPackage({ handoffDir: dir });
  assert.equal(verified.verified.length, manifest.resources.length);
  assert.equal(verified.summary.projectId, env.project.id);
  assert.equal(manifest.resources.every((resource) => resource.name === 'SyntheticSite'), true);
});

test('tampered payloads, manifest identity, traversal paths and unsupported services fail safely', async (t) => {
  const { env, handoff } = await prepareOne(t);
  const dir = path.join(env.engine.projects.paths(env.project.id).root, handoff.handoffPath);
  const manifest = JSON.parse(await readFile(path.join(dir, 'handoff.json'), 'utf8'));
  const content = manifest.resources.find((resource) => resource.kind === 'content');

  await writeFile(path.join(dir, content.relativePath), Buffer.from('tampered'));
  await assert.rejects(
    () => validateHandoffPackage({ handoffDir: dir }),
    (error) => error.code === 'PUBLICATION_HASH_MISMATCH'
  );

  const duplicate = structuredClone(manifest);
  duplicate.resources[1].identifier = duplicate.resources[0].identifier;
  duplicate.resources[1].service = duplicate.resources[0].service;
  assert.throws(
    () => assertHandoffManifest(sealDocument(duplicate)),
    (error) => error.code === 'PUBLICATION_HANDOFF_INVALID'
  );

  const traversal = structuredClone(manifest);
  traversal.resources[0].relativePath = 'payload/../escape.json';
  assert.throws(
    () => assertHandoffManifest(sealDocument(traversal)),
    (error) => ['PUBLICATION_HANDOFF_INVALID', 'PUBLICATION_PACKAGE_CORRUPT'].includes(error.code)
  );

  const unsupported = structuredClone(manifest);
  unsupported.resources[0].service = 'WEBSITE';
  assert.throws(
    () => assertHandoffManifest(sealDocument(unsupported)),
    (error) => error.code === 'PUBLICATION_HANDOFF_INVALID'
  );

  const integrity = structuredClone(manifest);
  integrity.target.qdnName = 'OtherName';
  assert.throws(
    () => assertHandoffManifest(integrity),
    (error) => error.code === 'PUBLICATION_PACKAGE_CORRUPT'
  );
});

test('receipts reject cross-project identity, mismatched resources and tampered integrity', async (t) => {
  const { env, handoff } = await prepareOne(t);
  const stored = await env.handle.publication.get(handoff.handoffId);
  const results = stored.handoff.resources.map((resource, index) => ({
    resourceId: resource.id,
    service: resource.service,
    name: resource.name,
    identifier: resource.identifier,
    status: 'submitted',
    txSignature: 'sig-' + index
  }));
  const receipt = createReceipt({
    handoff: stored.handoff,
    receiptId: 'rcp_abcdefgh12345678',
    publisher: { accountAddress: 'QZLJV7wbaFyxaoZQsjm6rb9MWMiDzWsqM2', name: 'SyntheticSite', appVersion: '0.5.0' },
    results,
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:10.000Z'
  });
  assertReceipt(receipt, { expect: stored.handoff });

  const other = createReceipt({
    handoff: { ...stored.handoff, projectId: 'prj_other-project', siteId: 'site_' + 'a'.repeat(32) },
    receiptId: 'rcp_other12345678',
    publisher: { accountAddress: 'QZLJV7wbaFyxaoZQsjm6rb9MWMiDzWsqM2', name: 'SyntheticSite' },
    results,
    createdAt: '2026-01-01T00:00:00.000Z'
  });
  await assert.rejects(
    () => env.handle.publication.importReceipt({ handoffId: handoff.handoffId, receipt: other }),
    (error) => error.code === 'PUBLICATION_CROSS_PROJECT'
  );

  const tampered = structuredClone(receipt);
  tampered.counts.submitted = 999;
  await assert.rejects(
    () => env.handle.publication.importReceipt({ handoffId: handoff.handoffId, receipt: tampered }),
    (error) => error.code === 'PUBLICATION_PACKAGE_CORRUPT'
  );

  const changedIdentity = structuredClone(receipt);
  changedIdentity.results[0].identifier = 'qms-other-identifier';
  changedIdentity.integrity = { algorithm: 'sha256', value: 'sha256:' + '0'.repeat(64) };
  await assert.rejects(
    () => env.handle.publication.importReceipt({ handoffId: handoff.handoffId, receipt: changedIdentity }),
    (error) => ['PUBLICATION_PACKAGE_CORRUPT', 'PUBLICATION_RECEIPT_MISMATCH'].includes(error.code)
  );
});
