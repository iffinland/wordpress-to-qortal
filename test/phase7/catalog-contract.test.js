import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import { startPhase3 as startFixture, makePost, dataWithPosts } from '../../test-support/phase3/helpers.js';
import { startQdnServer } from '../../test-support/phase5/qdnServer.js';
import { populateQdn, receiptFor } from './support.js';
import { createCmsRepository } from '../../templates/generic-cms/src/lib/repository.js';
import { emptyNativeIndex, NATIVE_INDEX_IDENTIFIER } from '../../templates/generic-cms/src/lib/nativeCatalog.js';
import { emptyOverlay, createOverlayEntry, OVERLAY_IDENTIFIER } from '../../templates/generic-cms/src/lib/overlay.js';

const packagedEngine = process.env.QMS_CATALOG_ENGINE_ROOT
  ? await import(pathToFileURL(path.join(process.env.QMS_CATALOG_ENGINE_ROOT, 'lib/engine/index.js')).href) : null;
const startPhase3 = (t, options) => startFixture(t, {
  ...options, ...(packagedEngine ? { engineFactory: packagedEngine.createEngine } : {})
});

async function prepare(env, count = 15) {
  await env.handle.source.discover({ mode: 'full', contentTypes: ['post'], perPage: 15 });
  const plan = await env.handle.planning.create({ batchSize: count, estimateMedia: true, planning: { includeReserved: true } });
  assert.equal(plan.plan.status, 'ready');
  await env.handle.media.download({ planId: plan.planId, concurrency: 1 });
  return env.handle.publication.prepare({ planId: plan.planId,
    selection: plan.plan.entries.filter((entry) => ['new', 'modified', 'route_changed', 'reserved'].includes(entry.status)).map((entry) => entry.sourceKey) });
}

async function publish(env, node, handoff) {
  const manifest = await populateQdn(node, env, handoff);
  await env.handle.publication.importReceipt({ handoffId: handoff.handoffId,
    receipt: receiptFor(manifest, handoff.handoffId.slice(4)) });
  const verified = await env.handle.publication.verify({ handoffId: handoff.handoffId, nodeUrl: node.url, attempts: 1, intervalMs: 0 });
  assert.equal(verified.status, 'remote_verified', JSON.stringify(verified));
  return manifest;
}

async function cmsConfig(env, handoff) {
  const site = handoff.resources.find((resource) => resource.kind === 'site');
  const root = env.engine.projects.paths(env.project.id).root;
  const bytes = await readFile(path.join(root, handoff.handoffPath, site.relativePath));
  return JSON.parse(Buffer.from(unzipSync(bytes)['qms-cms-config.json']).toString());
}

test('canonical APP deployment carries the project config and loads its two-post catalog through the Publisher-compatible bundle', async (t) => {
  const env = await startPhase3(t, {
    posts: [makePost(1), makePost(2)],
    settings: { extra: { website: { cms: 'generic-cms', tagline: 'Canonical APP catalog' } } }
  });
  const node = await startQdnServer();
  t.after(() => node.close());
  const handoff = await prepare(env, 2);
  const site = handoff.resources.find((resource) => resource.kind === 'site');
  const manifest = handoff.resources.find((resource) => resource.kind === 'manifest');
  assert.equal(site.identifier, 'default', 'Qortal Hub resolves qortal://APP/<name>/ to default');
  await publish(env, node, handoff);

  // This is the same APP member path the hosted CMS uses for the generated
  // runtime config. It proves the QMS ZIP, Publisher-compatible resource and
  // project manifest stay bound together without a user-visible identifier.
  const configResponse = await fetch(node.url + '/arbitrary/APP/' + encodeURIComponent(site.name)
    + '/default?filepath=qms-cms-config.json');
  assert.equal(configResponse.status, 200);
  const hostedConfig = await configResponse.json();
  assert.equal(hostedConfig.deployment.identifier, 'default');
  assert.equal(hostedConfig.content.manifestIdentifier, manifest.identifier);
  const manifestResponse = await fetch(node.url + '/arbitrary/DOCUMENT/' + encodeURIComponent(site.name)
    + '/' + encodeURIComponent(hostedConfig.content.manifestIdentifier));
  assert.equal(manifestResponse.status, 200);
  const hostedManifest = await manifestResponse.json();
  assert.equal(hostedManifest.site_id, hostedConfig.site.id);

  const dom = new JSDOM('', { url: node.url + '/render/APP/' + encodeURIComponent(site.name) + '/' });
  const previousWindow = globalThis.window;
  globalThis.window = dom.window;
  t.after(() => { globalThis.window = previousWindow; dom.window.close(); });
  const repository = createCmsRepository(hostedConfig);
  const dataset = await repository.loadDataset();
  assert.equal(dataset.state, 'ready', JSON.stringify(dataset.notices));
  assert.equal(dataset.posts.length, 2);
  assert.deepEqual(dataset.posts.map((post) => post.slug).sort(), ['synthetic-post-1', 'synthetic-post-2']);
});

