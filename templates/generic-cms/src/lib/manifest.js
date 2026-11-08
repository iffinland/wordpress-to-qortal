export const QMS_CMS_MANIFEST_SCHEMA = 'qms-cms-manifest@1';
export const QMS_QDN_MANIFEST_SCHEMA = 'qms-qdn-manifest@1';
export const LEGACY_CMS_MANIFEST = 'cr-qdn-manifest';
export const QMS_CMS_INDEX_SCHEMA = 'qms-cms-index@1';

const DEFAULT_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const CONTENT_SERVICE = 'DOCUMENT';

export class CatalogError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CatalogError';
    this.code = code;
  }
}

function stringValue(value) {
  return typeof value === 'string' ? value : '';
}

function normalizeName(value) {
  return stringValue(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

function isoTime(value) {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function isRef(value) {
  return Boolean(value && typeof value === 'object' && typeof value.service === 'string' && typeof value.identifier === 'string');
}

function copyRef(value, fallbackName) {
  if (!isRef(value)) return null;
  const ref = { service: value.service, identifier: value.identifier };
  if (value.name) ref.name = value.name;
  else if (fallbackName) ref.name = fallbackName;
  return ref;
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function statusValue(value) {
  const status = String(value || '').toLowerCase();
  if (status === 'publish' || status === 'published') return 'published';
  if (status === 'draft') return 'draft';
  if (status === 'private') return 'private';
  if (status === 'trash' || status === 'trashed') return 'trashed';
  if (status === 'archived') return 'archived';
  if (status === 'hidden') return 'hidden';
  return status || 'unknown';
}

export function detectManifestKind(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new CatalogError('manifest-invalid', 'The QDN catalog manifest is not a JSON object.');
  }
  if (raw.schema === QMS_CMS_MANIFEST_SCHEMA) return 'qms-cms';
  if (raw.schema === QMS_QDN_MANIFEST_SCHEMA) return 'qms-qdn';
  if (raw.profile_id || raw.identifiers || (raw.entrypoints && raw.entrypoints.posts_index)) return 'cr-qdn';
  throw new CatalogError(
    'manifest-unsupported',
    'Unsupported QDN catalog manifest. Expected qms-cms-manifest@1, qms-qdn-manifest@1 or cr-qdn-manifest.'
  );
}

function assertSupportedVersion(raw, kind) {
  const version = numeric(raw.version);
  if (version !== null && version > 1 && kind !== 'cr-qdn') {
    throw new CatalogError(
      'manifest-version-unsupported',
      'This catalog uses manifest version ' + version + ', which requires a newer QMS CMS template.'
    );
  }
}

export function normalizeManifest(raw, options = {}) {
  const kind = detectManifestKind(raw);
  assertSupportedVersion(raw, kind);
  const siteDefaults = options.siteDefaults || {};
  const resources = raw.resources && typeof raw.resources === 'object' ? raw.resources : {};
  const byPath = resources.by_path && typeof resources.by_path === 'object' ? resources.by_path : {};
  const byIdentifier = resources.by_identifier && typeof resources.by_identifier === 'object' ? resources.by_identifier : {};
  const bySourceUrl = resources.by_source_url && typeof resources.by_source_url === 'object' ? resources.by_source_url : {};

  if (kind === 'qms-cms') {
    const site = raw.site && typeof raw.site === 'object' ? raw.site : {};
    const entrypoints = raw.entrypoints && typeof raw.entrypoints === 'object' ? raw.entrypoints : {};
    return {
      kind,
      schema: raw.schema,
      version: numeric(raw.version),
      generatedAt: isoTime(raw.generated_at),
      legacy: false,
      raw,
      site: {
        id: stringValue(site.id) || stringValue(siteDefaults.id) || 'site',
        title: stringValue(site.title) || stringValue(siteDefaults.title) || 'Qortal Site',
        tagline: stringValue(site.tagline) || stringValue(siteDefaults.tagline) || '',
        description: stringValue(site.description) || stringValue(siteDefaults.description) || '',
        ownerName: stringValue(site.owner_name) || stringValue(site.ownerName) || stringValue(siteDefaults.ownerName) || '',
        publicAuthor: stringValue(site.public_author) || stringValue(site.publicAuthor) || stringValue(siteDefaults.publicAuthor) || ''
      },
      entrypoints: {
        posts: copyRef(entrypoints.posts),
        pages: copyRef(entrypoints.pages),
        categories: copyRef(entrypoints.categories),
        tags: copyRef(entrypoints.tags),
        media: copyRef(entrypoints.media),
        search: copyRef(entrypoints.search),
        urlMap: copyRef(entrypoints.url_map)
      },
      resources: { byPath, byIdentifier, bySourceUrl },
      counts: {
        posts: numeric(raw.counts && raw.counts.posts),
        pages: numeric(raw.counts && raw.counts.pages),
        categories: numeric(raw.counts && raw.counts.categories),
        tags: numeric(raw.counts && raw.counts.tags)
      }
    };
  }

  if (kind === 'qms-qdn') {
    const entrypoints = raw.entrypoints && typeof raw.entrypoints === 'object' ? raw.entrypoints : {};
    const target = stringValue(raw.target) || stringValue(raw.target && raw.target.qdnName);
    const fromIdentifier = (identifier) => {
      if (!identifier) return null;
      const ref = byIdentifier[identifier];
      return copyRef(ref, target) || (identifier ? { service: CONTENT_SERVICE, name: target || undefined, identifier } : null);
    };
    return {
      kind,
      schema: raw.schema,
      version: numeric(raw.version),
      generatedAt: isoTime(raw.generated_at),
      legacy: false,
      raw,
      site: {
        id: stringValue(raw.site_id) || stringValue(siteDefaults.id) || 'site',
        title: stringValue(siteDefaults.title) || target || 'Qortal Site',
        tagline: stringValue(siteDefaults.tagline) || '',
        description: stringValue(siteDefaults.description) || '',
        ownerName: target || stringValue(siteDefaults.ownerName) || '',
        publicAuthor: stringValue(siteDefaults.publicAuthor) || ''
      },
      entrypoints: {
        posts: fromIdentifier(entrypoints.posts),
        pages: fromIdentifier(entrypoints.pages),
        categories: fromIdentifier(entrypoints.categories),
        tags: fromIdentifier(entrypoints.tags),
        media: fromIdentifier(entrypoints.media_map),
        search: fromIdentifier(entrypoints.search),
        urlMap: fromIdentifier(entrypoints.url_map)
      },
      resources: { byPath, byIdentifier, bySourceUrl },
      counts: {
        posts: numeric(raw.summary && raw.summary.posts),
        pages: numeric(raw.summary && raw.summary.pages),
        categories: numeric(raw.summary && raw.summary.categories),
        tags: numeric(raw.summary && raw.summary.tags)
      }
    };
  }

  const entrypoints = raw.entrypoints && typeof raw.entrypoints === 'object' ? raw.entrypoints : {};
  const ownerName = stringValue(raw.canonical_site_name) || stringValue(raw.qdn_name) || stringValue(siteDefaults.ownerName) || '';
  return {
    kind,
    schema: LEGACY_CMS_MANIFEST,
    version: numeric(raw.version),
    generatedAt: isoTime(raw.generated_at),
    legacy: true,
    raw,
    site: {
      id: stringValue(siteDefaults.id) || ('legacy:' + normalizeName(ownerName || 'site')),
      title: stringValue(siteDefaults.title) || stringValue(raw.site_title) || ownerName || 'Qortal Site',
      tagline: stringValue(siteDefaults.tagline) || stringValue(raw.tagline) || '',
      description: stringValue(siteDefaults.description) || '',
      ownerName,
      publicAuthor: stringValue(raw.public_author) || stringValue(siteDefaults.publicAuthor) || ''
    },
    entrypoints: {
      posts: copyRef(entrypoints.posts_index, raw.qdn_content_name || ownerName),
      pages: copyRef(entrypoints.pages_index, raw.qdn_content_name || ownerName),
      categories: copyRef(entrypoints.categories, raw.qdn_content_name || ownerName),
      tags: copyRef(entrypoints.tags, raw.qdn_content_name || ownerName),
      media: copyRef(entrypoints.media_map, raw.qdn_content_name || ownerName),
      search: copyRef(entrypoints.search_index, raw.qdn_content_name || ownerName),
      urlMap: copyRef(entrypoints.url_map, raw.qdn_content_name || ownerName)
    },
    resources: { byPath, byIdentifier, bySourceUrl },
    counts: {
      posts: numeric(raw.summary && raw.summary.posts),
      pages: numeric(raw.summary && raw.summary.pages),
      categories: null,
      tags: null
    }
  };
}

function normalizeTerm(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = stringValue(entry.id) || stringValue(entry.key) || stringValue(entry.source_id) || stringValue(entry.slug) || stringValue(entry.name);
  const name = stringValue(entry.name) || stringValue(entry.title) || id;
  const slug = stringValue(entry.slug) || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id || !name) return null;
  return { id, name, slug, count: numeric(entry.count) };
}

function normalizeIndexEntry(entry, kind, manifest) {
  if (!entry || typeof entry !== 'object') return null;
  if (manifest.kind === 'cr-qdn') {
    const sourceId = numeric(entry.source_id);
    const type = entry.type === 'page' ? 'page' : 'post';
    const file = stringValue(entry.file);
    const contentRef = (file && copyRef(manifest.resources.byPath['converted/' + file], manifest.site.ownerName))
      || (file ? { service: CONTENT_SERVICE, name: manifest.site.ownerName || undefined, identifier: file } : null);
    return {
      id: sourceId !== null ? 'wp-' + sourceId : 'wp-' + (stringValue(entry.slug) || kind),
      type,
      title: stringValue(entry.title) || stringValue(entry.slug),
      slug: stringValue(entry.slug),
      status: statusValue(entry.status),
      excerpt: stringValue(entry.summary) || stringValue(entry.excerpt_text) || '',
      categoryIds: Array.isArray(entry.categories) ? entry.categories.map(String) : [],
      tagIds: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
      createdAt: isoTime(entry.date),
      updatedAt: isoTime(entry.modified_at) || isoTime(entry.modified),
      publishedAt: isoTime(entry.published_at) || isoTime(entry.date),
      contentRef,
      featuredImageRef: null,
      featuredImageUrl: null,
      featuredImageAlt: null,
      featuredImageSource: null,
      contentHash: null,
      legacy: {
        sourceId,
        oldUrl: stringValue(entry.old_url) || null,
        file: file || null,
        publicAuthor: stringValue(entry.public_author) || null
      }
    };
  }

  const contentRef = copyRef(entry.content || entry.qdn || entry.resource, manifest.site.ownerName);
  const type = entry.type === 'page' || entry.contentType === 'page' ? 'page' : 'post';
  return {
    id: stringValue(entry.id) || type + '-' + (stringValue(entry.slug) || 'item'),
    type,
    title: stringValue(entry.title) || stringValue(entry.slug),
    slug: stringValue(entry.slug),
    status: statusValue(entry.status || 'published'),
    excerpt: stringValue(entry.excerpt) || '',
    categoryIds: Array.isArray(entry.category_ids) ? entry.category_ids.map(String) : [],
    tagIds: Array.isArray(entry.tag_ids) ? entry.tag_ids.map(String) : [],
    createdAt: isoTime(entry.created_at) || isoTime(entry.createdAt),
    updatedAt: isoTime(entry.updated_at) || isoTime(entry.updatedAt),
    publishedAt: isoTime(entry.published_at) || isoTime(entry.publishedAt) || isoTime(entry.created_at),
    contentRef,
    featuredImageRef: copyRef(entry.featured_image, manifest.site.ownerName),
    featuredImageUrl: stringValue(entry.featured_image_url) || null,
    featuredImageAlt: stringValue(entry.featured_image_alt) || null,
    featuredImageSource: stringValue(entry.featured_image_source) || null,
    contentHash: stringValue(entry.content_hash) || stringValue(entry.contentHash) || null,
    legacy: null
  };
}

function readEntries(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.entries)) return payload.entries;
  return null;
}

