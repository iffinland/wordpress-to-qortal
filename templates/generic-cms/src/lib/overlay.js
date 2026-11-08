/**
 * Versioned local-edit overlay for imported WordPress content.
 *
 * Resource: DOCUMENT / <name> / qms-cms-edit-overlay
 * Schema:   qms-cms-edit-overlay@1
 *
 * The imported QMS manifest, indexes and content resources are never modified.
 * An overlay entry keeps the imported identity (item id, source id, old URL)
 * and points at a CMS-owned qms-qdn-content@1 resource. A catalog rebuild or
 * incremental WordPress sync therefore cannot erase the owner's edits, and no
 * second post format is introduced: overlay content uses the same
 * qms-qdn-content@1 schema as every other post.
 *
 * Conflict model:
 * - base_source_hash records the upstream content fingerprint the edit was
 *   based on. If the upstream item still has that fingerprint, the edit is
 *   clean and applies silently.
 * - If the fingerprint changed, the entry is conflicting: the UI shows both
 *   versions and the owner chooses Keep local edits or Accept upstream.
 * - Nothing is overwritten automatically, and nothing is deleted upstream.
 */

import { mergeAliases, slugify } from './slug.js';
import { featuredImageEntryFields, normalizeFeaturedImage } from './featuredImage.js';

export const OVERLAY_SCHEMA = 'qms-cms-edit-overlay@1';
export const OVERLAY_VERSION = 1;
export const OVERLAY_IDENTIFIER = 'qms-cms-edit-overlay';

export function emptyOverlay(siteId = 'site') {
  return {
    schema: OVERLAY_SCHEMA,
    version: OVERLAY_VERSION,
    revision: 0,
    site_id: String(siteId || 'site'),
    updated_at: null,
    published_by: null,
    entries: []
  };
}

export function readOverlay(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, errors: ['Edit overlay is not an object.'], overlay: null };
  if (payload.schema !== OVERLAY_SCHEMA) return { ok: false, errors: ['Unsupported edit overlay schema.'], overlay: null };
  if (Number(payload.version) > OVERLAY_VERSION) return { ok: false, errors: ['Edit overlay version is newer than this template.'], overlay: null };
  if (!Array.isArray(payload.entries)) return { ok: false, errors: ['Edit overlay entries must be an array.'], overlay: null };
  return { ok: true, errors: [], overlay: payload };
}

export function overlayKey(item) {
  if (!item) return '';
  return String(item.id || '');
}

export function findOverlayEntry(overlay, itemOrId) {
  const key = typeof itemOrId === 'string' ? itemOrId : overlayKey(itemOrId);
  if (!overlay || !Array.isArray(overlay.entries)) return null;
  return overlay.entries.find((entry) => String(entry.source_item_id) === key) || null;
}

/** Deterministic content identifier tied to the imported identity, not the slug. */
export function overlayContentIdentifier(siteId, sourceItemId) {
  const seed = String(siteId || 'site') + '|overlay|' + String(sourceItemId || '');
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ('qms-cms-ov-' + (slugify(siteId).slice(0, 8) || 'site') + '-' + (hash >>> 0).toString(36)).slice(0, 64);
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value == null ? null : value);
}

/**
 * Fingerprint of the upstream source content. Stable across whitespace-free
 * metadata order and used only for comparison, never as a public identifier.
 */
export function sourceFingerprint(source = {}) {
  return canonical({
    title: String(source.title || ''),
    html: String(source.html || ''),
    excerpt: String(source.excerpt || ''),
    modifiedAt: String(source.modifiedAt || ''),
    sourceId: source.sourceId == null ? null : String(source.sourceId)
  });
}