// This is also the bounded local catalog-contract smoke: real engine, locked
// durable store, exact HTTP/base64 verification and the production CMS reader.
test('same-site A(15) → B(15) → modified A3 preserves the public CMS across restart without APP/content/media republishing', async (t) => {
  const env = await startPhase3(t, {
    mediaServer: true,
    settings: { media: { allowExternalMedia: true }, extra: { website: { cms: 'generic-cms' } } },
    dataFactory: ({ mediaUrl }) => dataWithPosts(Array.from({ length: 15 }, (_, i) => makePost(i + 1, {
      content: '<p>Batch A body ' + (i + 1) + '</p><img src="' + mediaUrl + '/media/known/shared.jpg?bytes=128">'
    })))
  });
  const node = await startQdnServer();
  t.after(() => node.close());
  const a = await prepare(env);
  assert.equal(a.resources.filter((entry) => entry.kind === 'content').length, 15);
  assert.equal((await env.handle.sync.catalog({ publishedOnly: true })).length, 0, 'preparation grants no published authority');
  await populateQdn(node, env, a);
  const aReceipt = (await env.handle.publication.get(a.handoffId)).handoff;
  await env.handle.publication.importReceipt({ handoffId: a.handoffId, receipt: receiptFor(aReceipt) });
  assert.equal((await env.handle.sync.catalog({ publishedOnly: true })).length, 0, 'Publisher claims are not exact read-back');
  await publish(env, node, a);
  const config = await cmsConfig(env, a);
  assert.equal(config.site.id, env.project.siteId);
  const dom = new JSDOM('', { url: node.url + '/arbitrary/APP/SyntheticSite/site/index.html' });
  const previousWindow = globalThis.window;
  globalThis.window = dom.window;
  t.after(() => { globalThis.window = previousWindow; dom.window.close(); });
  const repository = createCmsRepository(config, { name: 'SyntheticSite' });
  let dataset = await repository.loadDataset(true);
  assert.equal(dataset.posts.length, 15);
  const overlayItem = dataset.posts.find((entry) => entry.slug === 'synthetic-post-1');
  const native = { ...emptyNativeIndex(config.site.id), entries: [{ id: 'cms-native', type: 'post', title: 'Native retained',
    slug: 'native-retained', status: 'published', qdn: { service: 'DOCUMENT', name: 'SyntheticSite', identifier: 'native-body' } }] };
  const overlay = { ...emptyOverlay(config.site.id), entries: [createOverlayEntry({ item: overlayItem,
    draft: { title: 'Owner edited title', slug: overlayItem.slug }, contentRef: { service: 'DOCUMENT', name: 'SyntheticSite', identifier: 'owner-edit' } })] };
  for (const [identifier, payload] of [[NATIVE_INDEX_IDENTIFIER, native], [OVERLAY_IDENTIFIER, overlay]]) {
    node.set({ service: 'DOCUMENT', name: 'SyntheticSite', identifier, bytes: JSON.stringify(payload) });
  }
  const nativeHash = node.sha256('DOCUMENT', 'SyntheticSite', NATIVE_INDEX_IDENTIFIER);
  const overlayHash = node.sha256('DOCUMENT', 'SyntheticSite', OVERLAY_IDENTIFIER);
  // Legacy upgrade: erase only the new snapshot field, preserving verified
  // handoffs, mappings and exact evidence just as an already-published project.
  await env.handle.store.transaction((draft) => {
    for (const mapping of Object.values(draft.identity.mappings)) delete mapping.verifiedPublication;
  });
  await env.handle.close();
  env.handle = await env.engine.projects.open(env.project.id);
  t.after(() => env.handle.close().catch(() => {}));
  assert.equal(env.handle.project.identity.siteId, config.site.id);
  const adoption = await env.handle.sync.adoptExisting({ note: 'Continue original published site' });
  assert.equal(adoption.siteId, config.site.id);
  assert.equal((await env.handle.sync.catalog({ publishedOnly: true })).length, 15);
  const mediaUrl = env.media.url + '/media/known/shared.jpg?bytes=128';
  env.wp.data.posts = Array.from({ length: 15 }, (_, i) => makePost(i + 16, {
    content: '<p>Batch B body ' + (i + 16) + '</p><img src="' + mediaUrl + '">'
  }));
  const b = await prepare(env);
  assert.equal(b.resources.filter((entry) => entry.kind === 'content').length, 15);
  assert.equal(b.resources.filter((entry) => entry.kind === 'site').length, 0, 'same CMS APP is reused');
  assert.equal(b.resources.filter((entry) => entry.kind === 'media').length, 0, 'verified shared media is reused');
  const aIdentifiers = new Set(a.resources.filter((entry) => entry.kind === 'content').map((entry) => entry.identifier));
  assert.ok(b.resources.filter((entry) => entry.kind === 'content').every((entry) => !aIdentifiers.has(entry.identifier)));
  const detailB = await env.handle.publication.get(b.handoffId);
  assert.equal(detailB.siteDeployment.identifier, a.resources.find((entry) => entry.kind === 'site').identifier);
  await publish(env, node, b);
  dataset = await repository.loadDataset(true);
  assert.equal(dataset.posts.length, 31, JSON.stringify(dataset.notices));
  assert.equal(dataset.posts.find((entry) => entry.slug === overlayItem.slug).title, 'Owner edited title');
  assert.ok(dataset.posts.some((entry) => entry.id === 'cms-native'));
  const modified = makePost(3, { title: 'A3 updated', content: '<p>New A3 body</p><img src="' + mediaUrl + '">' });
  env.wp.data.posts = [modified];
  const c = await prepare(env, 1);
  assert.equal(c.resources.filter((entry) => entry.kind === 'content').length, 1);
  const updated = c.resources.find((entry) => entry.kind === 'content');
  assert.ok(aIdentifiers.has(updated.identifier), 'updates the same stable resource');
  assert.equal((await env.handle.sync.catalog({ publishedOnly: true })).find((entry) => entry.sourceKey === 'post:1003').title, 'Synthetic post 3',
    'planned revision cannot replace verified revision');
  await publish(env, node, c);
  dataset = await repository.loadDataset(true);
  assert.equal(dataset.posts.length, 31);
  assert.equal(dataset.posts.filter((entry) => entry.slug === 'synthetic-post-3').length, 1);
  assert.equal(dataset.posts.find((entry) => entry.slug === 'synthetic-post-3').title, 'A3 updated');
  assert.equal(node.sha256('DOCUMENT', 'SyntheticSite', NATIVE_INDEX_IDENTIFIER), nativeHash);
  assert.equal(node.sha256('DOCUMENT', 'SyntheticSite', OVERLAY_IDENTIFIER), overlayHash);
  assert.equal(dataset.posts.find((entry) => entry.slug === overlayItem.slug).title, 'Owner edited title');
  const search = await repository.loadSearchIndex(true);
  assert.equal(search.entries.filter((entry) => entry.slug === 'synthetic-post-3').length, 1);
  assert.match(search.entries.find((entry) => entry.slug === 'synthetic-post-3').text, /New A3 body/);
  assert.equal(search.entries.filter((entry) => entry.origin === 'imported').length, 30);
  await env.handle.close();
  env.handle = await env.engine.projects.open(env.project.id);
  assert.equal((await env.handle.sync.catalog({ publishedOnly: true })).length, 30);
  const persisted = JSON.parse(await readFile(path.join(env.engine.projects.paths(env.project.id).root,
    env.handle.store.state.sync.publishedCatalogPath), 'utf8'));
  assert.equal(persisted.counts.visible, 30);
  const second = await env.engine.projects.create({ name: 'Independent second site', source: { adapter: 'wordpress', baseUrl: env.wp.url },
    target: { qdnName: 'SyntheticSite' } });
  assert.notEqual(second.siteId, env.project.siteId);
  assert.notEqual(second.siteNamespace, env.project.siteNamespace);
  assert.equal(config.content.manifestIdentifier, a.resources.find((entry) => entry.kind === 'manifest').identifier);
  for (const handoff of [b, c]) assert.equal(handoff.resources.find((entry) => entry.kind === 'manifest').identifier, config.content.manifestIdentifier);
});