export function normalizeIndexPayload(payload, kind, manifest) {
  const entries = readEntries(payload);
  if (entries === null) {
    throw new CatalogError('index-invalid', 'The ' + kind + ' index is not an array or an entries payload.');
  }
  return entries
    .map((entry) => normalizeIndexEntry(entry, kind, manifest))
    .filter(Boolean);
}

export function normalizeTermsPayload(payload) {
  const entries = readEntries(payload);
  if (entries === null) {
    throw new CatalogError('index-invalid', 'The taxonomy index is not an array or an entries payload.');
  }
  return entries.map(normalizeTerm).filter(Boolean);
}

export function normalizeMediaPayload(payload) {
  if (Array.isArray(payload)) {
    return payload.filter((entry) => entry && typeof entry === 'object').map((entry) => {
      const url = stringValue(entry.sourceUrl) || stringValue(entry.source_url) || stringValue(entry.url);
      return { url, qdn: copyRef(entry.qdn), role: stringValue(entry.role) || undefined, alt: entry.alt == null ? null : String(entry.alt) };
    }).filter((entry) => entry.url || entry.qdn);
  }
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.entries)) return normalizeMediaPayload(payload.entries);
    const entries = payload.entries && typeof payload.entries === 'object' ? payload.entries : payload;
    return Object.entries(entries).map(([url, value]) => {
      if (!value || typeof value !== 'object') return null;
      const ref = copyRef(value.qdn || value);
      return { url, qdn: ref, role: undefined, alt: null };
    }).filter(Boolean);
  }
  return [];
}

