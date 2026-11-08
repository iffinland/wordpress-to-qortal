import {
  CONTENT_SCHEMA,
  CONTENT_VERSION,
  HASH_ALGORITHM,
  HTML_CANONICALIZATION,
  computeContentHash,
  contentId,
  normalizeTimestamp,
  sha256Value,
  stableStringify
} from '../../model/content.js';
import { decodeHtmlText, toPlainText, truncateText } from '../../../src/utils/text.js';
import { extractHtmlResources } from './extract.js';
import {
  CONTENT_POLICY_ID,
  CONTENT_POLICY_VERSION,
  applyContentOnlyPolicy,
  contentPolicyUnsupported,
  contentPolicyWarnings
} from './content-policy.js';

const ADAPTER_ID = 'wordpress';
const ADAPTER_VERSION = '1.0.1';

function baseDocument({ contentType, sourceKey, rawType, site, identity, title, status, dates, authors, terms, media, links, body, extra, warnings, unsupported }) {
  return {
    schema: CONTENT_SCHEMA,
    version: CONTENT_VERSION,
    id: contentId(ADAPTER_ID, contentType, sourceKey),
    source: {
      adapter: ADAPTER_ID,
      platform: 'wordpress',
      key: sourceKey,
      type: rawType,
      site,
      extra
    },
    content_type: contentType,
    identity,
    publication_status: status,
    title,
    body,
    dates,
    authors,
    terms,
    media,
    links,
    unsupported,
    warnings,
    provenance: {
      adapter_id: ADAPTER_ID,
      adapter_version: ADAPTER_VERSION,
      contract_version: 1,
      html_canonicalization: HTML_CANONICALIZATION,
      hash_algorithm: HASH_ALGORITHM,
      fetched_at: new Date().toISOString(),
      raw_hash: null
    },
    content_hash: null
  };
}

function normalizeMediaEntry(entry, fallbackRole = null) {
  if (!entry || entry.resolved_url === null) {
    return null;
  }
  return {
    key: entry.key ?? null,
    source_id: entry.source_id === null || entry.source_id === undefined ? null : String(entry.source_id),
    url: entry.url ?? entry.resolved_url ?? null,
    resolved_url: entry.resolved_url ?? entry.url ?? null,
    role: entry.role ?? fallbackRole,
    mime_type: entry.mime_type ?? null,
    title: entry.title ?? null,
    alt: entry.alt ?? null,
    width: Number.isFinite(entry.width) ? entry.width : null,
    height: Number.isFinite(entry.height) ? entry.height : null,
    lazy: Boolean(entry.lazy),
    external: Boolean(entry.external),
    srcset: Array.isArray(entry.srcset) ? entry.srcset : []
  };
}

function termSummary(taxonomy, id, lookup) {
  const key = `${taxonomy}:${id}`;
  const known = lookup?.get(key);
  if (known) {
    return {
      key,
      source_id: String(id),
      slug: known.slug ?? null,
      name: known.name ?? null
    };
  }
  return { key, source_id: String(id), slug: null, name: null, missing: true };
}

function mediaSummary(raw, role = 'attachment') {
  if (!raw) return null;
  const url = raw.source_url ?? null;
  return normalizeMediaEntry({
    key: `media:${raw.id}`,
    source_id: raw.id,
    url,
    resolved_url: url,
    role,
    mime_type: raw.mime_type ?? null,
    title: raw.title?.rendered ? decodeHtmlText(raw.title.rendered) : raw.title?.raw ?? null,
    alt: raw.alt_text ?? null,
    width: raw.media_details?.width ?? null,
    height: raw.media_details?.height ?? null
  }, role);
}

/**
 * Decide whether a WordPress media-library attachment is actually used by the
 * rendered content. WordPress returns every child attachment of a post, which
 * on attachment-heavy sites can be hundreds of media-library items that the
 * article never displays or links. Downloading them all used to blow up the
 * media dependency graph (and the per-run file cap) for a single post.
 *
 * The rule is deliberately conservative: an attachment stays required when the
 * rendered body or excerpt references its URL, its upload path, its file stem
 * (including WordPress -WxH / -scaled variants), or its wp-image-<id> class.
 * Anything else is preserved as metadata for the source record but is not a
 * required dependency.
 */
