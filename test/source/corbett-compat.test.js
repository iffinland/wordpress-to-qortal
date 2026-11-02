import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { convertPage, convertPost } from '../../src/convert.js';
import { rewriteInternalLinks } from '../../src/utils/html.js';
import { normalizePostOrPage } from '../../lib/source/wordpress/normalize.js';
import {
  corbettCompatibilityRecord,
  rewriteLegacyContentHtml,
  toLegacyContent
} from '../../lib/engine/compat/corbett.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FIXED_IMPORTED_AT = '1970-01-01T00:00:00.000Z';

async function golden(name) {
  return JSON.parse(await readFile(path.join(REPO_ROOT, 'fixtures', 'corbett', name), 'utf8'));
}

function normalize(entry, contentType, extra = {}) {
  return normalizePostOrPage({
    contentType,
    raw: entry.rawPost ?? entry.rawPage,
    site: entry.site,
    featuredMedia: entry.featuredMedia ?? null,
    attachments: entry.attachments ?? [],
    ...extra
  });
}

function withoutImportedAt(record) {
  const copy = structuredClone(record);
  if (copy.import) {
    copy.import.imported_at = FIXED_IMPORTED_AT;
  }
  return copy;
}

test('legacy Corbett post conversion still matches its golden fixture', async () => {
  const entry = await golden('golden-post.json');
  const actual = convertPost(entry.rawPost, {
    wordpressBaseUrl: entry.site,
    importerVersion: entry.options.importerVersion,
    publicAuthorName: entry.options.publicAuthorName
  }, entry.attachments);
  actual.import.imported_at = FIXED_IMPORTED_AT;
  assert.deepEqual(actual, entry.expectedLegacy);
});

test('new adapter compatibility view reproduces legacy post output', async () => {
  const entry = await golden('golden-post.json');
  const document = normalize(entry, 'post');
  const legacy = toLegacyContent(document, {
    publicAuthorName: entry.options.publicAuthorName,
    importerVersion: entry.options.importerVersion,
    importedAt: FIXED_IMPORTED_AT
  });
  assert.deepEqual(withoutImportedAt(legacy), entry.expectedLegacy);
  assert.deepEqual(legacy.media, entry.expectedLegacy.media);
  assert.deepEqual(legacy.links, entry.expectedLegacy.links);
  assert.deepEqual(legacy.attachments, entry.expectedLegacy.attachments);
});

test('new adapter compatibility view reproduces legacy page output', async () => {
  const entry = await golden('golden-page.json');
  const legacy = convertPage(entry.rawPage, {
    wordpressBaseUrl: entry.site,
    importerVersion: entry.options.importerVersion,
    publicAuthorName: entry.options.publicAuthorName
  });
  legacy.import.imported_at = FIXED_IMPORTED_AT;
  assert.deepEqual(legacy, entry.expectedLegacy);

  const document = normalize(entry, 'page');
  const adapted = toLegacyContent(document, {
    publicAuthorName: entry.options.publicAuthorName,
    importerVersion: entry.options.importerVersion,
    importedAt: FIXED_IMPORTED_AT
  });
  assert.deepEqual(withoutImportedAt(adapted), entry.expectedLegacy);
});

test('Corbett route rewriting rules remain byte-identical', async () => {
  const entry = await golden('golden-post.json');
  const document = normalize(entry, 'post');
  const legacy = toLegacyContent(document, {
    publicAuthorName: entry.options.publicAuthorName,
    importerVersion: entry.options.importerVersion,
    importedAt: FIXED_IMPORTED_AT
  });
  const legacyRewritten = rewriteInternalLinks(legacy.content_html, entry.site, entry.urlMap);
  const adaptedRewritten = rewriteLegacyContentHtml(document, entry.site, entry.urlMap);
  assert.equal(legacyRewritten, entry.expectedRewrittenHtml);
  assert.equal(adaptedRewritten, entry.expectedRewrittenHtml);
  assert.ok(adaptedRewritten.includes('href="#/pages/about"'));
  assert.ok(adaptedRewritten.includes('data-web2-href="/about/"'));
});

test('Corbett profile identifiers stay cr-* and are not replaced by the universal schema', async () => {
  const record = corbettCompatibilityRecord({ repoRoot: REPO_ROOT });
  assert.equal(record.profileId, 'corbettreport');
  assert.equal(record.resourcePrefix, 'cr');
  assert.equal(record.qdnIdentifiers.qdn_manifest, 'cr-qdn-manifest');
  assert.equal(record.qdnIdentifiers.posts_index, 'cr-posts-index');
  assert.equal(record.qdnIdentifiers.media_map, 'cr-media-map');
  assert.equal(record.publicAuthorName, 'Corbett');
});

test('normalized content keeps original HTML while hashing a canonical form', async () => {
  const entry = await golden('golden-post.json');
  const document = normalize(entry, 'post');
  assert.equal(document.body.html, entry.rawPost.content.rendered);
  const legacy = toLegacyContent(document, {
    publicAuthorName: entry.options.publicAuthorName,
    importerVersion: entry.options.importerVersion,
    importedAt: FIXED_IMPORTED_AT
  });
  assert.equal(legacy.content_html, entry.rawPost.content.rendered);
  assert.notEqual(document.content_hash, '');
});
