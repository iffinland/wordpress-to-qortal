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
import { startPhase3, makePost, dataWithPosts } from '../../test-support/phase3/helpers.js';
import { buildFolderMapFromZip, validateHandoffPackage as validatePublisherHandoff } from '../../viewer/src/publisher/handoff.ts';

async function prepareOne(t, options = {}) {
  const env = await startPhase3(t, { posts: [makePost(1), makePost(2), makePost(3)], ...options });
  await env.handle.source.discover({ mode: 'full', perPage: 50 });
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
  assert.equal(manifest.resources.length, 12);
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

test('a stale numeric srcset row is refreshed from stored HTML without discarding verified media', async (t) => {
  const env = await startPhase3(t, {
    mediaServer: true,
    dataFactory: ({ mediaUrl }) => dataWithPosts([makePost(1, {
        content: `<img src="${mediaUrl}/media/known/alpha.jpg?bytes=2048" srcset="${mediaUrl}/media/known/alpha.jpg?bytes=2048 1x">`
      })]),
    settings: { media: { allowExternalMedia: true } }
  });
  await env.handle.source.discover({ mode: 'full', perPage: 50 });
  const plan = await env.handle.planning.create({ batchSize: 1 });
  assert.equal(plan.plan.media.length, 1, 'src and srcset duplicate one required URL');
  const download = await env.handle.media.download({ planId: plan.planId });
  assert.equal(download.counts.verified, 1);

  // Simulate the persisted rc.3 plan row produced from a NASA-style `,683`
  // resize component. The source document and verified receipt are unchanged.
  const entry = plan.plan.entries.find((candidate) => candidate.status === 'new');
  plan.plan.media.push({
    url: env.wp.url + '/683',
    items: [entry.id],
    sourceKeys: [entry.sourceKey],
    roles: ['responsive'],
    mimeType: 'image/jpeg',
    external: false,
    status: 'missing',
    bytes: null,
    contentType: null,
    finalUrl: null,
    reason: 'HTTP_404',
    code: 'MEDIA_NOT_FOUND',
    message: 'not found'
  });
  await writeFile(plan.planFile, JSON.stringify(plan.plan, null, 2) + '\n');

  const handoff = await env.handle.publication.prepare({ planId: plan.planId, selection: [entry.sourceKey] });
  assert.equal(handoff.status, 'handoff_ready');
  assert.equal(handoff.resources.filter((resource) => resource.kind === 'media').length, 1);
  const payload = handoff.resources.find((resource) => resource.kind === 'content');
  const handoffDir = path.join(env.handle.paths.root, handoff.handoffPath);
  const body = await readFile(path.join(handoffDir, payload.relativePath), 'utf8');
  assert.doesNotMatch(body, /\/683(?:\"|$)/);
});

test('a current missing srcset asset still blocks handoff preparation', async (t) => {
  const env = await startPhase3(t, {
    mediaServer: true,
    dataFactory: ({ mediaUrl }) => dataWithPosts([makePost(1, {
        content: `<img src="${mediaUrl}/media/known/alpha.jpg?bytes=2048" srcset="${mediaUrl}/media/known/alpha.jpg?bytes=2048 1x, ${mediaUrl}/media/missing 2x">`
      })]),
    settings: { media: { allowExternalMedia: true } }
  });
  await env.handle.source.discover({ mode: 'full', perPage: 50 });
  const plan = await env.handle.planning.create({ batchSize: 1 });
  const entry = plan.plan.entries.find((candidate) => candidate.status === 'new');
  assert.ok(plan.plan.media.some((media) => media.url.endsWith('/media/missing') && media.status === 'missing'));
  await assert.rejects(
    () => env.handle.publication.prepare({ planId: plan.planId, selection: [entry.sourceKey] }),
    (error) => error.code === 'PUBLICATION_NOT_READY' && error.details.missing.some((media) => media.url.endsWith('/media/missing'))
  );
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

test('an rc.3 content-only partial handoff blocks CMS continuation until exact reconciliation, then creates a CMS-only successor', async (t) => {
  const env = await startPhase3(t, {
    posts: [makePost(1), makePost(2), makePost(3), makePost(4)],
    settings: { extra: { website: { cms: 'none' } } }
  });
  await env.handle.source.discover({ mode: 'full', perPage: 50 });
  const plan = await env.handle.planning.create({ batchSize: 4, estimateMedia: false });
  const selection = plan.plan.entries.filter((entry) => entry.status === 'new').map((entry) => entry.sourceKey);
  const original = await env.handle.publication.prepare({ planId: plan.planId, selection });
  const originalDetail = await env.handle.publication.get(original.handoffId);
  const originalDir = path.join(env.handle.paths.root, original.handoffPath);

  // Model the persisted rc.3 package: it has no CMS declaration, and only a
  // verified subset of resources. Its bytes and audit record remain in place.
  const legacy = JSON.parse(await readFile(path.join(originalDir, 'handoff.json'), 'utf8'));
  delete legacy.cms;
  await writeFile(path.join(originalDir, 'handoff.json'), JSON.stringify(sealDocument(legacy), null, 2) + '\n');
  const split = Math.floor(originalDetail.resources.length / 2);
  await env.handle.store.transaction((draft) => {
    const record = draft.publication.handoffs[original.handoffId];
    record.resources = record.resources.map((resource, index) => ({
      ...resource,
      status: index < split ? 'remote_verified' : 'ambiguous',
      state: index < split ? 'remote_verified' : 'ambiguous'
    }));
    record.status = 'partial';
  });
  await env.handle.update({ settings: { website: { cms: 'generic-cms', service: 'APP', tagline: 'Fixed CMS deployment' } } });

  await assert.rejects(
    () => env.handle.publication.prepare({ planId: plan.planId, selection }),
    (error) => error.code === 'PUBLICATION_BLOCKED'
      && /CMS-only continuation is blocked/.test(error.message)
      && error.details.handoffId === original.handoffId
      && error.details.unresolved === originalDetail.resources.length - split
  );
  const preserved = await env.handle.publication.get(original.handoffId);
  assert.equal(preserved.handoff.status, 'partial');
  assert.equal(preserved.resources.filter((resource) => resource.status === 'ambiguous').length, originalDetail.resources.length - split);

  // This represents a successful read-only exact verification run, never a
  // retry or resubmission. The successor must carry only that verified
  // manifest and the new APP bundle, not the former content/media writes.
  await env.handle.store.transaction((draft) => {
    const record = draft.publication.handoffs[original.handoffId];
    record.resources = record.resources.map((resource) => ({ ...resource, status: 'remote_verified', state: 'remote_verified' }));
    record.status = 'remote_verified';
  });
  const successor = await env.handle.publication.prepare({ planId: plan.planId, selection });
  assert.equal(successor.reused, false);
  assert.equal(successor.resources.length, 2);
  assert.deepEqual(successor.resources.map((resource) => resource.kind), ['manifest', 'site']);
  assert.equal(successor.cms.selection, 'generic-cms');
  assert.match(successor.cms.message, /CMS-only successor/);
  const successorDetail = await env.handle.publication.get(successor.handoffId);
  assert.equal(successorDetail.handoff.predecessorHandoffId, original.handoffId);
  const [manifest, site] = successorDetail.resources;
  assert.equal(manifest.id, originalDetail.resources.find((resource) => resource.kind === 'manifest').id);
  assert.deepEqual(site.dependsOn, [manifest.id]);
  assert.equal(successorDetail.resources.some((resource) => resource.kind === 'content' || resource.kind === 'media' || resource.kind === 'index'), false);
  const exported = await env.handle.publication.exportBundle(successor.handoffId);
  const publisherPackage = await buildFolderMapFromZip(new File([await readFile(exported.absolutePath)], 'cms-successor.zip'));
  const publisherValidated = await validatePublisherHandoff(publisherPackage);
  assert.deepEqual(publisherValidated.manifest.resources.map((resource) => resource.kind), ['manifest', 'site']);

  const repeat = await env.handle.publication.prepare({ planId: plan.planId, selection });
  assert.equal(repeat.reused, true);
  assert.equal(repeat.handoffId, successor.handoffId);
});

test('same selected content with a changed CMS bundle is not treated as an equivalent handoff', async (t) => {
  const env = await startPhase3(t, {
    posts: [makePost(1)],
    settings: { extra: { website: { cms: 'generic-cms', tagline: 'Initial deployment' } } }
  });
  await env.handle.source.discover({ mode: 'full', perPage: 50 });
  const plan = await env.handle.planning.create({ batchSize: 1, estimateMedia: false });
  const selection = plan.plan.entries.filter((entry) => entry.status === 'new').map((entry) => entry.sourceKey);
  const original = await env.handle.publication.prepare({ planId: plan.planId, selection });
  await env.handle.store.transaction((draft) => {
    const record = draft.publication.handoffs[original.handoffId];
    record.resources = record.resources.map((resource) => ({ ...resource, status: 'remote_verified', state: 'remote_verified' }));
    record.status = 'remote_verified';
  });
  await env.handle.update({ settings: { website: { cms: 'generic-cms', tagline: 'Corrected deployment' } } });

  const successor = await env.handle.publication.prepare({ planId: plan.planId, selection });
  assert.equal(successor.reused, false);
  assert.notEqual(successor.handoffId, original.handoffId);
  assert.deepEqual(successor.resources.map((resource) => resource.kind), ['manifest', 'site']);
  const originalSite = (await env.handle.publication.get(original.handoffId)).resources.find((resource) => resource.kind === 'site');
  const successorSite = successor.resources.find((resource) => resource.kind === 'site');
  assert.notEqual(successorSite.sha256, originalSite.sha256);
});