test('withdrawal and failed read-back cannot promote a pending revision or reintroduce withdrawn content', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(1), makePost(2), makePost(3)] });
  const node = await startQdnServer();
  t.after(() => node.close());
  const first = await prepare(env, 3);
  await publish(env, node, first);
  const original = (await env.handle.sync.catalog({ publishedOnly: true })).find((entry) => entry.sourceKey === 'post:1001');
  env.wp.data.posts = [makePost(1, { title: 'Unverified pending title' }), makePost(2)];
  const scan = await env.handle.sync.check({ mode: 'full' });
  assert.equal(scan.status, 'completed');
  assert.equal(env.handle.store.state.identity.mappings['post:1003'].status, 'withdrawn');
  const pending = await env.handle.sync.preparePlan({ scanId: scan.scanId, estimateMedia: false });
  const handoff = await env.handle.publication.prepare({ planId: pending.planId, selection: ['post:1001'] });
  const descriptor = handoff.resources.find((entry) => entry.kind === 'content');
  node.set({ service: descriptor.service, name: descriptor.name, identifier: descriptor.identifier, bytes: 'incorrect remote bytes' });
  const failed = await env.handle.publication.verify({ handoffId: handoff.handoffId, nodeUrl: node.url, attempts: 1, intervalMs: 0 });
  assert.notEqual(failed.status, 'remote_verified');
  const catalog = await env.handle.sync.catalog({ publishedOnly: true });
  assert.equal(catalog.length, 2);
  assert.equal(catalog.find((entry) => entry.sourceKey === 'post:1001').title, original.title);
  assert.equal(catalog.some((entry) => entry.sourceKey === 'post:1003'), false);
  const dir = path.join(env.engine.projects.paths(env.project.id).root, handoff.handoffPath);
  const manifestResource = handoff.resources.find((entry) => entry.kind === 'manifest');
  const proposedManifest = JSON.parse(await readFile(path.join(dir, manifestResource.relativePath), 'utf8'));
  assert.equal(proposedManifest.summary.posts, 2, 'derived index excludes withdrawn published content');
  assert.equal(proposedManifest.site_id, env.project.siteId, 'stable identity is available for future verifiable recovery');
});

