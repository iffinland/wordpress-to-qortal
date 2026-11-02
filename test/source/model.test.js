import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_SCHEMA,
  assertContentDocument,
  canonicalProjection,
  canonicalizeHtml,
  computeContentHash,
  contentId,
  normalizeTimestamp,
  stableStringify
} from '../../lib/model/content.js';
import { normalizePostOrPage, normalizeTerm } from '../../lib/source/wordpress/normalize.js';

const SITE = 'https://fixture.test';

function rawPost(overrides = {}) {
  return {
    id: 101,
    slug: 'first-post',
    link: `${SITE}/first-post/`,
    title: { rendered: 'A &amp; B' },
    content: { rendered: '<p>Hello &amp; world <a href="/about/">about</a></p>' },
    excerpt: { rendered: '<p>Excerpt &amp; summary</p>' },
    date: '2024-01-02T03:04:05',
    date_gmt: '2024-01-02T03:04:05',
    modified: '2024-02-03T04:05:06',
    modified_gmt: '2024-02-03T04:05:06',
    status: 'publish',
    author: 7,
    featured_media: 0,
    categories: [1],
    tags: [10],
    format: 'standard',
    ...overrides
  };
}

const TERMS = new Map([
  ['category:1', { slug: 'news', name: 'News' }],
  ['tag:10', { slug: 'featured', name: 'Featured' }]
]);

function normalize(overrides = {}) {
  return normalizePostOrPage({
    contentType: 'post',
    raw: rawPost(overrides),
    site: SITE,
    termLookup: TERMS
  });
}

test('qms-content@1 has a stable identity and deterministic hash', () => {
  const first = normalize();
  const second = normalize();
  assert.equal(first.schema, CONTENT_SCHEMA);
  assert.equal(first.id, 'src_wordpress_post-101');
  assert.equal(second.id, first.id);
  assert.equal(second.content_hash, first.content_hash);
  assert.match(first.content_hash, /^sha256:[a-f0-9]{64}$/);
  assertContentDocument(first);
  assert.equal(contentId('wordpress', 'post', 'post:101'), 'src_wordpress_post-101');
});

test('HTML entities and relative URLs canonicalize without false revisions', () => {
  const left = normalize({
    title: { rendered: 'A &amp; B' },
    content: { rendered: '<p>Hello &amp; world <a href="/about/">about</a></p>' }
  });
  const right = normalize({
    title: { rendered: 'A &#038; B' },
    content: { rendered: '<p>Hello &#038; world <a href="https://fixture.test/about/">about</a></p>' }
  });
  assert.equal(right.content_hash, left.content_hash);
  assert.equal(
    canonicalizeHtml('<p>a &amp; b</p>', { baseUrl: SITE }),
    canonicalizeHtml('<p>a &#038; b</p>', { baseUrl: SITE })
  );
});

test('slug and URL changes keep source identity and content hash', () => {
  const before = normalize();
  const after = normalize({
    slug: 'renamed-post',
    link: `${SITE}/renamed-post/`
  });
  assert.equal(after.id, before.id);
  assert.equal(after.source.key, before.source.key);
  assert.equal(after.identity.slug, 'renamed-post');
  assert.equal(after.content_hash, before.content_hash);
});

test('title and body edits change the content hash', () => {
  const before = normalize();
  const titleEdit = normalize({ title: { rendered: 'A &amp; B changed' } });
  const bodyEdit = normalize({ content: { rendered: '<p>Changed body</p>' } });
  assert.notEqual(titleEdit.content_hash, before.content_hash);
  assert.notEqual(bodyEdit.content_hash, before.content_hash);
});

test('non-semantic API and modified-date changes do not create revisions', () => {
  const before = normalize();
  const after = normalize({
    modified: '2025-09-09T09:09:09',
    modified_gmt: '2025-09-09T09:09:09',
    guid: { rendered: 'https://old.example/guid' },
    _links: { self: [{ href: 'https://fixture.test/wp-json/wp/v2/posts/101' }] },
    yoast_head_json: { changed: true }
  });
  assert.notEqual(after.provenance.raw_hash, before.provenance.raw_hash);
  assert.equal(after.content_hash, before.content_hash);
});

test('term and media changes are part of the semantic projection', () => {
  const before = normalize();
  const termEdit = normalize({ categories: [1, 2] });
  const mediaEdit = normalize({ content: { rendered: '<p>Hello</p><img src="/new.jpg">' } });
  assert.notEqual(termEdit.content_hash, before.content_hash);
  assert.notEqual(mediaEdit.content_hash, before.content_hash);
});

test('the content hash excludes source-specific metadata and provenance', () => {
  const document = normalize();
  const projection = canonicalProjection(document);
  assert.equal(computeContentHash(document), document.content_hash);
  assert.equal(Object.hasOwn(projection, 'source'), false);
  assert.equal(Object.hasOwn(projection, 'identity'), false);
  assert.equal(Object.hasOwn(projection, 'provenance'), false);
  assert.equal(Object.hasOwn(projection, 'unsupported'), false);
  const tampered = structuredClone(document);
  tampered.source.extra.wordpress.guid = 'changed';
  tampered.provenance.fetched_at = '2030-01-01T00:00:00.000Z';
  assert.equal(computeContentHash(tampered), document.content_hash);
});

test('hash verification fails closed after semantic tampering', () => {
  const document = normalize();
  const tampered = structuredClone(document);
  tampered.title = 'Different title';
  assert.throws(() => assertContentDocument(tampered), /content_hash mismatch/);
  assert.throws(() => assertContentDocument({ ...document, schema: 'qms-content@2' }), /schema/);
});

test('timestamps normalize deterministically and stableStringify sorts keys', () => {
  assert.equal(normalizeTimestamp('2024-01-02T03:04:05'), '2024-01-02T03:04:05.000Z');
  assert.equal(normalizeTimestamp('2024-01-02T03:04:05Z'), '2024-01-02T03:04:05.000Z');
  assert.equal(normalizeTimestamp('not-a-date'), null);
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});

test('terms are normalized with stable identities', () => {
  const term = normalizeTerm({
    taxonomy: 'category',
    site: SITE,
    raw: { id: 1, slug: 'news', name: 'News', description: 'News', parent: 0, count: 2, taxonomy: 'category', link: `${SITE}/category/news/` }
  });
  assert.equal(term.id, 'src_wordpress_category-1');
  assert.equal(term.content_type, 'category');
  assert.equal(term.title, 'News');
  assertContentDocument(term);
});
