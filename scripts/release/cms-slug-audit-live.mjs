#!/usr/bin/env node
/**
 * Read-only live slug audit for a Generic CMS catalog.
 *
 * Fetches the live manifest, imported posts/pages indexes, the CMS native
 * index, the edit overlay and the search index. It never authenticates,
 * publishes, signs or writes to QDN.
 */
const args = Object.fromEntries(process.argv.slice(2).map((value) => {
  const index = value.indexOf('=');
  return index === -1 ? [value.replace(/^--/, ''), true] : [value.slice(2, index), value.slice(index + 1)];
}));
const nodeUrl = String(args['node-url'] ?? 'http://100.116.185.83:12391').replace(/\/$/, '');
const name = String(args.name ?? 'developer iffi');
const enc = (value) => encodeURIComponent(value);

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + url);
  return await response.json();
}

async function getBase64Json(identifier) {
  const url = nodeUrl + '/arbitrary/DOCUMENT/' + enc(name) + '/' + enc(identifier) + '?encoding=BASE64';
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) return null;
  const encoded = (await response.text()).replace(/\s+/g, '');
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['\u2019\u2018\u02bc]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
    .replace(/-+$/g, '');
}

function itemRecord(item, source) {
  const slug = String(item.slug || '');
  const title = String(item.title || '');
  const expected = slugify(title);
  return {
    source,
    type: item.type || (item.content_type === 'page' ? 'page' : 'post'),
    id: String(item.id || item.source_item_id || item.source_id || ''),
    title,
    slug,
    expected,
    slugLength: slug.length,
    oneCharacter: slug.length === 1,
    truncated: slug.length > 0 && slug.length <= 2 && slug !== expected && expected.length > slug.length,
    matchesTitle: slug === expected
  };
}

const startedAt = new Date().toISOString();
const report = {
  schema: 'qms-cms-slug-audit@1',
  nodeUrl,
  name,
  startedAt,
  publicationPerformed: false,
  signingPerformed: false,
  counts: {},
  findings: [],
  items: [],
  ok: false
};

try {
  const manifest = await getJson(nodeUrl + '/arbitrary/DOCUMENT/' + enc(name) + '/qms-cms-manifest');
  report.manifest = { schema: manifest.schema, version: manifest.version, generatedAt: manifest.generated_at || null };
  const entrypoints = manifest.entrypoints || {};
  for (const key of ['posts', 'pages']) {
    if (!entrypoints[key]) continue;
    const payload = await getBase64Json(entrypoints[key]);
    const entries = payload && Array.isArray(payload.entries) ? payload.entries : [];
    for (const entry of entries) report.items.push(itemRecord(entry, 'imported-' + key));
  }

  const native = await getBase64Json('qms-cms-native-index');
  for (const entry of (native && native.entries) || []) report.items.push(itemRecord(entry, 'cms-native'));

  const overlay = await getBase64Json('qms-cms-edit-overlay');
  for (const entry of (overlay && overlay.entries) || []) {
    report.items.push(itemRecord({ ...entry, id: entry.source_item_id, type: entry.source_type }, 'wordpress-overlay'));
  }

  const search = await getBase64Json('qms-cms-search-index');
  report.search = { present: Boolean(search), entries: search && Array.isArray(search.entries) ? search.entries.length : 0 };

  report.counts = {
    total: report.items.length,
    imported: report.items.filter((item) => item.source.startsWith('imported')).length,
    native: report.items.filter((item) => item.source === 'cms-native').length,
    overlay: report.items.filter((item) => item.source === 'wordpress-overlay').length,
    oneCharacter: report.items.filter((item) => item.oneCharacter).length,
    truncated: report.items.filter((item) => item.truncated).length
  };
  report.findings = report.items.filter((item) => item.oneCharacter || item.truncated);
  report.ok = true;
} catch (error) {
  report.error = error.message;
}
report.finishedAt = new Date().toISOString();
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
