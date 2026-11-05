#!/usr/bin/env node
/**
 * Read-only compatibility proof: load the live QMS catalog, merge a synthetic
 * CMS supplement, and verify both sources share one normalized catalog/search.
 * No publication or signing.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadCmsDataset, normalizeManifest } from '../../templates/generic-cms/src/lib/manifest.js';
import { emptyNativeIndex, mergeNativeCatalog } from '../../templates/generic-cms/src/lib/nativeCatalog.js';
import { searchDataset } from '../../templates/generic-cms/src/lib/search.js';

const args = Object.fromEntries(process.argv.slice(2).map((value) => {
  const index = value.indexOf('=');
  return index === -1 ? [value.replace(/^--/, ''), true] : [value.slice(2, index), value.slice(index + 1)];
}));
const nodeUrl = String(args['node-url'] ?? 'http://100.116.185.83:12391').replace(/\/$/, '');
const name = String(args.name ?? 'developer iffi');
const reportPath = args.report ? path.resolve(args.report) : null;
const enc = (value) => encodeURIComponent(value);

async function fetchJson(identifier) {
  const response = await fetch(nodeUrl + '/arbitrary/DOCUMENT/' + enc(name) + '/' + enc(identifier), { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + identifier);
  return await response.json();
}

const report = { schema: 'qms-cms-compat-live@1', nodeUrl, name, startedAt: new Date().toISOString(), ok: false };
try {
  const rawManifest = await fetchJson('qms-cms-manifest');
  const manifest = normalizeManifest(rawManifest, { siteDefaults: { title: name, ownerName: name } });
  const dataset = await loadCmsDataset(rawManifest, {
    manifest,
    fetchRef: async (ref) => fetchJson(ref.identifier),
    siteDefaults: { title: name, ownerName: name }
  });
  report.imported = {
    state: dataset.state,
    posts: dataset.posts.length,
    pages: dataset.pages.length,
    categories: dataset.categories.length,
    tags: dataset.tags.length,
    ids: dataset.posts.map((item) => item.id)
  };

  const nativeIndex = {
    ...emptyNativeIndex('live-compat'),
    revision: 1,
    categories: [{ id: 'cms-category-cms-test', name: 'CMS Test', slug: 'cms-test' }],
    tags: [{ id: 'cms-tag-cms-test', name: 'CMS Test', slug: 'cms-test' }],
    entries: [{
      id: 'cms-live-compat-post',
      type: 'post',
      title: 'CMS compatibility post',
      slug: 'cms-compatibility-post',
      status: 'published',
      excerpt: 'A native post merged with live imported content.',
      category_ids: ['cms-category-cms-test'],
      tag_ids: ['cms-tag-cms-test'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
      contentHash: 'sha256:test',
      qdn: { service: 'DOCUMENT', name, identifier: 'qms-cms-live-compat-post' }
    }]
  };
  const merged = mergeNativeCatalog(dataset, nativeIndex);
  const importedTerms = searchDataset(merged, merged.posts[0].title.split(' ')[0]);
  const nativeTerms = searchDataset(merged, 'compatibility');
  report.merged = {
    posts: merged.posts.length,
    importedStillPresent: dataset.posts.every((item) => merged.posts.some((next) => next.id === item.id)),
    nativePresent: merged.posts.some((item) => item.id === 'cms-live-compat-post'),
    searchFindsImported: importedTerms.total > 0,
    searchFindsNative: nativeTerms.total === 1,
    categories: merged.categories.map((term) => term.id),
    tagsIncludeNative: merged.tags.some((term) => term.id === 'cms-tag-cms-test')
  };
  report.ok = report.merged.importedStillPresent
    && report.merged.nativePresent
    && report.merged.searchFindsImported
    && report.merged.searchFindsNative
    && report.merged.tagsIncludeNative;
} catch (error) {
  report.error = error.message;
}
report.finishedAt = new Date().toISOString();
if (reportPath) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);

