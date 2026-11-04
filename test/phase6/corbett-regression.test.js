import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { rewriteInternalLinks } from '../../src/utils/html.js';
import { readRepoJson, REPO_ROOT, loadFixtureManifest } from './support/fixtures.js';
import { loadCmsDataset } from '../../templates/generic-cms/src/lib/manifest.js';
import { categoryHref, pageHref, parseHashRoute, postHref, tagHref } from '../../templates/generic-cms/src/lib/routes.js';

test('Corbett profile branding, names and cr-* identifiers are unchanged', async () => {
  const profile = await readRepoJson('profiles/corbettreport/profile.json');
  assert.equal(profile.id, 'corbettreport');
  assert.equal(profile.resource_prefix, 'cr');
  assert.equal(profile.cms_site_title, 'The Corbett Report');
  assert.equal(profile.cms_tagline, 'Open Source Intelligence News');
  assert.equal(profile.public_author_name, 'Corbett');
  assert.deepEqual(profile.qortal_sysop_names, ['Corbett', 'CorbettReport']);
  assert.deepEqual(profile.qortal_coauthor_names, ['AgoristMarket', 'iffi']);
});

test('Corbett public route surface still exists in the custom clone', async () => {
  const source = await readFile(path.join(REPO_ROOT, 'corbettreport', 'src', 'app', 'routes.ts'), 'utf8');
  for (const marker of ["parts[0] === 'posts'", "parts[0] === 'pages'", "parts[0] === 'category'", "parts[0] === 'tag'", "parts[0] === 'archive'", "parts[0] === 'documentaries'", "parts[0] === 'best-of-corbett'", "parts[0] === 'admin'"]) {
    assert.ok(source.includes(marker), 'Corbett route parser is missing ' + marker);
  }
  assert.ok(source.includes('WEB2_BASE_URL'));
});

test('Corbett import/adoption UI behavior is retained', async () => {
  const source = await readFile(path.join(REPO_ROOT, 'corbettreport', 'src', 'cms', 'CmsBackendApp.tsx'), 'utf8');
  for (const marker of ['canAdoptImportedContent', "type Section = 'dashboard' | 'posts' | 'media' | 'imported' | 'settings'", "type ImportedStatusFilter = 'not-adopted' | 'adopted' | 'all'", 'IMPORT_BATCH_LIMIT', 'DEFAULT_IMPORT_MANIFEST_IDENTIFIER', 'internalRouteForWeb2Url']) {
    assert.ok(source.includes(marker), 'Corbett CMS is missing adoption marker ' + marker);
  }
});

test('Corbett route rewriting remains byte-identical to its golden fixture', async () => {
  const golden = await readRepoJson('fixtures/corbett/golden-post.json');
  const actual = rewriteInternalLinks(golden.expectedLegacy.content_html, golden.site, golden.urlMap);
  assert.equal(actual, golden.expectedRewrittenHtml);
});

test('legacy Corbett catalog still maps to its existing public routes', async () => {
  const fixture = await loadFixtureManifest('legacy/cr-qdn-manifest.json');
  const profile = await readRepoJson('profiles/corbettreport/profile.json');
  const dataset = await loadCmsDataset(fixture.raw, {
    fetchRef: fixture.fetchRef,
    now: Date.parse('2026-09-10T00:00:00Z'),
    staleAfterMs: 1e15,
    siteDefaults: {
      id: profile.id,
      title: profile.cms_site_title,
      tagline: profile.cms_tagline,
      ownerName: profile.qortal_site_name,
      publicAuthor: profile.public_author_name
    }
  });
  const post = dataset.posts[0];
  const page = dataset.pages[0];
  assert.deepEqual(parseHashRoute(postHref(post.slug)), { kind: 'post', slug: 'golden-post' });
  assert.deepEqual(parseHashRoute(pageHref(page.slug)), { kind: 'page', slug: 'golden-page' });
  assert.equal(post.legacy.oldUrl, 'https://corbett.example/golden-post/');
  assert.equal(post.contentRef.identifier, 'cr-post-900');
  assert.equal(page.contentRef.identifier, 'cr-page-901');
  assert.equal(categoryHref('news'), '#/category/news');
  assert.equal(tagHref('analysis'), '#/tag/analysis');
});
