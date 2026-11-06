/**
 * Versioned full-text search for the generic CMS.
 *
 * Resource: DOCUMENT / <site name> / qms-cms-search-index
 * Schema:   qms-cms-search-index@1
 *
 * The index holds normalized plain text or a compact excerpt plus a reference
 * to the content item. It never contains media bytes and is never built by
 * scanning QDN on each keystroke. CMS-native publishing updates its own entry
 * and QMS imports publish the same schema through the catalog manifest.
 */

import { stripHtml } from './text.js';

export const SEARCH_INDEX_SCHEMA = 'qms-cms-search-index@1';
export const SEARCH_INDEX_VERSION = 1;
export const SEARCH_INDEX_IDENTIFIER = 'qms-cms-search-index';
export const SEARCH_TEXT_LIMIT = 20000;
export const SEARCH_INDEX_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const SEARCH_REBUILD_HINT = 'Publish any post from the CMS Admin to rebuild the search index, or republish the site from Qortal Migration Studio.';

const MAX_QUERY_LENGTH = 200;

/** NFC + lowercase keeps Estonian characters (õ, ä, ö, ü, š, ž) intact. */
export function normalizeSearchText(value) {
  return String(value == null ? '' : value).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Fold accents for tolerant matching and keep a source index for every
 * folded character so highlights map back to the original text exactly.
 */
export function foldSearchText(value) {
  const original = String(value == null ? '' : value);
  const chars = [];
  const map = [];
  let sourceIndex = 0;
  for (const char of original) {
    const folded = char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (const piece of folded) {
      chars.push(piece);
      map.push(sourceIndex);
    }
    sourceIndex += char.length;
  }
  return { text: chars.join(''), map };
}

export function tokenizeQuery(query) {
  const raw = String(query || '').trim().slice(0, MAX_QUERY_LENGTH);
  if (!raw) return { original: '', phrases: [], terms: [], all: [] };
  const phrases = [];
  const withoutPhrases = raw.replace(/"([^"]+)"|'([^']+)'/g, (_, doubleQuoted, singleQuoted) => {
    const value = String(doubleQuoted || singleQuoted || '').trim();
    if (value) phrases.push(value);
    return ' ';
  });
  const terms = withoutPhrases.split(/\s+/).filter(Boolean);
  return { original: raw, phrases, terms, all: [...phrases, ...terms] };
}

function safeText(value, limit = SEARCH_TEXT_LIMIT) {
  return String(value == null ? '' : value).slice(0, limit);
}

export function normalizeSearchEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = String(entry.id || '').trim();
  const slug = String(entry.slug || '').trim();
  const title = String(entry.title || '').trim();
  if (!id || !slug || !title) return null;
  return {
    id,
    type: entry.type === 'page' ? 'page' : 'post',
    title,
    slug,
    excerpt: safeText(entry.excerpt),
    text: safeText(entry.text),
    updated_at: entry.updated_at || entry.updatedAt || null,
    origin: entry.origin === 'imported' ? 'imported' : 'cms'
  };
}

export function createSearchEntryFromItem(item, text = '') {
  return normalizeSearchEntry({
    id: item.id,
    type: item.type,
    title: item.title,
    slug: item.slug,
    excerpt: item.excerpt,
    text,
    updated_at: item.updatedAt || item.publishedAt || null,
    origin: item.native ? 'cms' : 'imported'
  });
}

export function createSearchEntryFromDraft(draft) {
  const text = stripHtml(draft.html || '');
  return normalizeSearchEntry({
    id: draft.id || 'cms-' + draft.slug,
    type: draft.type === 'page' ? 'page' : 'post',
    title: draft.title,
    slug: draft.slug,
    excerpt: draft.excerpt || text.slice(0, 240),
    text,
    updated_at: new Date().toISOString(),
    origin: 'cms'
  });
}

export function emptySearchIndex(siteId = '') {
  return {
    schema: SEARCH_INDEX_SCHEMA,
    version: SEARCH_INDEX_VERSION,
    revision: 0,
    site_id: String(siteId || ''),
    updated_at: null,
    entry_count: 0,
    entries: []
  };
}

