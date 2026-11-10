import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CatalogError,
  loadCmsDataset,
  normalizeContentPayload,
  normalizeManifest
} from '../../templates/generic-cms/src/lib/manifest.js';
import { archivePosts, postsForTerm } from '../../templates/generic-cms/src/lib/archive.js';
import { searchDataset } from '../../templates/generic-cms/src/lib/search.js';
import { loadFixtureManifest, corbettSiteDefaults } from './support/fixtures.js';

const NOW = Date.parse('2026-11-04T12:00:00.000Z');
const LONG_STALE = 3650 * 24 * 60 * 60 * 1000;

test('qms-cms-manifest fixture loads every route dataset', async () => {
  const fixture = await loadFixtureManifest('qms-cms-manifest.json');
  const manifest = normalizeManifest(fixture.raw, { siteDefaults: { id: 'fixture-site', title: 'Fixture Site', tagline: 'A neutral fixture publication', ownerName: 'QortalDemo' } });
  assert.equal(manifest.kind, 'qms-cms');
  assert.equal(manifest.site.title, 'Fixture Site');
  assert.equal(manifest.site.ownerName, 'QortalDemo');

  const dataset = await loadCmsDataset(fixture.raw, { manifest, fetchRef: fixture.fetchRef, now: NOW, staleAfterMs: LONG_STALE });
  assert.equal(dataset.state, 'ready');
  assert.equal(dataset.source, 'qms-cms');
  assert.equal(dataset.posts.length, 3);
  assert.equal(dataset.pages.length, 2);
  assert.equal(dataset.categories.length, 3);
  assert.equal(dataset.tags.length, 3);
  assert.deepEqual(dataset.availability, { posts: true, pages: true, categories: true, tags: true });
  assert.equal(dataset.posts[0].slug, 'hello-qortal');

  assert.equal(dataset.posts.find((item) => item.slug === 'hello-qortal').type, 'post');
  assert.equal(dataset.pages.find((item) => item.slug === 'about').type, 'page');
  assert.ok(postsForTerm(dataset.posts, 'cat-news').some((item) => item.slug === 'hello-qortal'));
  assert.ok(postsForTerm(dataset.posts, 'tag-design').some((item) => item.slug === 'designing-for-qortal'));
  assert.deepEqual(archivePosts(dataset.posts, 2024).map((item) => item.slug), ['older-archive-entry']);
  assert.ok(searchDataset(dataset, 'neutral').posts.some((item) => item.slug === 'hello-qortal'));
  assert.ok(searchDataset(dataset, 'design').posts.some((item) => item.slug === 'designing-for-qortal'));
  assert.ok(searchDataset(dataset, 'fixture').pages.some((item) => item.slug === 'about'));
});

test('qms content payloads normalize with media and author metadata', async () => {
  const fixture = await loadFixtureManifest('qms-cms-manifest.json');
  const dataset = await loadCmsDataset(fixture.raw, { fetchRef: fixture.fetchRef, now: NOW, staleAfterMs: LONG_STALE });
  const item = dataset.posts.find((entry) => entry.slug === 'hello-qortal');
  const content = normalizeContentPayload(await fixture.fetchRef(item.contentRef), item);
  assert.equal(content.title, 'Hello Qortal');
  assert.equal(content.author, 'Fixture Editor');
  assert.equal(content.media.length, 1);
  assert.equal(content.media[0].qdn.identifier, 'qms-fixture-image-hero');
  assert.match(content.html, /<strong>neutral fixture site<\/strong>/);
});