function notice(code, level, message) {
  return { code, level, message };
}

function errorFrom(error) {
  if (error instanceof CatalogError) return error;
  return new CatalogError('catalog-read-failed', error && error.message ? error.message : String(error));
}

async function readIndex(manifest, key, fetchRef) {
  const ref = manifest.entrypoints[key];
  if (!ref) {
    return { ok: false, payload: null, error: new CatalogError('entrypoint-missing', 'The ' + key + ' entrypoint is not declared in the manifest.') };
  }
  try {
    return { ok: true, payload: await fetchRef(ref), error: null };
  } catch (error) {
    return { ok: false, payload: null, error: errorFrom(error) };
  }
}

function siteFrom(manifest, fallback = {}) {
  return {
    id: manifest.site.id,
    title: fallback.title || manifest.site.title,
    tagline: fallback.tagline || manifest.site.tagline,
    description: fallback.description || manifest.site.description,
    ownerName: manifest.site.ownerName,
    publicAuthor: manifest.site.publicAuthor
  };
}

export function createErrorDataset(options = {}) {
  const now = options.now == null ? Date.now() : options.now;
  const site = options.site || {};
  const message = options.message || 'The QDN catalog is unavailable.';
  const notices = options.notices || [notice('catalog-unavailable', 'error', message)];
  return {
    state: 'error',
    source: options.source || 'error',
    site: {
      id: stringValue(site.id) || 'site',
      title: stringValue(site.title) || 'Qortal Site',
      tagline: stringValue(site.tagline) || '',
      description: stringValue(site.description) || '',
      ownerName: stringValue(site.ownerName) || '',
      publicAuthor: stringValue(site.publicAuthor) || ''
    },
    manifest: null,
    generatedAt: null,
    loadedAt: new Date(now).toISOString(),
    message,
    notices,
    availability: { posts: false, pages: false, categories: false, tags: false },
    posts: [],
    pages: [],
    categories: [],
    tags: [],
    media: [],
    urls: { bySourceUrl: {} }
  };
}