export function buildSearchIndexDocument({ siteId = '', entries = [], revision = 0, now = Date.now(), source = 'cms' } = {}) {
  const unique = new Map();
  for (const raw of entries) {
    const entry = normalizeSearchEntry(raw);
    if (entry) unique.set(entry.type + ':' + entry.slug, entry);
  }
  const sorted = [...unique.values()].sort((left, right) => left.title.localeCompare(right.title));
  return {
    schema: SEARCH_INDEX_SCHEMA,
    version: SEARCH_INDEX_VERSION,
    revision: Math.max(0, Number(revision) || 0),
    site_id: String(siteId || ''),
    source,
    updated_at: new Date(now).toISOString(),
    entry_count: sorted.length,
    entries: sorted
  };
}

export function upsertSearchEntry(index, rawEntry, { now = Date.now() } = {}) {
  const entry = normalizeSearchEntry(rawEntry);
  if (!entry) return { ok: false, message: 'The search index entry is invalid.' };
  const current = index && index.schema === SEARCH_INDEX_SCHEMA ? index : emptySearchIndex();
  const entries = (Array.isArray(current.entries) ? current.entries : [])
    .map(normalizeSearchEntry)
    .filter(Boolean)
    .filter((item) => !(item.id === entry.id || (item.type === entry.type && item.slug === entry.slug)));
  entries.push(entry);
  const revision = Math.max(0, Number(current.revision) || 0) + 1;
  return {
    ok: true,
    message: '',
    index: buildSearchIndexDocument({
      siteId: current.site_id,
      entries,
      revision,
      now,
      source: 'cms'
    })
  };
}

export function readSearchIndex(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, index: null, errors: ['The search index is not a JSON object.'] };
  }
  if (payload.schema !== SEARCH_INDEX_SCHEMA) {
    return { ok: false, index: null, errors: ['Unsupported search index schema.'] };
  }
  if (Number(payload.version) > SEARCH_INDEX_VERSION) {
    return { ok: false, index: null, errors: ['The search index was built by a newer template version.'] };
  }
  if (!Array.isArray(payload.entries)) {
    return { ok: false, index: null, errors: ['The search index entries must be an array.'] };
  }
  const entries = payload.entries.map(normalizeSearchEntry).filter(Boolean);
  return { ok: true, index: { ...payload, entries }, errors: [] };
}

export function isSearchIndexStale(index, now = Date.now(), maxAgeMs = SEARCH_INDEX_MAX_AGE_MS) {
  if (!index || !index.updated_at) return false;
  const stamp = Date.parse(index.updated_at);
  return Number.isFinite(stamp) ? now - stamp > maxAgeMs : false;
}

function queryMatchers(parsed) {
  return parsed.all
    .map((term) => {
      const normalized = normalizeSearchText(term);
      if (!normalized) return null;
      return { raw: term, folded: foldSearchText(normalized).text };
    })
    .filter(Boolean);
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Highlight ranges in original-text coordinates, safe for spans/text nodes. */
export function highlightTextParts(text, terms) {
  const original = String(text == null ? '' : text);
  if (!original) return [];
  const folded = foldSearchText(original);
  const needles = [...new Set((Array.isArray(terms) ? terms : [terms])
    .map((term) => foldSearchText(normalizeSearchText(term)).text)
    .filter((term) => term.length > 0))];
  if (needles.length === 0) return [{ text: original, match: false }];

  const ranges = [];
  for (const needle of needles) {
    let index = folded.text.indexOf(needle);
    while (index >= 0) {
      const start = folded.map[index];
      const last = folded.map[index + needle.length - 1];
      if (start != null && last != null) ranges.push([start, last + 1]);
      index = folded.text.indexOf(needle, index + needle.length);
    }
  }
  if (ranges.length === 0) return [{ text: original, match: false }];

  ranges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }

  const parts = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) parts.push({ text: original.slice(cursor, start), match: false });
    parts.push({ text: original.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < original.length) parts.push({ text: original.slice(cursor), match: false });
  return parts;
}

export function makeSnippet(text, terms, radius = 80) {
  const original = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!original) return '';
  const parts = highlightTextParts(original, terms);
  const hit = parts.find((part) => part.match);
  if (!hit) return original.slice(0, radius * 2) + (original.length > radius * 2 ? '…' : '');
  let offset = 0;
  for (const part of parts) {
    if (part.match) break;
    offset += part.text.length;
  }
  const start = Math.max(0, offset - radius);
  const end = Math.min(original.length, offset + hit.text.length + radius);
  return (start > 0 ? '…' : '') + original.slice(start, end) + (end < original.length ? '…' : '');
}

