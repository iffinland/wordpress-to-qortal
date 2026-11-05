/**
 * CMS-authored content supplement.
 *
 * QMS-imported content stays in the QMS manifest and indexes, untouched. The
 * CMS publishes its own versioned supplement in the same QDN name:
 *
 *   DOCUMENT / <name> / qms-cms-native-index
 *
 * Entries use the exact qms-qdn-index entry shape and content resources use
 * qms-qdn-content@1, so both sources normalize into one public catalog, one
 * search, one category/tag space. A WordPress incremental sync never deletes
 * this resource, and publishing here never deletes manifest entries.
 */

import { slugify } from './text.js';

export const NATIVE_INDEX_SCHEMA = 'qms-cms-native-index@1';
export const NATIVE_INDEX_VERSION = 1;
export const NATIVE_INDEX_IDENTIFIER = 'qms-cms-native-index';
export const NATIVE_CONTENT_SCHEMA = 'qms-qdn-content@1';

export function emptyNativeIndex(siteId = 'site') {
  return {
    schema: NATIVE_INDEX_SCHEMA,
    version: NATIVE_INDEX_VERSION,
    revision: 0,
    site_id: String(siteId || 'site'),
    updated_at: null,
    published_by: null,
    categories: [],
    tags: [],
    entries: []
  };
}

export function readNativeIndex(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, errors: ['Native index is not an object.'], index: null };
  if (payload.schema !== NATIVE_INDEX_SCHEMA) return { ok: false, errors: ['Unsupported native index schema.'], index: null };
  if (Number(payload.version) > NATIVE_INDEX_VERSION) return { ok: false, errors: ['Native index version is newer than this template.'], index: null };
  if (!Array.isArray(payload.entries)) return { ok: false, errors: ['Native index entries must be an array.'], index: null };
  return { ok: true, errors: [], index: payload };
}

function slugKey(value) {
  return String(value || '').trim().toLowerCase();
}

function termList(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => (typeof entry === 'string' ? { id: entry, name: entry, slug: slugify(entry) } : entry))
    .filter((entry) => entry && (entry.id || entry.name))
    .map((entry) => ({
      id: String(entry.id || 'term-' + slugify(entry.name || entry.slug)),
      name: String(entry.name || entry.id),
      slug: String(entry.slug || slugify(entry.name || entry.id)),
      count: Number.isFinite(Number(entry.count)) ? Number(entry.count) : undefined
    }));
}