test('legacy cr-qdn-manifest maps to the same dataset without changing cr-* identifiers', async () => {
  const fixture = await loadFixtureManifest('legacy/cr-qdn-manifest.json');
  const defaults = await corbettSiteDefaults();
  const manifest = normalizeManifest(fixture.raw, { siteDefaults: defaults });
  assert.equal(manifest.kind, 'cr-qdn');
  assert.equal(manifest.site.title, 'The Corbett Report');
  assert.equal(manifest.site.tagline, 'Open Source Intelligence News');
  assert.equal(manifest.site.ownerName, 'Corbett');

  const dataset = await loadCmsDataset(fixture.raw, { manifest, fetchRef: fixture.fetchRef, now: Date.parse('2026-09-10T12:00:00.000Z'), staleAfterMs: LONG_STALE });
  assert.equal(dataset.state, 'ready');
  assert.equal(dataset.source, 'cr-qdn');
  assert.equal(dataset.posts.length, 1);
  assert.equal(dataset.pages.length, 1);
  assert.equal(dataset.categories.length, 1);
  assert.equal(dataset.tags.length, 1);
  const post = dataset.posts[0];
  assert.equal(post.id, 'wp-900');
  assert.equal(post.slug, 'golden-post');
  assert.equal(post.status, 'published');
  assert.deepEqual(post.categoryIds, ['1']);
  assert.deepEqual(post.tagIds, ['10']);
  assert.equal(post.legacy.sourceId, 900);
  assert.equal(post.legacy.oldUrl, 'https://corbett.example/golden-post/');
  assert.equal(post.contentRef.identifier, 'cr-post-900');
  assert.ok(post.contentRef.identifier.startsWith('cr-'));
  assert.equal(dataset.pages[0].contentRef.identifier, 'cr-page-901');

  const content = normalizeContentPayload(await fixture.fetchRef(post.contentRef), post);
  assert.match(content.html, /Golden legacy body/);
  assert.equal(content.author, 'Corbett');
});

test('Phase 5 qms-qdn-manifest@1 output is readable directly', async () => {
  const fixture = await loadFixtureManifest('engine/qms-qdn-manifest.json');
  const dataset = await loadCmsDataset(fixture.raw, { fetchRef: fixture.fetchRef, now: NOW, staleAfterMs: LONG_STALE, siteDefaults: { title: 'Engine Site' } });
  assert.equal(dataset.state, 'ready');
  assert.equal(dataset.source, 'qms-qdn');
  assert.equal(dataset.site.title, 'Engine Site');
  assert.equal(dataset.posts.length, 1);
  assert.equal(dataset.pages.length, 1);
  assert.equal(dataset.posts[0].contentRef.identifier, 'engine-post-1');
  const content = normalizeContentPayload(await fixture.fetchRef(dataset.posts[0].contentRef), dataset.posts[0]);
  assert.match(content.html, /Phase 5 engine payload/);
  assert.equal(content.author, 'Engine Author');
});

test('a failed index produces partial state, not false emptiness', async () => {
  const fixture = await loadFixtureManifest('qms-cms-manifest.json');
  const fetchRef = async (ref) => {
    if (ref.identifier === 'qms-fixture-pages') throw new Error('HTTP 404');
    return fixture.fetchRef(ref);
  };
  const dataset = await loadCmsDataset(fixture.raw, { fetchRef, now: NOW, staleAfterMs: LONG_STALE });
  assert.equal(dataset.state, 'partial');
  assert.equal(dataset.availability.pages, false);
  assert.equal(dataset.availability.posts, true);
  assert.equal(dataset.posts.length, 3);
  assert.ok(dataset.notices.some((notice) => notice.code === 'catalog-pages-unavailable'));
  assert.notEqual(dataset.state, 'empty');
});

test('a failed optional taxonomy index is partial and keeps content', async () => {
  const fixture = await loadFixtureManifest('qms-cms-manifest.json');
  const fetchRef = async (ref) => {
    if (ref.identifier === 'qms-fixture-categories') throw new Error('HTTP 500');
    return fixture.fetchRef(ref);
  };
  const dataset = await loadCmsDataset(fixture.raw, { fetchRef, now: NOW, staleAfterMs: LONG_STALE });
  assert.equal(dataset.state, 'partial');
  assert.equal(dataset.availability.categories, false);
  assert.equal(dataset.posts.length, 3);
  assert.ok(dataset.notices.some((notice) => notice.code === 'catalog-categories-unavailable'));
});