export function createOverlayEntry(options = {}) {
  const item = options.item || {};
  const content = options.content || {};
  const draft = options.draft || {};
  const now = Number(options.now) || Date.now();
  const previousSlug = String(item.slug || '');
  const slug = String(draft.slug || previousSlug);
  return {
    schema: OVERLAY_SCHEMA,
    source_item_id: String(item.id),
    source_type: item.type === 'page' ? 'page' : 'post',
    source_slug: String(item.slug || ''),
    source_adapter: 'wordpress',
    source_id: item.legacy && item.legacy.sourceId != null ? Number(item.legacy.sourceId) : null,
    source_old_url: (item.legacy && item.legacy.oldUrl) || null,
    slug,
    slug_aliases: mergeAliases(draft.slugAliases, previousSlug, slug),
    title: String(draft.title || content.title || item.title || ''),
    excerpt: String(draft.excerpt || ''),
    category_ids: Array.isArray(draft.categoryIds) ? draft.categoryIds.map(String) : (item.categoryIds || []).map(String),
    tag_ids: Array.isArray(draft.tagIds) ? draft.tagIds.map(String) : (item.tagIds || []).map(String),
    author: String(draft.author || content.author || item.author || ''),
    content: options.contentRef || null,
    content_hash: options.contentHash || null,
    ...featuredImageEntryFields(options.featuredImage || null),
    base_source_hash: String(options.baseSourceHash || ''),
    base_source_modified_at: item.updatedAt || content.modifiedAt || null,
    source_modified_at: content.modifiedAt || item.updatedAt || null,
    state: 'published',
    conflict_state: 'clean',
    edited_at: new Date(now).toISOString(),
    edited_by: options.identity ? { address: options.identity.address, name: options.identity.qdnName } : null
  };
}

/**
 * Revision-checked upsert. Callers pass the revision they read before editing;
 * a newer published revision blocks the write instead of clobbering it.
 */
export function upsertOverlayEntry(overlay, entry, options = {}) {
  const current = overlay && overlay.schema === OVERLAY_SCHEMA ? overlay : emptyOverlay(options.siteId);
  const remoteRevision = Number(current.revision) || 0;
  const baseRevision = Math.max(0, Number(options.baseRevision) || 0);
  if (remoteRevision > baseRevision) {
    return {
      ok: false,
      conflict: true,
      message: 'Local edits moved from revision ' + baseRevision + ' to ' + remoteRevision + '. Reload before saving so no edit is overwritten.',
      overlay: current
    };
  }
  const entries = Array.isArray(current.entries) ? [...current.entries] : [];
  const index = entries.findIndex((item) => String(item.source_item_id) === String(entry.source_item_id));
  if (index >= 0) entries[index] = entry;
  else entries.push(entry);
  return {
    ok: true,
    conflict: false,
    message: '',
    overlay: {
      ...current,
      revision: remoteRevision + 1,
      updated_at: new Date(options.now || Date.now()).toISOString(),
      published_by: options.identity ? { address: options.identity.address, name: options.identity.qdnName } : current.published_by,
      entries
    }
  };
}

export function removeOverlayEntry(overlay, sourceItemId, options = {}) {
  const current = overlay && overlay.schema === OVERLAY_SCHEMA ? overlay : emptyOverlay(options.siteId);
  const remoteRevision = Number(current.revision) || 0;
  const baseRevision = Math.max(0, Number(options.baseRevision) || 0);
  if (remoteRevision > baseRevision) {
    return {
      ok: false,
      conflict: true,
      message: 'Local edits changed on another device. Reload before resolving this conflict.',
      overlay: current
    };
  }
  return {
    ok: true,
    conflict: false,
    message: '',
    overlay: {
      ...current,
      revision: remoteRevision + 1,
      updated_at: new Date(options.now || Date.now()).toISOString(),
      entries: (current.entries || []).filter((entry) => String(entry.source_item_id) !== String(sourceItemId))
    }
  };
}

export function markOverlayConflict(overlay, sourceItemId, options = {}) {
  const current = overlay && overlay.schema === OVERLAY_SCHEMA ? overlay : emptyOverlay(options.siteId);
  const entries = (current.entries || []).map((entry) => (
    String(entry.source_item_id) === String(sourceItemId)
      ? {
          ...entry,
          conflict_state: options.conflict === false ? 'clean' : 'open',
          base_source_hash: options.baseSourceHash || entry.base_source_hash,
          base_source_modified_at: options.baseSourceModifiedAt || entry.base_source_modified_at,
          conflict_detected_at: options.conflict === false ? null : new Date(options.now || Date.now()).toISOString()
        }
      : entry
  ));
  return { ...current, entries };
}

/**
 * Merge overlay edits into the public catalog. Imported items keep their id,
 * legacy/source metadata and publication dates; only owner-editable fields and
 * the content reference are replaced. Slugs resolve through aliases so old
 * links keep working after an explicit slug change.
 */