function staleNotice(generatedAt) {
  return notice(
    'catalog-stale',
    'warning',
    'The published catalog was generated at ' + generatedAt + '. It may not reflect the latest published content.'
  );
}

export async function loadCmsDataset(rawManifest, options = {}) {
  const manifest = options.manifest || normalizeManifest(rawManifest, options);
  if (typeof options.fetchRef !== 'function') {
    throw new CatalogError('fetch-ref-missing', 'loadCmsDataset requires a fetchRef function.');
  }
  const fetchRef = options.fetchRef;
  const now = options.now == null ? Date.now() : options.now;
  const staleAfterMs = options.staleAfterMs == null ? DEFAULT_STALE_MS : Number(options.staleAfterMs);
  const results = await Promise.all([
    readIndex(manifest, 'posts', fetchRef),
    readIndex(manifest, 'pages', fetchRef),
    readIndex(manifest, 'categories', fetchRef),
    readIndex(manifest, 'tags', fetchRef),
    readIndex(manifest, 'media', fetchRef)
  ]);
  const [postsResult, pagesResult, categoriesResult, tagsResult, mediaResult] = results;
  const notices = [];
  const availability = {
    posts: postsResult.ok,
    pages: pagesResult.ok,
    categories: categoriesResult.ok,
    tags: tagsResult.ok
  };

  let posts = [];
  let pages = [];
  let categories = [];
  let tags = [];
  let media = [];

  if (postsResult.ok) {
    try {
      posts = normalizeIndexPayload(postsResult.payload, 'posts', manifest);
    } catch (error) {
      availability.posts = false;
      notices.push(notice('catalog-posts-invalid', 'error', errorFrom(error).message));
    }
  } else {
    notices.push(notice(
      'catalog-posts-unavailable',
      'error',
      'The posts index could not be read from QDN. Posts are not empty; this section is unavailable.'
    ));
  }
  if (pagesResult.ok) {
    try {
      pages = normalizeIndexPayload(pagesResult.payload, 'pages', manifest);
    } catch (error) {
      availability.pages = false;
      notices.push(notice('catalog-pages-invalid', 'error', errorFrom(error).message));
    }
  } else {
    notices.push(notice(
      'catalog-pages-unavailable',
      'error',
      'The pages index could not be read from QDN. Pages are not empty; this section is unavailable.'
    ));
  }
  if (categoriesResult.ok) {
    try {
      categories = normalizeTermsPayload(categoriesResult.payload);
    } catch (error) {
      availability.categories = false;
      notices.push(notice('catalog-categories-invalid', 'warning', 'Categories could not be read: ' + errorFrom(error).message));
    }
  } else {
    notices.push(notice('catalog-categories-unavailable', 'warning', 'The categories index is unavailable. Category names and filters may be incomplete.'));
  }
  if (tagsResult.ok) {
    try {
      tags = normalizeTermsPayload(tagsResult.payload);
    } catch (error) {
      availability.tags = false;
      notices.push(notice('catalog-tags-invalid', 'warning', 'Tags could not be read: ' + errorFrom(error).message));
    }
  } else {
    notices.push(notice('catalog-tags-unavailable', 'warning', 'The tags index is unavailable. Tag names and filters may be incomplete.'));
  }
  if (mediaResult.ok) {
    media = normalizeMediaPayload(mediaResult.payload);
  }

  if (!availability.posts && !availability.pages) {
    if (options.cache) {
      return {
        ...options.cache,
        state: 'stale',
        fromCache: true,
        cachedAt: options.cache.cachedAt || null,
        loadedAt: new Date(now).toISOString(),
        notices: [
          ...notices,
          ...(options.cache.notices || []),
          notice('catalog-cache-fallback', 'warning', 'Live QDN catalogs are unavailable. Showing the last successfully cached catalog.')
        ]
      };
    }
    return createErrorDataset({
      site: siteFrom(manifest, options.siteDefaults || {}),
      source: manifest.kind,
      now,
      message: 'The QDN catalog could not be read. The site cannot confirm whether it has no content or whether the catalog is unreachable.',
      notices: notices.length > 0 ? notices : undefined
    });
  }

  let countMismatch = false;
  const counts = manifest.counts;
  if (counts.posts !== null && counts.posts !== posts.length) countMismatch = true;
  if (counts.pages !== null && counts.pages !== pages.length) countMismatch = true;
  if (counts.categories !== null && counts.categories !== categories.length) countMismatch = true;
  if (counts.tags !== null && counts.tags !== tags.length) countMismatch = true;
  if (countMismatch) {
    notices.push(notice(
      'catalog-count-mismatch',
      'warning',
      'The catalog manifest counts do not match the loaded indexes. The catalog may be partially published.'
    ));
  }

  const generatedAt = manifest.generatedAt;
  const stale = generatedAt ? now - Date.parse(generatedAt) > staleAfterMs : false;
  if (stale) notices.push(staleNotice(generatedAt));

  const total = posts.length + pages.length;
  const anyUnavailable = Object.values(availability).some((value) => value === false);
  let state = 'ready';
  if (anyUnavailable || countMismatch) state = 'partial';
  else if (total === 0) state = 'empty';
  else if (stale) state = 'stale';

  posts.sort((left, right) => {
    const leftTime = Date.parse(left.publishedAt || left.createdAt || '') || 0;
    const rightTime = Date.parse(right.publishedAt || right.createdAt || '') || 0;
    return rightTime - leftTime;
  });

  return {
    state,
    source: manifest.kind,
    site: siteFrom(manifest, options.siteDefaults || {}),
    manifest: manifest.raw,
    generatedAt,
    loadedAt: new Date(now).toISOString(),
    notices,
    availability,
    posts,
    pages,
    categories,
    tags,
    media,
    urls: {
      bySourceUrl: manifest.resources.bySourceUrl || {}
    }
  };
}