test('a second pending handoff cannot freeze a replacing catalog before the first batch is verified', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(1), makePost(2)] });
  await env.handle.source.discover({ mode: 'full' });
  const plan = await env.handle.planning.create({ batchSize: 2, estimateMedia: false });
  const a = await env.handle.publication.prepare({ planId: plan.planId, selection: ['post:1001'] });
  await assert.rejects(env.handle.publication.prepare({ planId: plan.planId, selection: ['post:1002'] }),
    (error) => error.code === 'PUBLICATION_BLOCKED' && error.details.handoffId === a.handoffId);
  const same = await env.handle.publication.prepare({ planId: plan.planId, selection: ['post:1001'] });
  assert.equal(same.handoffId, a.handoffId);
  assert.equal(same.reused, true);
  const node = await startQdnServer();
  t.after(() => node.close());
  await publish(env, node, a);
  const b = await env.handle.publication.prepare({ planId: plan.planId, selection: ['post:1002'] });
  await publish(env, node, b);
  assert.equal((await env.handle.sync.catalog({ publishedOnly: true })).length, 2);
  const manifest = b.resources.find((entry) => entry.kind === 'manifest');
  assert.equal(JSON.parse(node.get(manifest.service, manifest.name, manifest.identifier).bytes).summary.posts, 2);
});