export function mergeOverlayCatalog(dataset, overlay) {
  if (!dataset) return dataset;
  if (!overlay || !Array.isArray(overlay.entries) || overlay.entries.length === 0) {
    return { ...dataset, editOverlay: overlay || null };
  }
  const notices = [...(dataset.notices || [])];
  const posts = [...(dataset.posts || [])];
  const pages = [...(dataset.pages || [])];
  const byId = new Map([...posts, ...pages].map((item) => [String(item.id), item]));
  const bySource = new Map([...posts, ...pages].map((item) => [item.type + ':' + item.slug, item]));
  let applied = 0;
  let orphans = 0;

  for (const entry of overlay.entries) {
    if (!entry || !entry.source_item_id) continue;
    const original = byId.get(String(entry.source_item_id))
      || bySource.get((entry.source_type === 'page' ? 'page' : 'post') + ':' + String(entry.source_slug || ''));
    if (!original) {
      orphans += 1;
      continue;
    }
    const target = original.type === 'page' ? pages : posts;
    const index = target.findIndex((item) => String(item.id) === String(original.id));
    if (index < 0) continue;
    const edited = {
      ...target[index],
      title: String(entry.title || target[index].title),
      excerpt: String(entry.excerpt == null ? target[index].excerpt : entry.excerpt),
      categoryIds: Array.isArray(entry.category_ids) ? entry.category_ids.map(String) : target[index].categoryIds,
      tagIds: Array.isArray(entry.tag_ids) ? entry.tag_ids.map(String) : target[index].tagIds,
      contentRef: entry.content || target[index].contentRef,
      sourceContentRef: target[index].contentRef || null,
      contentHash: entry.content_hash || target[index].contentHash,
      featuredImageRef: entry.featured_image !== undefined ? normalizeFeaturedImage(entry.featured_image) : target[index].featuredImageRef,
      featuredImageUrl: entry.featured_image_url !== undefined ? entry.featured_image_url : target[index].featuredImageUrl,
      featuredImageAlt: entry.featured_image_alt !== undefined ? entry.featured_image_alt : target[index].featuredImageAlt,
      featuredImageSource: entry.featured_image_source !== undefined ? entry.featured_image_source : target[index].featuredImageSource,
      updatedAt: entry.edited_at || target[index].updatedAt,
      originalSlug: target[index].slug,
      slug: String(entry.slug || target[index].slug),
      slugAliases: Array.isArray(entry.slug_aliases) ? entry.slug_aliases.map(String) : [],
      edited: true,
      native: false,
      sourceKind: 'wordpress-overlay',
      overlay: {
        entryKey: String(entry.source_item_id),
        state: entry.state || 'published',
        conflictState: entry.conflict_state || 'clean',
        baseSourceHash: entry.base_source_hash || null,
        sourceAdapter: entry.source_adapter || 'wordpress',
        sourceId: entry.source_id == null ? null : entry.source_id,
        sourceOldUrl: entry.source_old_url || null
      }
    };
    target[index] = edited;
    applied += 1;
  }

  if (applied > 0) {
    notices.push({
      code: 'cms-local-edits-applied',
      level: 'info',
      message: applied + ' imported item(s) show owner-published local edits. The original WordPress-imported resources are unchanged.'
    });
  }
  if (orphans > 0) {
    notices.push({
      code: 'cms-local-edit-orphaned',
      level: 'warning',
      message: orphans + ' local edit(s) reference imported content that is no longer in the catalog. The edits are preserved in the edit overlay; review them in Admin before relying on those links.'
    });
  }

  const allPosts = posts;
  const categories = (dataset.categories || []).map((term) => ({
    ...term,
    count: allPosts.filter((item) => item.categoryIds.includes(term.id)).length
  }));
  const tags = (dataset.tags || []).map((term) => ({
    ...term,
    count: allPosts.filter((item) => item.tagIds.includes(term.id)).length
  }));

  return { ...dataset, posts, pages, categories, tags, notices, editOverlay: overlay };
}

/** Merge known upstream slugs into the alias index for collision checks. */
export function overlayTakenSlugs(overlay) {
  const set = new Set();
  for (const entry of (overlay && overlay.entries) || []) {
    if (entry.slug) set.add(String(entry.slug).toLowerCase());
    for (const alias of entry.slug_aliases || []) set.add(String(alias).toLowerCase());
  }
  return set;
}