test('unreadable core indexes produce error state, never empty', async () => {
  const fixture = await loadFixtureManifest('qms-cms-manifest.json');
  const dataset = await loadCmsDataset(fixture.raw, {
    fetchRef: async () => { throw new Error('network down'); },
    now: NOW,
    staleAfterMs: LONG_STALE
  });
  assert.equal(dataset.state, 'error');
  assert.equal(dataset.availability.posts, false);
  assert.equal(dataset.availability.pages, false);
  assert.match(dataset.message, /could not be read/i);
});

test('stale catalogs are visible while content still renders', async () => {
  const fixture = await loadFixtureManifest('qms-cms-manifest.json');
  const dataset = await loadCmsDataset(fixture.raw, {
    fetchRef: fixture.fetchRef,
    now: Date.parse('2026-12-20T00:00:00.000Z'),
    staleAfterMs: 14 * 24 * 60 * 60 * 1000
  });
  assert.equal(dataset.state, 'stale');
  assert.equal(dataset.posts.length, 3);
  assert.ok(dataset.notices.some((notice) => notice.code === 'catalog-stale'));
});

test('an empty but readable catalog is explicit empty state', async () => {
  const fixture = await loadFixtureManifest('qms-cms-manifest.json');
  const raw = structuredClone(fixture.raw);
  raw.counts = { posts: 0, pages: 0, categories: 3, tags: 3 };
  const fetchRef = async (ref) => {
    if (ref.identifier === 'qms-fixture-posts' || ref.identifier === 'qms-fixture-pages') return { entries: [] };
    return fixture.fetchRef(ref);
  };
  const dataset = await loadCmsDataset(raw, { fetchRef, now: NOW, staleAfterMs: LONG_STALE });
  assert.equal(dataset.state, 'empty');
  assert.equal(dataset.posts.length, 0);
  assert.equal(dataset.pages.length, 0);
});

test('manifest count mismatch is partial and does not hide content', async () => {
  const fixture = await loadFixtureManifest('qms-cms-manifest.json');
  const raw = structuredClone(fixture.raw);
  raw.counts.posts = 99;
  const dataset = await loadCmsDataset(raw, { fetchRef: fixture.fetchRef, now: NOW, staleAfterMs: LONG_STALE });
  assert.equal(dataset.state, 'partial');
  assert.equal(dataset.posts.length, 3);
  assert.ok(dataset.notices.some((notice) => notice.code === 'catalog-count-mismatch'));
});

test('cache fallback is stale, not empty or ready', async () => {
  const fixture = await loadFixtureManifest('qms-cms-manifest.json');
  const cached = await loadCmsDataset(fixture.raw, { fetchRef: fixture.fetchRef, now: NOW, staleAfterMs: LONG_STALE });
  const dataset = await loadCmsDataset(fixture.raw, {
    fetchRef: async () => { throw new Error('offline'); },
    now: NOW,
    staleAfterMs: LONG_STALE,
    cache: { ...cached, cachedAt: '2026-10-31T00:00:00.000Z' }
  });
  assert.equal(dataset.state, 'stale');
  assert.equal(dataset.fromCache, true);
  assert.equal(dataset.posts.length, 3);
  assert.ok(dataset.notices.some((notice) => notice.code === 'catalog-cache-fallback'));
});

test('unsupported newer manifest versions fail closed', () => {
  assert.throws(() => normalizeManifest({ schema: 'qms-cms-manifest@1', version: 2 }), (error) => {
    assert.ok(error instanceof CatalogError);
    assert.equal(error.code, 'manifest-version-unsupported');
    return true;
  });
  assert.throws(() => normalizeManifest({ schema: 'unknown-manifest@9' }), (error) => {
    assert.equal(error.code, 'manifest-unsupported');
    return true;
  });
});

test('a CMS manifest cannot redirect the hosted site to another QDN name', async () => {
  const fixture = await loadFixtureManifest('qms-cms-manifest.json');
  const raw = structuredClone(fixture.raw);
  raw.site.owner_name = 'developer iffi';
  assert.throws(() => normalizeManifest(raw, { expectedName: 'NASA-Official' }), (error) => {
    assert.equal(error.code, 'manifest-name-mismatch');
    return true;
  });
});