export function normalizeContentPayload(payload, item) {
  if (!payload || typeof payload !== 'object') {
    throw new CatalogError('content-invalid', 'The published content payload is not a JSON object.');
  }
  const isQms = payload.schema === 'qms-qdn-content@1' || Boolean(payload.body && typeof payload.body === 'object');
  const body = payload.body && typeof payload.body === 'object' ? payload.body : {};
  const html = isQms
    ? stringValue(body.html)
    : stringValue(payload.content_html) || stringValue(payload.content && payload.content.rendered) || stringValue(body.html);
  const excerptHtml = isQms
    ? stringValue(body.excerpt_html) || stringValue(payload.excerpt_html)
    : stringValue(payload.excerpt) || stringValue(payload.excerpt_html) || stringValue(body.excerpt_html);
  const authors = Array.isArray(payload.authors) ? payload.authors : [];
  const authorName = stringValue(authors[0] && authors[0].name)
    || stringValue(payload.author && payload.author.name)
    || stringValue(payload.public_author);
  const normalizeMedia = (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const url = stringValue(entry.url) || stringValue(entry.resolved_url) || stringValue(entry.source_url);
    const qdn = copyRef(entry.qdn) || copyRef(entry.service && entry.identifier ? entry : null);
    if (!url && !qdn) return null;
    return { url, qdn, role: stringValue(entry.role) || undefined, alt: entry.alt == null ? null : String(entry.alt) };
  };
  const mediaObject = payload.media && !Array.isArray(payload.media) && typeof payload.media === 'object' ? payload.media : null;
  const media = (Array.isArray(payload.media)
    ? payload.media
    : mediaObject
      ? [mediaObject.featured, ...(Array.isArray(mediaObject.images) ? mediaObject.images : [])]
      : []).map(normalizeMedia).filter(Boolean);
  const featuredEntry = mediaObject && mediaObject.featured ? normalizeMedia(mediaObject.featured) : null;
  const featuredImageRef = featuredEntry && featuredEntry.qdn ? featuredEntry.qdn : item.featuredImageRef || null;
  const featuredImageUrl = featuredEntry && featuredEntry.url ? featuredEntry.url : item.featuredImageUrl || null;
  const featuredImageAlt = featuredEntry && featuredEntry.alt != null ? featuredEntry.alt : item.featuredImageAlt || null;

  return {
    item,
    title: stringValue(payload.title) || item.title,
    slug: stringValue(payload.identity && payload.identity.slug) || item.slug,
    html,
    excerptHtml,
    author: authorName,
    publishedAt: isoTime(payload.dates && payload.dates.published_at) || item.publishedAt,
    modifiedAt: isoTime(payload.dates && payload.dates.modified_at) || item.updatedAt,
    media,
    featuredImageRef,
    featuredImageUrl,
    featuredImageAlt,
    featuredImageSource: item.featuredImageSource || (featuredImageRef || featuredImageUrl ? 'published' : null),
    source: isQms ? 'qms-qdn' : 'legacy'
  };
}

export { normalizeName, isoTime, DEFAULT_STALE_MS };