test('legacy overlapping packages are refreshed cumulatively and stale historical export is refused', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(1), makePost(2)] });
  await env.handle.source.discover({ mode: 'full' });
  const plan = await env.handle.planning.create({ batchSize: 2, estimateMedia: false });
  const a = await env.handle.publication.prepare({ planId: plan.planId, selection: ['post:1001'] });
  // Emulate an old application which allowed overlapping preparations. No
  // content resource or mapping is marked verified by this fixture setup.
  await env.handle.store.transaction((draft) => { draft.publication.handoffs[a.handoffId].status = 'remote_verified'; });
  const legacyB = await env.handle.publication.prepare({ planId: plan.planId, selection: ['post:1002'] });
  await env.handle.store.transaction((draft) => { draft.publication.handoffs[a.handoffId].status = 'handoff_ready'; });
  const node = await startQdnServer();
  t.after(() => node.close());
  await publish(env, node, a);
  await assert.rejects(env.handle.publication.exportBundle(legacyB.handoffId), (error) => error.details?.catalogStale === true);
  const refreshedB = await env.handle.publication.prepare({ planId: plan.planId, selection: ['post:1002'] });
  assert.notEqual(refreshedB.handoffId, legacyB.handoffId);
  await publish(env, node, refreshedB);
  const manifest = refreshedB.resources.find((entry) => entry.kind === 'manifest');
  assert.equal(JSON.parse(node.get(manifest.service, manifest.name, manifest.identifier).bytes).summary.posts, 2);
  await assert.rejects(env.handle.publication.exportBundle(a.handoffId), (error) => error.details?.catalogStale === true);
});

test('partial media verification reports its evidence without publishing incomplete content to the local catalog', async (t) => {
  const env = await startPhase3(t, { mediaServer: true, settings: { media: { allowExternalMedia: true } },
    dataFactory: ({ mediaUrl }) => dataWithPosts([makePost(1, { content: '<img src="' + mediaUrl + '/media/known/shared.jpg?bytes=128">' })]) });
  const handoff = await prepare(env, 1);
  const node = await startQdnServer();
  t.after(() => node.close());
  await populateQdn(node, env, handoff);
  const media = handoff.resources.find((entry) => entry.kind === 'media');
  node.remove(media.service, media.name, media.identifier);
  const partial = await env.handle.publication.verify({ handoffId: handoff.handoffId, nodeUrl: node.url, attempts: 1, intervalMs: 0 });
  assert.notEqual(partial.status, 'remote_verified');
  assert.equal((await env.handle.sync.catalog({ publishedOnly: true })).length, 0);
  const evidence = JSON.parse(await readFile(path.join(env.engine.projects.paths(env.project.id).receiptsDir,
    handoff.handoffId + '-verification.json'), 'utf8'));
  assert.ok(evidence.results.some((entry) => entry.resourceId === media.id && entry.state !== 'remote_verified'));
});