function mergeTerms(base, extra) {
  const byId = new Map((base || []).map((term) => [term.id, { ...term }]));
  for (const term of extra || []) {
    const existing = byId.get(term.id);
    if (existing) {
      byId.set(term.id, { ...existing, count: (Number(existing.count) || 0) + (Number(term.count) || 0) });
    } else {
      byId.set(term.id, term);
    }
  }
  return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Merge the CMS supplement into the normalized QMS dataset. Imported content
 * always wins a slug or id collision; the CMS editor blocks those collisions
 * before publishing, so this is a last-resort safety net, not a silent overwrite.
 */
export function mergeNativeCatalog(dataset, nativeIndex) {
  if (!dataset) return dataset;
  if (!nativeIndex || !Array.isArray(nativeIndex.entries) || nativeIndex.entries.length === 0) return dataset;
  const notices = [...(dataset.notices || [])];
  const importedIds = new Set([...dataset.posts, ...dataset.pages].map((item) => item.id));
  const importedSlugs = new Set([...dataset.posts, ...dataset.pages].map((item) => item.type + ':' + item.slug));
  const nativePosts = [];
  const nativePages = [];
  let collisions = 0;
  for (const entry of nativeIndex.entries) {
    if (!entry || typeof entry !== 'object' || !entry.slug) continue;
    const type = entry.type === 'page' ? 'page' : 'post';
    const key = type + ':' + slugKey(entry.slug);
    if (importedIds.has(entry.id) || importedSlugs.has(key)) {
      collisions += 1;
      continue;
    }
    if ((type === 'page' ? nativePages : nativePosts).some((item) => item.id === entry.id || item.slug === entry.slug)) continue;
    const normalized = {
      id: String(entry.id || 'cms-' + slugKey(entry.slug)),
      type,
      title: String(entry.title || entry.slug),
      slug: String(entry.slug),
      status: String(entry.status || 'published'),
      excerpt: String(entry.excerpt || ''),
      categoryIds: Array.isArray(entry.category_ids) ? entry.category_ids.map(String) : [],
      tagIds: Array.isArray(entry.tag_ids) ? entry.tag_ids.map(String) : [],
      createdAt: entry.created_at || entry.createdAt || null,
      updatedAt: entry.updated_at || entry.updatedAt || null,
      publishedAt: entry.published_at || entry.publishedAt || entry.created_at || null,
      contentRef: entry.qdn || entry.content || null,
      featuredImageRef: entry.featured_image || null,
      contentHash: entry.contentHash || entry.content_hash || null,
      native: true,
      legacy: null
    };
    (type === 'page' ? nativePages : nativePosts).push(normalized);
  }
  if (collisions > 0) {
    notices.push({
      code: 'cms-native-slug-collision',
      level: 'warning',
      message: collisions + ' CMS-authored item(s) were skipped because their slug collides with imported content. Rename the CMS slug to publish the update.'
    });
  }
  const posts = [...(dataset.posts || []), ...nativePosts].sort((left, right) => {
    const leftTime = Date.parse(left.publishedAt || left.createdAt || '') || 0;
    const rightTime = Date.parse(right.publishedAt || right.createdAt || '') || 0;
    return rightTime - leftTime;
  });
  const pages = [...(dataset.pages || []), ...nativePages];
  const allPosts = posts;
  const categories = mergeTerms(dataset.categories, termList(nativeIndex.categories)).map((term) => ({
    ...term,
    count: allPosts.filter((item) => item.categoryIds.includes(term.id)).length
  }));
  const tags = mergeTerms(dataset.tags, termList(nativeIndex.tags)).map((term) => ({
    ...term,
    count: allPosts.filter((item) => item.tagIds.includes(term.id)).length
  }));
  return {
    ...dataset,
    posts,
    pages,
    categories,
    tags,
    notices,
    nativeIndex
  };
}

export function nativeContentIdentifier(siteId, slug) {
  const safe = slugify(slug).slice(0, 40) || 'post';
  const seed = String(siteId || 'site') + '|' + slug;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ('qms-cms-' + (slugify(siteId).slice(0, 10) || 'site') + '-post-' + safe + '-' + (hash >>> 0).toString(36)).slice(0, 64);
}

export function nativeEntryFromDraft(draft, { siteId, qdnName, contentIdentifier, contentHash, now = Date.now() }) {
  const categories = termList(draft.categories || []);
  const tags = termList(draft.tags || []);
  return {
    entry: {
      id: draft.id || 'cms-' + slugify(draft.slug),
      type: draft.type === 'page' ? 'page' : 'post',
      title: draft.title,
      slug: slugify(draft.slug),
      status: draft.status || 'published',
      excerpt: draft.excerpt || '',
      category_ids: categories.map((term) => term.id),
      tag_ids: tags.map((term) => term.id),
      created_at: draft.createdAt || new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
      published_at: draft.publishedAt || new Date(now).toISOString(),
      contentHash: contentHash || null,
      qdn: { service: 'DOCUMENT', name: qdnName, identifier: contentIdentifier }
    },
    categories,
    tags
  };
}

export function buildNativeContentPayload(draft, { contentIdentifier, qdnName, contentHash, now = Date.now() }) {
  return {
    schema: NATIVE_CONTENT_SCHEMA,
    version: 1,
    id: draft.id || 'cms-' + slugify(draft.slug),
    content_type: draft.type === 'page' ? 'page' : 'post',
    source: { adapter: 'qms-cms-native', key: draft.slug },
    identity: { slug: slugify(draft.slug), old_url: null, canonical_url: null, parent_key: null, menu_order: null },
    title: draft.title,
    dates: {
      published_at: draft.publishedAt || new Date(now).toISOString(),
      modified_at: new Date(now).toISOString()
    },
    publication_status: draft.status || 'published',
    body: {
      format: 'html',
      html: draft.html || '',
      text: draft.text || '',
      excerpt_html: draft.excerptHtml || '',
      excerpt_text: draft.excerpt || '',
      summary: draft.excerpt || ''
    },
    authors: [{ name: draft.author || '', role: 'author' }],
    terms: { categories: draft.categoryIds || [], tags: draft.tagIds || [] },
    media: draft.media || [],
    links: { internal: [], external: [], external_media: [] },
    content_hash: contentHash || null,
    qdn: { service: 'DOCUMENT', name: qdnName, identifier: contentIdentifier }
  };
}

export function slugAvailable(dataset, slug, options = {}) {
  const key = slugKey(slug);
  if (!key) return { ok: false, message: 'A slug is required.' };
  const exceptId = options.exceptId || null;
  const items = [...(dataset && dataset.posts || []), ...(dataset && dataset.pages || [])];
  for (const item of items) {
    if (exceptId && item.id === exceptId && item.native) continue;
    if (slugKey(item.slug) === key) {
      return { ok: false, message: 'The slug "' + slug + '" is already used by ' + (item.native ? 'a CMS post' : 'imported content') + '. Choose another slug.' };
    }
  }
  return { ok: true, message: '' };
}

/**
 * Conflict-aware upsert. The caller must pass the revision it read before
 * editing; a newer published revision blocks the write instead of clobbering it.
 */
export function upsertNativeEntry(index, entry, options = {}) {
  const current = index && index.schema === NATIVE_INDEX_SCHEMA ? index : emptyNativeIndex(options.siteId);
  const baseRevision = Math.max(0, Number(options.baseRevision) || 0);
  const remoteRevision = Number(current.revision) || 0;
  if (remoteRevision > baseRevision) {
    return {
      ok: false,
      conflict: true,
      message: 'CMS content moved from revision ' + baseRevision + ' to ' + remoteRevision + '. Reload before saving so no published post is overwritten.',
      index: current
    };
  }
  const entries = Array.isArray(current.entries) ? current.entries : [];
  const byId = new Map(entries.map((item) => [item.id, item]));
  const existing = byId.get(entry.id);
  if (existing && options.allowOverwrite !== true && existing.slug !== entry.slug && options.expectExistingSlug && existing.slug !== options.expectExistingSlug) {
    return { ok: false, conflict: true, message: 'This post changed on another device. Reload before saving.', index: current };
  }
  byId.set(entry.id, entry);
  const categories = mergeTermDefinitions(current.categories, options.categories || []);
  const tags = mergeTermDefinitions(current.tags, options.tags || []);
  return {
    ok: true,
    conflict: false,
    message: '',
    index: {
      ...current,
      revision: remoteRevision + 1,
      updated_at: new Date(options.now || Date.now()).toISOString(),
      published_by: options.identity ? { address: options.identity.address, name: options.identity.qdnName } : current.published_by,
      categories,
      tags,
      entries: Array.from(byId.values())
    }
  };
}

export function mergeTermDefinitions(base, extra) {
  const byId = new Map((Array.isArray(base) ? base : []).map((term) => [term.id, term]));
  for (const term of extra) {
    if (!term || !term.id) continue;
    if (!byId.has(term.id)) byId.set(term.id, { id: term.id, name: term.name, slug: term.slug });
  }
  return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export function removeNativeEntry(index, id, options = {}) {
  const current = index && index.schema === NATIVE_INDEX_SCHEMA ? index : emptyNativeIndex(options.siteId);
  const remoteRevision = Number(current.revision) || 0;
  const baseRevision = Math.max(0, Number(options.baseRevision) || 0);
  if (remoteRevision > baseRevision) {
    return { ok: false, conflict: true, message: 'CMS content changed on another device. Reload before deleting.', index: current };
  }
  return {
    ok: true,
    conflict: false,
    message: '',
    index: {
      ...current,
      revision: remoteRevision + 1,
      updated_at: new Date(options.now || Date.now()).toISOString(),
      entries: (current.entries || []).filter((entry) => entry.id !== id)
    }
  };
}