function attachmentStem(url) {
  const value = String(url ?? '').split(/[?#]/)[0];
  const file = value.split('/').pop() ?? '';
  return file
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/-\d+x\d+$/i, '')
    .replace(/-scaled$/i, '')
    .replace(/-rotated$/i, '');
}

export function isAttachmentReferenced(raw, html, excerptHtml = '') {
  if (!raw) return false;
  const haystack = String(html ?? '') + '\n' + String(excerptHtml ?? '');
  if (haystack.trim() === '') return false;
  const url = raw.source_url ?? raw.url ?? null;
  if (url) {
    const path = String(url).replace(/^https?:\/\/[^/]+/i, '');
    if (haystack.includes(String(url))) return true;
    if (path && path !== '/' && haystack.includes(path)) return true;
    const stem = attachmentStem(url);
    if (stem.length >= 4) {
      const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp('(?:^|[^a-z0-9-])' + escaped + '(?:-\\d+x\\d+|-scaled)?\\.[a-z0-9]{2,5}', 'i').test(haystack)) {
        return true;
      }
    }
  }
  const id = Number(raw.id);
  if (Number.isInteger(id) && id > 0) {
    if (new RegExp('wp-image-' + id + '(?!\\d)').test(haystack)) return true;
    if (new RegExp('attachment_' + id + '(?!\\d)').test(haystack)) return true;
    if (haystack.includes('attachment_id=' + id)) return true;
  }
  return false;
}

function normalizeRawTimestamp(utcValue, fallbackValue) {
  return normalizeTimestamp(utcValue) ?? normalizeTimestamp(fallbackValue);
}

export function normalizePostOrPage({ contentType, raw, site, featuredMedia = null, attachments = [], termLookup = null }) {
  if (!raw || typeof raw !== 'object' || !Number.isInteger(Number(raw.id))) {
    const error = new Error('WordPress content item is missing a numeric id.');
    error.code = 'SOURCE_INVALID_RESPONSE';
    throw error;
  }
  const warnings = [];
  const unsupported = [];
  const id = Number(raw.id);
  const key = `${contentType}:${id}`;
  // Strip unsupported plugin functionality before hashing and extraction.
  // The policy is content-only: it keeps editorial text, links and supported
  // media and never persists removed values (including form tokens).
  const bodyPolicy = applyContentOnlyPolicy(raw.content?.rendered ?? '');
  const excerptPolicy = applyContentOnlyPolicy(raw.excerpt?.rendered ?? '');
  const html = bodyPolicy.html;
  const excerptHtml = excerptPolicy.html;
  const extracted = extractHtmlResources(html, site);
  const categories = Array.isArray(raw.categories)
    ? raw.categories.map((termId) => termSummary('category', termId, termLookup))
    : [];
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((termId) => termSummary('tag', termId, termLookup))
    : [];
  for (const term of [...categories, ...tags]) {
    if (term.missing) {
      warnings.push({
        code: 'TERM_NOT_FOUND',
        message: `Taxonomy term ${term.key} was not available during normalization.`,
        details: { key: term.key }
      });
    }
  }

  const featured = mediaSummary(featuredMedia, 'featured');
  if (raw.featured_media && !featured) {
    warnings.push({
      code: 'FEATURED_MEDIA_UNAVAILABLE',
      message: `Featured media ${raw.featured_media} could not be retrieved.`,
      details: { mediaId: raw.featured_media }
    });
  }
  const attachmentEntries = [];
  const unreferencedAttachmentEntries = [];
  for (const item of attachments) {
    const summary = mediaSummary(item, 'attachment');
    if (!summary) continue;
    if (isAttachmentReferenced(item, html, excerptHtml)) attachmentEntries.push(summary);
    else unreferencedAttachmentEntries.push(summary);
  }
  const title = decodeHtmlText(raw.title?.rendered ?? raw.title?.raw ?? '');
  const text = toPlainText(html);
  const excerptText = toPlainText(excerptHtml);

  warnings.push(...contentPolicyWarnings(key, bodyPolicy, 'body.html'));
  warnings.push(...contentPolicyWarnings(key, excerptPolicy, 'excerpt_html'));
  unsupported.push(...contentPolicyUnsupported(key, bodyPolicy, 'body.html'));
  unsupported.push(...contentPolicyUnsupported(key, excerptPolicy, 'excerpt_html'));

  if (!title) {
    warnings.push({ code: 'EMPTY_TITLE', message: 'Source item has no title.', details: {} });
  }
  if (!html) {
    warnings.push({ code: 'EMPTY_BODY', message: 'Source item has no rendered body.', details: {} });
  }
  if (raw.format && raw.format !== 'standard') {
    unsupported.push({
      code: 'POST_FORMAT_PRESERVED_AS_HTML',
      message: `Post format "${raw.format}" has no dedicated common-model field; rendered HTML is preserved.`,
      fields: ['format']
    });
  }

  const media = {
    featured,
    images: extracted.images.map((entry) => normalizeMediaEntry(entry, 'inline')).filter(Boolean),
    audio: extracted.audio.map((entry) => normalizeMediaEntry(entry, 'inline')).filter(Boolean),
    video: extracted.video.map((entry) => normalizeMediaEntry(entry, 'inline')).filter(Boolean),
    documents: extracted.documents.map((entry) => normalizeMediaEntry(entry, 'linked')).filter(Boolean),
    embeds: extracted.embeds.map((entry) => normalizeMediaEntry(entry, 'embed')).filter(Boolean),
    attachments: attachmentEntries,
    // Provenance only. Not required dependencies unless the user opts in.
    unreferenced_attachments: unreferencedAttachmentEntries
  };
  if (featured) {
    media.images.push(featured);
  }

  const document = baseDocument({
    contentType,
    sourceKey: key,
    rawType: contentType,
    site,
    identity: {
      source_id: String(id),
      slug: raw.slug ?? null,
      old_url: raw.link ?? null,
      canonical_url: raw.link ?? null,
      parent_key: contentType === 'page' && raw.parent ? `page:${raw.parent}` : null,
      menu_order: contentType === 'page' ? (raw.menu_order ?? 0) : null
    },
    title,
    status: raw.status ?? 'unknown',
    dates: {
      created_at: normalizeRawTimestamp(raw.date_gmt, raw.date),
      modified_at: normalizeRawTimestamp(raw.modified_gmt, raw.modified),
      published_at: normalizeRawTimestamp(raw.date_gmt, raw.date)
    },
    authors: Number.isInteger(Number(raw.author))
      ? [{ role: 'source', name: null, source_id: String(raw.author) }]
      : [],
    terms: { categories, tags },
    media,
    links: extracted.links,
    body: {
      format: 'html',
      html,
      text,
      excerpt_html: excerptHtml,
      excerpt_text: excerptText,
      summary: truncateText(excerptText || text, 240),
      hash: sha256Value({ format: 'html', canonicalization: HTML_CANONICALIZATION, html })
    },
    extra: {
      wordpress: {
        id,
        type: contentType,
        author: raw.author ?? null,
        featured_media: raw.featured_media ?? 0,
        format: raw.format ?? null,
        sticky: Boolean(raw.sticky),
        template: raw.template ?? null,
        parent: raw.parent ?? 0,
        menu_order: raw.menu_order ?? 0,
        categories_raw: Array.isArray(raw.categories) ? raw.categories : [],
        tags_raw: Array.isArray(raw.tags) ? raw.tags : [],
        guid: raw.guid?.rendered ?? null,
        content_policy: {
          id: CONTENT_POLICY_ID,
          version: CONTENT_POLICY_VERSION,
          body_changed: bodyPolicy.changed,
          excerpt_changed: excerptPolicy.changed,
          removed: bodyPolicy.removed,
          excerpt_removed: excerptPolicy.removed
        },
        date: raw.date ?? null,
        modified: raw.modified ?? null,
        date_gmt: raw.date_gmt ?? null,
        modified_gmt: raw.modified_gmt ?? null,
        legacy_html_inspection: extracted.legacy,
        legacy_attachments: attachments.map((item) => ({
          source_id: item.id,
          source_url: item.source_url || null,
          media_type: item.media_type || null,
          mime_type: item.mime_type || null,
          title: item.title?.rendered || ''
        })),
        attachment_policy: {
          referenced: attachmentEntries.length,
          unreferenced: unreferencedAttachmentEntries.length,
          note: 'Unreferenced media-library attachments stay in source metadata and are not downloaded by default.'
        },
        links: raw._links ?? null
      }
    },
    warnings,
    unsupported
  });

  document.provenance.raw_hash = sha256Value(raw);
  document.content_hash = computeContentHash(document, { baseUrl: site });
  return document;
}