test('APP reuse follows only the latest verified config and an old verification cannot verify a newer pending revision', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(1)], settings: { extra: { website: { cms: 'generic-cms', tagline: 'Config A' } } } });
  const node = await startQdnServer();
  t.after(() => node.close());
  const a = await prepare(env, 1);
  await publish(env, node, a);
  await env.handle.update({ settings: { website: { cms: 'generic-cms', tagline: 'Config B' } } });
  env.wp.data.posts = [makePost(1, { title: 'Updated B' })];
  const b = await prepare(env, 1);
  assert.ok(b.resources.some((entry) => entry.kind === 'site'));
  assert.equal(env.handle.store.state.identity.mappings['post:1001'].publicationStatus, 'reserved');
  // Remote still serves A. Re-reading A must not label B's bytes verified.
  await env.handle.publication.verify({ handoffId: a.handoffId, nodeUrl: node.url, attempts: 1, intervalMs: 0 });
  const pending = b.resources.find((entry) => entry.kind === 'content');
  assert.equal(env.handle.store.state.publication.resources[pending.id].handoffId, b.handoffId);
  assert.equal(env.handle.store.state.publication.resources[pending.id].status, 'handoff_ready');
  assert.equal(env.handle.store.state.identity.mappings['post:1001'].publicationStatus, 'reserved');
  await publish(env, node, b);
  await env.handle.publication.importReceipt({ handoffId: a.handoffId,
    receipt: receiptFor((await env.handle.publication.get(a.handoffId)).handoff, 'historical') });
  await assert.rejects(env.handle.publication.exportBundle(a.handoffId), (error) => error.details?.catalogStale === true);
  assert.equal((await env.handle.publication.get(a.handoffId)).handoff.status, 'remote_verified', 'receipt claims cannot erase exact evidence');
  await env.handle.update({ settings: { website: { cms: 'generic-cms', tagline: 'Config A' } } });
  env.wp.data.posts = [makePost(1, { title: 'Updated C' })];
  const c = await prepare(env, 1);
  assert.ok(c.resources.some((entry) => entry.kind === 'site'), 'returning to historical A needs a real APP update from deployed B');
});

test('explicit target migration does not relabel old verified evidence as publication under the new name', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(1)] });
  const node = await startQdnServer();
  t.after(() => node.close());
  const a = await prepare(env, 1);
  await publish(env, node, a);
  const preview = await env.handle.identity.migrationPreview({ target: { qdnName: 'NewDestination', resourcePrefix: 'qms' } });
  await env.handle.identity.applyMigration({ token: preview.token });
  assert.equal((await env.handle.sync.catalog({ publishedOnly: true })).length, 0);
  const b = await prepare(env, 1);
  assert.ok(b.resources.every((resource) => resource.name === 'NewDestination'));
  assert.equal(env.handle.project.identity.siteId, env.project.siteId);
});

test('a proven pre-submission decline can be superseded, while blocked read-back cannot abandon submitted writes', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(1)] });
  const first = await prepare(env, 1);
  const record = (await env.handle.publication.get(first.handoffId)).handoff;
  const { createReceipt } = await import('../../lib/engine/publication/receipts.js');
  const declined = createReceipt({ ...receiptFor(record), handoff: record, receiptId: 'rcp_declinedcatalog01',
    results: record.resources.map((resource) => ({ resourceId: resource.id, service: resource.service,
      name: resource.name, identifier: resource.identifier, status: 'declined', txSignature: null })) });
  await env.handle.publication.importReceipt({ handoffId: first.handoffId, receipt: declined });
  env.wp.data.posts = [makePost(1, { title: 'Revised after decline' })];
  const next = await prepare(env, 1);
  assert.notEqual(next.handoffId, first.handoffId);
  await env.handle.publication.importReceipt({ handoffId: next.handoffId,
    receipt: receiptFor((await env.handle.publication.get(next.handoffId)).handoff, 'submitted') });
  // An access denial is evidence of unreadability, not proof that no write happened.
  await env.handle.store.transaction((draft) => {
    const handoff = draft.publication.handoffs[next.handoffId];
    handoff.status = 'blocked';
    for (const resource of handoff.resources) resource.status = 'blocked';
  });
  env.wp.data.posts = [makePost(1, { title: 'Another revision' })];
  await assert.rejects(prepare(env, 1), (error) => error.code === 'PUBLICATION_BLOCKED');
});