function matchScore(entry, matchers) {
  const title = foldSearchText(normalizeSearchText(entry.title)).text;
  const excerpt = foldSearchText(normalizeSearchText(entry.excerpt)).text;
  const body = foldSearchText(normalizeSearchText(entry.text)).text;
  let score = 0;
  for (const matcher of matchers) {
    const needle = matcher.folded;
    if (!needle) continue;
    const inTitle = title.indexOf(needle);
    const inExcerpt = excerpt.indexOf(needle);
    const inBody = body.indexOf(needle);
    if (inTitle < 0 && inExcerpt < 0 && inBody < 0) return null;
    if (inTitle === 0) score += 0;
    else if (inTitle > 0) score += 2;
    else if (inExcerpt >= 0) score += 5;
    else score += 10;
    if (inTitle >= 0) score -= Math.min(3, countOccurrences(title, needle));
    if (inExcerpt >= 0) score -= Math.min(2, countOccurrences(excerpt, needle));
    if (inBody >= 0) score -= Math.min(2, countOccurrences(body, needle));
  }
  return score;
}

/**
 * Search a versioned index. All terms and quoted phrases must match somewhere
 * in title, excerpt or body. Results are deterministic: score, then date.
 */
export function searchIndexEntries(index, query, { limit = 20 } = {}) {
  const parsed = tokenizeQuery(query);
  const matchers = queryMatchers(parsed);
  if (matchers.length === 0) return { query: parsed.original, results: [], total: 0 };
  if (!index || !Array.isArray(index.entries)) return { query: parsed.original, results: [], total: 0 };

  const scored = [];
  for (const rawEntry of index.entries) {
    const entry = normalizeSearchEntry(rawEntry);
    if (!entry) continue;
    const score = matchScore(entry, matchers);
    if (score === null) continue;
    const snippet = makeSnippet(entry.text || entry.excerpt || entry.title, parsed.all);
    scored.push({ entry, score, snippet });
  }
  scored.sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score;
    const leftTime = Date.parse(left.entry.updated_at || '') || 0;
    const rightTime = Date.parse(right.entry.updated_at || '') || 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return left.entry.title.localeCompare(right.entry.title);
  });
  return { query: parsed.original, results: scored.slice(0, limit), total: scored.length };
}

/**
 * Backwards-compatible dataset search over titles, excerpts and taxonomy.
 * Full-text search uses searchIndexEntries with the versioned index; this
 * helper remains for callers that only have an already-loaded dataset.
 */
export function searchDataset(dataset, query) {
  const termsById = new Map([
    ...((dataset && dataset.categories) || []).map((term) => [term.id, term.name]),
    ...((dataset && dataset.tags) || []).map((term) => [term.id, term.name])
  ]);
  const entries = [...((dataset && dataset.posts) || []), ...((dataset && dataset.pages) || [])]
    .filter((item) => item.status === 'published')
    .map((item) => normalizeSearchEntry({
      id: item.id,
      type: item.type,
      title: item.title,
      slug: item.slug,
      excerpt: item.excerpt,
      text: [...(item.categoryIds || []), ...(item.tagIds || [])].map((id) => termsById.get(id) || '').join(' '),
      updated_at: item.updatedAt || item.publishedAt || null,
      origin: item.native ? 'cms' : 'imported'
    }))
    .filter(Boolean);
  const index = { schema: SEARCH_INDEX_SCHEMA, version: SEARCH_INDEX_VERSION, entries: /** @type {never[]} */ (entries) };
  const found = searchIndexEntries(index, query, { limit: 1000 });
  const slugs = new Set(found.results.map((result) => result.entry.id));
  const posts = ((dataset && dataset.posts) || []).filter((item) => item.type === 'post' && slugs.has(item.id));
  const pages = ((dataset && dataset.pages) || []).filter((item) => item.type === 'page' && slugs.has(item.id));
  return { posts, pages, total: posts.length + pages.length };
}

export function searchIndexHref(slug, type = 'post', query = '') {
  const base = type === 'page' ? '#/pages/' + encodeURIComponent(slug) : '#/posts/' + encodeURIComponent(slug);
  return query ? base + '?q=' + encodeURIComponent(query) : base;
}
