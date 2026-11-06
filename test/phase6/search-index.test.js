import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIndexPayloads,
  buildManifestResource,
  SEARCH_INDEX_SCHEMA
} from '../../lib/engine/publication/payloads.js';

function contentResource({ id, title, slug, type = 'post', html = '', text = '' }) {
  const payload = Buffer.from(JSON.stringify({
    schema: 'qms-qdn-content@1',
    version: 1,
    title,
    identity: { slug },
    dates: { published_at: '2026-10-01T00:00:00.000Z', modified_at: '2026-10-02T00:00:00.000Z' },
    body: { format: 'html', html, text, excerpt_text: 'Excerpt for ' + title, summary: 'Excerpt for ' + title }
  }) + '\n', 'utf8');
  return {
    id,
    kind: 'content',
    service: 'DOCUMENT',
    name: 'developer iffi',
    identifier: 'id-' + id,
    bytes: payload.length,
    sha256: 'sha256:test',
    metadata: { title, slug, contentType: type, categories: [], tags: [] },
    relativePath: 'payload/content/' + id + '.json',
    payload
  };
}

const target = { qdnName: 'developer iffi' };

test('import publication builds a versioned full-text search index', () => {
  const contentResources = [
    contentResource({ id: 'res_post', title: 'Põhja-Šotimaa reis', slug: 'pohja-reis', html: '<p>Pikk <strong>artikkel</strong> sõnajalgadest.</p>' }),
    contentResource({ id: 'res_page', title: 'About', slug: 'about', type: 'page', text: 'This page explains the site.' })
  ];
  const resources = buildIndexPayloads({
    siteId: 'site-1',
    namespace: 'ns',
    prefix: 'qms',
    target,
    contentResources,
    mediaResources: [],
    generatedAt: '2026-11-06T00:00:00.000Z'
  });
  const search = resources.find((resource) => resource.key === 'search');
  assert.ok(search, 'search index resource is generated');
  const payload = JSON.parse(Buffer.from(search.payload).toString('utf8'));
  assert.equal(payload.schema, SEARCH_INDEX_SCHEMA);
  assert.equal(payload.source, 'import');
  assert.equal(payload.entry_count, 2);
  const post = payload.entries.find((entry) => entry.slug === 'pohja-reis');
  assert.equal(post.type, 'post');
  assert.match(post.text, /sõnajalgadest/);
  assert.equal(post.origin, 'imported');
  const page = payload.entries.find((entry) => entry.slug === 'about');
  assert.equal(page.type, 'page');
  assert.match(page.text, /explains the site/);

  const manifest = buildManifestResource({
    namespace: 'ns',
    prefix: 'qms',
    target,
    handoffId: 'handoff-1',
    generatedAt: '2026-11-06T00:00:00.000Z',
    contentResources,
    mediaResources: [],
    indexResources: resources
  });
  const manifestPayload = JSON.parse(Buffer.from(manifest.payload).toString('utf8'));
  assert.equal(manifestPayload.entrypoints.search, search.identifier);
});
