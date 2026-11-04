import { rewriteInternalLinks } from '../../src/utils/html.js';
import {
  createMediaMap,
  createPageIndexItem,
  createPostIndexItem,
  createUrlMap
} from '../../src/convert.js';
import { loadProfile } from '../../src/profile.js';

/**
 * Read-only Corbett compatibility view over qms-content@1.
 *
 * The legacy CLI, output files, route rewriting and cr-* identifiers remain the
 * supported Corbett workflow. This module lets a future engine operation render
 * the same legacy-shaped records without rewriting or replacing the legacy
 * pipeline.
 */
export const LEGACY_CORBETT_VIEW = 'qms-legacy-corbett-view@1';

function legacyTimestamp(utcValue, fallbackValue) {
  if (utcValue) {
    return /(?:z|[+-]\d\d:\d\d)$/i.test(utcValue) ? utcValue : `${utcValue}Z`;
  }
  return fallbackValue || null;
}

function legacyMedia(document) {
  const legacy = document.source?.extra?.wordpress?.legacy_html_inspection;
  return {
    images: legacy?.images ?? (document.media?.images ?? []).map((entry) => entry.resolved_url ?? entry.url),
    audio: legacy?.audio ?? (document.media?.audio ?? []).map((entry) => entry.resolved_url ?? entry.url),
    video: legacy?.video ?? (document.media?.video ?? []).map((entry) => entry.resolved_url ?? entry.url),
    documents: legacy?.documents ?? (document.media?.documents ?? []).map((entry) => entry.resolved_url ?? entry.url),
    embeds: legacy?.embeds ?? (document.media?.embeds ?? []).map((entry) => entry.resolved_url ?? entry.url)
  };
}

function legacyLinks(document) {
  const legacy = document.source?.extra?.wordpress?.legacy_html_inspection;
  return {
    internal: legacy?.links?.internal ?? document.links?.internal ?? [],
    external: legacy?.links?.external ?? document.links?.external ?? []
  };
}

export function toLegacyContent(document, {
  publicAuthorName = 'Site Author',
  importerVersion = '0.1.5',
  importedAt = null
} = {}) {
  const wp = document.source?.extra?.wordpress ?? {};
  const imported_at = importedAt ?? new Date().toISOString();
  if (document.content_type === 'post' || document.content_type === 'page') {
    const base = {
      type: document.content_type,
      source: 'wordpress',
      source_id: Number(document.identity.source_id),
      old_url: document.identity.old_url ?? null,
      public_author: publicAuthorName,
      slug: document.identity.slug ?? null,
      title: document.title,
      date: wp.date ?? null,
      published_at: legacyTimestamp(wp.date_gmt, wp.date),
      modified: wp.modified ?? null,
      modified_at: legacyTimestamp(wp.modified_gmt, wp.modified),
      status: document.publication_status ?? null,
      excerpt: document.body.excerpt_html ?? '',
      excerpt_text: document.body.excerpt_text ?? '',
      content_html: document.body.html ?? '',
      content_text: document.body.text ?? '',
      summary: document.body.summary ?? '',
      categories: wp.categories_raw ?? (document.terms.categories ?? []).map((term) => Number(term.source_id)),
      tags: wp.tags_raw ?? (document.terms.tags ?? []).map((term) => Number(term.source_id)),
      featured_media: wp.featured_media || null,
      attachments: document.content_type === 'page' ? [] : (wp.legacy_attachments ?? (document.media.attachments ?? []).map((entry) => ({
        source_id: Number(entry.source_id),
        source_url: entry.resolved_url ?? null,
        media_type: null,
        mime_type: entry.mime_type ?? null,
        title: entry.title ?? ''
      }))),
      links: legacyLinks(document),
      media: legacyMedia(document),
      import: {
        imported_at,
        importer_version: importerVersion
      }
    };
    if (document.content_type === 'page') {
      // convertPage does not emit categories/tags; preserve that exact shape.
      delete base.categories;
      delete base.tags;
      base.parent = Number(wp.parent ?? 0);
      base.menu_order = Number(wp.menu_order ?? 0);
    }
    return base;
  }
  if (document.content_type === 'category' || document.content_type === 'tag') {
    return {
      type: document.content_type,
      source: 'wordpress',
      source_id: Number(document.identity.source_id),
      old_url: document.identity.old_url ?? null,
      slug: document.identity.slug ?? null,
      name: document.title,
      description: document.body.html ?? '',
      count: Number(wp.count ?? 0),
      parent: Number(wp.parent ?? 0),
      taxonomy: wp.taxonomy ?? (document.content_type === 'category' ? 'category' : 'post_tag')
    };
  }
  if (document.content_type === 'media') {
    return {
      type: 'media',
      source: 'wordpress',
      source_id: Number(document.identity.source_id),
      old_url: document.identity.old_url ?? null,
      source_url: wp.source_url ?? null,
      slug: document.identity.slug ?? null,
      title: document.title,
      date: wp.date ?? null,
      modified: wp.modified ?? null,
      status: wp.status ?? null,
      media_type: wp.media_type ?? null,
      mime_type: wp.mime_type ?? null
    };
  }
  return null;
}

/** Legacy index item shapes, reusing the real legacy functions. */
export function toLegacyIndexItem(document, options = {}) {
  const legacy = toLegacyContent(document, options);
  if (!legacy) return null;
  if (legacy.type === 'post') return createPostIndexItem(legacy);
  if (legacy.type === 'page') return createPageIndexItem(legacy);
  return null;
}

/** Build the legacy URL map from legacy-shaped records. */
export function createLegacyUrlMap(input) {
  return createUrlMap(input);
}

export function createLegacyMediaMap(posts, pages, mediaItems) {
  return createMediaMap(posts, pages, mediaItems);
}

/** Apply the unchanged Corbett route-rewriting rule to normalized HTML. */
export function rewriteLegacyContentHtml(document, wordpressBaseUrl, urlMap) {
  return rewriteInternalLinks(document.body?.html ?? '', wordpressBaseUrl, urlMap);
}

/** Profile compatibility evidence used by tests and future migration planning. */
export function corbettCompatibilityRecord({ repoRoot = process.cwd() } = {}) {
  const profile = loadProfile('corbettreport', { baseDir: repoRoot });
  return {
    view: LEGACY_CORBETT_VIEW,
    profileId: profile.id,
    resourcePrefix: profile.resourcePrefix,
    qdnIdentifiers: profile.qdnIdentifiers,
    publicAuthorName: profile.publicAuthorName
  };
}

export { legacyTimestamp };