export function normalizeTerm({ taxonomy, raw, site }) {
  if (!raw || typeof raw !== 'object' || !Number.isInteger(Number(raw.id))) {
    const error = new Error('WordPress term is missing a numeric id.');
    error.code = 'SOURCE_INVALID_RESPONSE';
    throw error;
  }
  const id = Number(raw.id);
  const contentType = taxonomy === 'category' ? 'category' : taxonomy === 'tag' ? 'tag' : taxonomy;
  const key = `${taxonomy}:${id}`;
  const title = decodeHtmlText(raw.name ?? '');
  const html = raw.description ?? '';
  const document = baseDocument({
    contentType,
    sourceKey: key,
    rawType: taxonomy,
    site,
    identity: {
      source_id: String(id),
      slug: raw.slug ?? null,
      old_url: raw.link ?? null,
      canonical_url: raw.link ?? null,
      parent_key: raw.parent ? `category:${raw.parent}` : null,
      menu_order: null
    },
    title,
    status: 'publish',
    dates: { created_at: null, modified_at: null, published_at: null },
    authors: [],
    terms: { categories: [], tags: [] },
    media: { featured: null, images: [], audio: [], video: [], documents: [], embeds: [], attachments: [] },
    links: { internal: [], external: [], external_media: [] },
    body: {
      format: 'html',
      html,
      text: toPlainText(html),
      excerpt_html: '',
      excerpt_text: '',
      summary: truncateText(toPlainText(html), 240),
      hash: sha256Value({ format: 'html', canonicalization: HTML_CANONICALIZATION, html })
    },
    extra: {
      wordpress: {
        id,
        taxonomy: raw.taxonomy ?? taxonomy,
        parent: raw.parent ?? 0,
        count: raw.count ?? 0,
        description: raw.description ?? ''
      }
    },
    warnings: [],
    unsupported: []
  });
  document.provenance.raw_hash = sha256Value(raw);
  document.content_hash = computeContentHash(document, { baseUrl: site });
  return document;
}

