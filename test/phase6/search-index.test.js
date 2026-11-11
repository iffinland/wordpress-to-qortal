import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIndexPayloads,
  buildManifestResource,
  SEARCH_INDEX_SCHEMA
} from '../../lib/engine/publication/payloads.js';
import { normalizeIndexPayload, normalizeManifest } from '../../templates/generic-cms/src/lib/manifest.js';
import { featuredImageUrlForItem } from '../../templates/generic-cms/src/lib/featuredImage.js';

function contentResource({ id, title, slug, type = 'post', html = '', text = '', media = [], name = 'developer iffi' }) {
  const payload = Buffer.from(JSON.stringify({
    schema: 'qms-qdn-content@1',
    version: 1,
    title,
    identity: { slug },
    dates: { published_at: '2026-10-01T00:00:00.000Z', modified_at: '2026-10-02T00:00:00.000Z' },
    body: { format: 'html', html, text, excerpt_text: 'Excerpt for ' + title, summary: 'Excerpt for ' + title },
    media
  }) + '\n', 'utf8');
  return {
    id,
    kind: 'content',
    service: 'DOCUMENT',
    name,
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

test('import post indexes project verified WordPress or body images for CMS cards', () => {
  const contentResources = [
    contentResource({
      id: 'res_explicit',
      title: 'WordPress featured image',
      slug: 'wordpress-featured-image',
      name: 'Telegram.EE',
      media: [{
        role: 'featured',
        url: 'https://old.example/uploads/hero.jpg',
        alt: 'Original WordPress hero',
        qdn: { service: 'IMAGE', name: 'Telegram.EE', identifier: 'qms-media-wordpress-hero' }
      }]
    }),
    contentResource({
      id: 'res_body',
      title: 'Body image fallback',
      slug: 'body-image-fallback',
      name: 'Telegram.EE',
      media: [{
        role: 'inline',
        url: 'https://old.example/uploads/first-body-image.jpg',
        alt: 'First article image',
        qdn: { service: 'IMAGE', name: 'Telegram.EE', identifier: 'qms-media-body-first' }
      }]
    }),
    contentResource({
      id: 'res_without_image',
      title: 'No resolved image',
      slug: 'no-resolved-image',
      name: 'Telegram.EE',
      media: [{
        role: 'inline',
        url: 'https://external.example/never-use-this-on-a-card.jpg',
        alt: 'External only',
        qdn: null
      }]
    })
  ];
  const releaseTarget = { qdnName: 'Telegram.EE' };
  const indexes = buildIndexPayloads({
    siteId: 'telegram-ee', namespace: 'telegram', prefix: 'qms', target: releaseTarget,
    contentResources, mediaResources: [], generatedAt: '2026-11-11T00:00:00.000Z'
  });
  const posts = indexes.find((resource) => resource.key === 'posts');
  const postIndex = JSON.parse(Buffer.from(posts.payload).toString('utf8'));
  const explicit = postIndex.entries.find((entry) => entry.slug === 'wordpress-featured-image');
  const fallback = postIndex.entries.find((entry) => entry.slug === 'body-image-fallback');
  const withoutImage = postIndex.entries.find((entry) => entry.slug === 'no-resolved-image');
  assert.deepEqual(explicit.featured_image, { service: 'IMAGE', name: 'Telegram.EE', identifier: 'qms-media-wordpress-hero' });
  assert.equal(explicit.featured_image_alt, 'Original WordPress hero');
  assert.equal(explicit.featured_image_source, 'wordpress');
  assert.deepEqual(fallback.featured_image, { service: 'IMAGE', name: 'Telegram.EE', identifier: 'qms-media-body-first' });
  assert.equal(fallback.featured_image_source, 'body');
  assert.equal('featured_image' in withoutImage, false);

  const manifestResource = buildManifestResource({
    siteId: 'telegram-ee', namespace: 'telegram', prefix: 'qms', target: releaseTarget,
    handoffId: 'handoff-featured-images', generatedAt: '2026-11-11T00:00:00.000Z',
    contentResources, mediaResources: [], indexResources: indexes
  });
  const manifest = normalizeManifest(JSON.parse(Buffer.from(manifestResource.payload).toString('utf8')), { expectedName: 'Telegram.EE' });
  const cmsItems = normalizeIndexPayload(postIndex, 'posts', manifest);
  const renderedFallback = cmsItems.find((item) => item.slug === 'body-image-fallback');
  const renderedWithoutImage = cmsItems.find((item) => item.slug === 'no-resolved-image');
  assert.equal(
    featuredImageUrlForItem(renderedFallback, { site: { ownerName: 'Telegram.EE' } }),
    'http://localhost:12391/arbitrary/IMAGE/Telegram.EE/qms-media-body-first'
  );
  assert.equal(featuredImageUrlForItem(renderedWithoutImage, { site: { ownerName: 'Telegram.EE' } }), '');
});
