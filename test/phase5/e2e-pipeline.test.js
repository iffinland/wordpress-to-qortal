import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import { startPhase3, makePost, dataWithPosts } from '../../test-support/phase3/helpers.js';
import { validateHandoffPackage } from '../../lib/engine/publication/index.js';
import { createReceipt } from '../../lib/engine/publication/receipts.js';
import { normalizeManifest, loadCmsDataset, normalizeContentPayload } from '../../templates/generic-cms/src/lib/manifest.js';
import { rewriteMediaUrls } from '../../templates/generic-cms/src/lib/media.js';

function mediaPost(mediaUrl) {
  return makePost(1, {
    content: '<p>Media body</p><img src="' + mediaUrl + '/media/known/alpha.jpg?bytes=2048">'
  });
}

async function startSimulatedQdn(root, manifest) {
  const byTriple = new Map(manifest.resources.map((resource) => [
    resource.service + '|' + resource.name + '|' + resource.identifier,
    resource
  ]));
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://node.test');
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts[0] !== 'arbitrary') {
        response.statusCode = 404;
        response.end('not found');
        return;
      }
      if (parts[1] === 'resource' && (parts[2] === 'properties' || parts[2] === 'status')) {
        const triple = parts.slice(3, 6).join('|');
        const resource = byTriple.get(triple);
        if (!resource) {
          response.statusCode = 404;
          response.end('missing');
          return;
        }
        response.setHeader('content-type', 'application/json');
        if (parts[2] === 'status') response.end(JSON.stringify({ status: 'READY' }));
        else response.end(JSON.stringify({ size: resource.bytes, mimeType: resource.contentType, filename: resource.identifier }));
        return;
      }
      const triple = parts.slice(1, 4).join('|');
      const resource = byTriple.get(triple);
      if (!resource) {
        response.statusCode = 404;
        response.end('missing');
        return;
      }
      const bytes = await readFile(path.join(root, resource.relativePath));
      if (resource.service === 'APP' || resource.service === 'WEBSITE') {
        const filepath = url.searchParams.get('filepath');
        if (!filepath) {
          response.statusCode = 400;
          response.end('filepath required');
          return;
        }
        const entries = unzipSync(bytes);
        const member = entries[filepath];
        if (!member) {
          response.statusCode = 404;
          response.end('member missing');
          return;
        }
        response.setHeader('content-type', 'text/plain');
        response.end(Buffer.from(member).toString('base64'));
        return;
      }
      assert.equal(url.searchParams.get('encoding'), 'base64');
      response.setHeader('content-type', 'text/plain');
      response.end(bytes.toString('base64'));
    } catch (error) {
      response.statusCode = 500;
      response.end(String(error.message));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { url: 'http://127.0.0.1:' + address.port, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('WordPress to CMS pipeline: convert, publish receipt, exact read-back, CMS dataset and media URLs', async (t) => {
  const env = await startPhase3(t, {
    mediaServer: true,
    settings: {
      media: { allowExternalMedia: true },
      extra: { website: { cms: 'generic-cms', tagline: 'Migrated and verified' } }
    },
    dataFactory: ({ mediaUrl }) => dataWithPosts([mediaPost(mediaUrl)])
  });
  await env.handle.source.discover({ mode: 'full', perPage: 50 });
  const plan = await env.handle.planning.create({ batchSize: 1 });
  assert.equal(plan.status, 'completed');
  const download = await env.handle.media.download({ planId: plan.planId, concurrency: 1 });
  assert.equal(download.status, 'completed');
  const selection = plan.plan.entries.filter((entry) => entry.status === 'new').map((entry) => entry.sourceKey);
  const handoff = await env.handle.publication.prepare({ planId: plan.planId, selection });
  const root = path.join(env.engine.projects.paths(env.project.id).root, handoff.handoffPath);
  const manifest = JSON.parse(await readFile(path.join(root, 'handoff.json'), 'utf8'));
  assert.ok(manifest.resources.some((resource) => resource.kind === 'media'));
  assert.ok(manifest.resources.some((resource) => resource.kind === 'site'));
  const validated = await validateHandoffPackage({ handoffDir: root });
  assert.equal(validated.verified.length, manifest.resources.length);

  const receipt = createReceipt({
    handoff: manifest,
    receiptId: 'rcp_simulated0001',
    publisher: { accountAddress: 'QipPqwJeLtx89dXcSkY7vimMUNT8Gy5k2E', name: 'SyntheticSite' },
    results: manifest.resources.map((resource) => ({
      resourceId: resource.id,
      service: resource.service,
      name: resource.name,
      identifier: resource.identifier,
      status: 'submitted',
      reason: null,
      txSignature: 'simulated-' + resource.id,
      submittedAt: new Date().toISOString(),
      confirmedAt: null,
      verification: null
    })),
    createdAt: new Date().toISOString(),
    appVersion: '0.6.1-alpha.1'
  });
  await env.handle.publication.importReceipt({ handoffId: handoff.handoffId, receipt });
  const imported = await env.handle.publication.get(handoff.handoffId);
  assert.ok(imported.resources.every((resource) => resource.status !== 'remote_verified'), 'receipt import is not proof');

  const simulated = await startSimulatedQdn(root, manifest);
  t.after(() => simulated.close());
  const verified = await env.handle.publication.verify({
    handoffId: handoff.handoffId,
    nodeUrl: simulated.url,
    attempts: 1,
    intervalMs: 0
  });
  assert.equal(verified.pendingOrUnverified, 0);
  assert.equal(verified.counts.remote_verified, manifest.resources.length);

  const identifierToPath = new Map(manifest.resources.map((resource) => [resource.identifier, resource.relativePath]));
  const manifestResource = manifest.resources.find((resource) => resource.kind === 'manifest');
  const raw = JSON.parse(await readFile(path.join(root, manifestResource.relativePath), 'utf8'));
  assert.equal(raw.schema, 'qms-qdn-manifest@1');
  const normalized = normalizeManifest(raw, {
    siteDefaults: { title: 'SyntheticSite', tagline: 'Migrated and verified', ownerName: 'SyntheticSite' }
  });
  const dataset = await loadCmsDataset(raw, {
    manifest: normalized,
    fetchRef: async (ref) => {
      const relative = identifierToPath.get(ref.identifier);
      assert.ok(relative, 'every CMS ref maps to a handoff payload: ' + ref.identifier);
      return JSON.parse(await readFile(path.join(root, relative), 'utf8'));
    },
    now: Date.now(),
    staleAfterMs: 30 * 24 * 60 * 60 * 1000
  });
  assert.equal(dataset.state, 'ready');
  assert.equal(dataset.posts.length, 1);
  assert.equal(dataset.posts[0].title, 'Synthetic post 1');
  assert.ok(dataset.media.length >= 1);
  assert.ok(dataset.media[0].qdn.identifier.length > 0);

  const contentPayload = await readFile(
    path.join(root, identifierToPath.get(dataset.posts[0].contentRef.identifier)),
    'utf8'
  );
  if (typeof globalThis.DOMParser === 'undefined') {
    globalThis.DOMParser = new JSDOM('').window.DOMParser;
  }
  const content = normalizeContentPayload(JSON.parse(contentPayload), dataset.posts[0]);
  assert.match(content.html, /<img/);
  assert.ok(content.media[0].qdn, 'content payload carries the QDN media reference');
  const rendered = rewriteMediaUrls(content.html, {
    bySourceUrl: dataset.urls.bySourceUrl,
    media: content.media,
    createUrl: (service, name, identifier) => '/arbitrary/' + encodeURIComponent(service) + '/' + encodeURIComponent(name) + '/' + encodeURIComponent(identifier),
    defaultName: 'SyntheticSite'
  });
  assert.equal(rendered.includes('/arbitrary/IMAGE/SyntheticSite/'), true);
  assert.equal(rendered.includes('media/known/alpha.jpg'), false);
});