export function normalizeMedia({ raw, site }) {
  if (!raw || typeof raw !== 'object' || !Number.isInteger(Number(raw.id))) {
    const error = new Error('WordPress media item is missing a numeric id.');
    error.code = 'SOURCE_INVALID_RESPONSE';
    throw error;
  }
  const id = Number(raw.id);
  const key = `media:${id}`;
  const title = decodeHtmlText(raw.title?.rendered ?? raw.title?.raw ?? '') || raw.slug || `Media ${id}`;
  const entry = mediaSummary(raw, 'library');
  const bodyPolicy = applyContentOnlyPolicy(raw.description?.rendered ?? '');
  const captionPolicy = applyContentOnlyPolicy(raw.caption?.rendered ?? '');
  const document = baseDocument({
    contentType: 'media',
    sourceKey: key,
    rawType: 'media',
    site,
    identity: {
      source_id: String(id),
      slug: raw.slug ?? null,
      old_url: raw.link ?? null,
      canonical_url: raw.source_url ?? null,
      parent_key: raw.post ? `post:${raw.post}` : null,
      menu_order: null
    },
    title,
    status: raw.status ?? 'inherit',
    dates: {
      created_at: normalizeRawTimestamp(raw.date_gmt, raw.date),
      modified_at: normalizeRawTimestamp(raw.modified_gmt, raw.modified),
      published_at: normalizeRawTimestamp(raw.date_gmt, raw.date)
    },
    authors: [],
    terms: { categories: [], tags: [] },
    media: entry
      ? { featured: null, images: entry.mime_type?.startsWith('image/') ? [entry] : [], audio: entry.mime_type?.startsWith('audio/') ? [entry] : [], video: entry.mime_type?.startsWith('video/') ? [entry] : [], documents: entry.mime_type === 'application/pdf' ? [entry] : [], embeds: [], attachments: [entry] }
      : { featured: null, images: [], audio: [], video: [], documents: [], embeds: [], attachments: [] },
    links: { internal: [], external: [], external_media: [] },
    body: {
      format: 'html',
      html: bodyPolicy.html,
      text: toPlainText(bodyPolicy.html),
      excerpt_html: captionPolicy.html,
      excerpt_text: toPlainText(captionPolicy.html),
      summary: truncateText(toPlainText(captionPolicy.html), 240),
      hash: sha256Value({ format: 'html', canonicalization: HTML_CANONICALIZATION, html: bodyPolicy.html })
    },
    extra: {
      wordpress: {
        id,
        media_type: raw.media_type ?? null,
        mime_type: raw.mime_type ?? null,
        source_url: raw.source_url ?? null,
        alt_text: raw.alt_text ?? null,
        caption: raw.caption?.rendered ?? null,
        description: raw.description?.rendered ?? null,
        post: raw.post ?? 0,
        status: raw.status ?? null,
        date: raw.date ?? null,
        modified: raw.modified ?? null,
        media_details: raw.media_details ?? null,
        content_policy: {
          id: CONTENT_POLICY_ID,
          version: CONTENT_POLICY_VERSION,
          body_changed: bodyPolicy.changed,
          excerpt_changed: captionPolicy.changed,
          removed: bodyPolicy.removed,
          excerpt_removed: captionPolicy.removed
        }
      }
    },
    warnings: [
      ...(entry ? [] : [{ code: 'MEDIA_WITHOUT_URL', message: 'Media item has no source URL.', details: { mediaId: id } }]),
      ...contentPolicyWarnings(key, bodyPolicy, 'body.html'),
      ...contentPolicyWarnings(key, captionPolicy, 'excerpt_html')
    ],
    unsupported: contentPolicyUnsupported(key, bodyPolicy, 'body.html')
  });
  document.provenance.raw_hash = sha256Value(raw);
  document.content_hash = computeContentHash(document, { baseUrl: site });
  return document;
}

export { ADAPTER_ID, ADAPTER_VERSION, stableStringify };
