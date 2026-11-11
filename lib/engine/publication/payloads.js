import { stableStringify } from '../../model/content.js';
import { sha256Bytes } from './handoff.js';
import { deriveQdnIdentity, namespaceForSite, assertQdnIdentifier } from '../identity.js';

export const QDN_CONTENT_SCHEMA = 'qms-qdn-content@1';
export const QDN_INDEX_SCHEMA = 'qms-qdn-index@1';
export const SEARCH_INDEX_SCHEMA = 'qms-cms-search-index@1';
export const SEARCH_TEXT_LIMIT = 20000;
export const QDN_MANIFEST_SCHEMA = 'qms-qdn-manifest@1';
export const QDN_RESOURCE_MANIFEST_VERSION = 1;

const MIME_EXTENSION = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'application/pdf': 'pdf',
  'application/json': 'json',
  'text/html': 'html',
  'text/plain': 'txt'
});

export function jsonBytes(value) {
  return Buffer.from(stableStringify(value) + '\n', 'utf8');
}

export function serviceForMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('audio/')) return 'AUDIO';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime === 'application/pdf') return 'FILE';
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml')) return 'DOCUMENT';
  return 'FILE';
}

export function extensionForMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  return MIME_EXTENSION[mime] ?? 'bin';
}

export function stableSiteIdentifier({ prefix, namespace, kind, key }) {
  const safeKey = String(key || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18) || 'site';
  const digest = sha256Bytes(Buffer.from(String(kind) + '|' + String(key), 'utf8')).slice(7, 17);
  const identifier = (prefix + '-' + namespace + '-' + kind + '-' + safeKey + '-' + digest).slice(0, 64);
  assertQdnIdentifier(identifier);
  return identifier;
}

export function mediaIdentity({ siteId, namespace, target, mimeType, hash }) {
  return deriveQdnIdentity({
    siteId,
    namespace: namespace || namespaceForSite(siteId),
    sourceKey: 'media:' + String(hash),
    contentType: 'media',
    mimeType: mimeType ?? 'application/octet-stream',
    target
  });
}

export function contentIdentity({ siteId, namespace, target, sourceKey, contentType }) {
  return deriveQdnIdentity({
    siteId,
    namespace: namespace || namespaceForSite(siteId),
    sourceKey,
    contentType,
    mimeType: null,
    target
  });
}

export function mediaRefFromResource(resource) {
  return {
    service: resource.service,
    name: resource.name,
    identifier: resource.identifier,
    mimeType: resource.contentType,
    bytes: resource.bytes,
    sha256: resource.sha256
  };
}

function flattenDocumentMedia(document) {
  const out = [];
  const push = (entry, role) => {
    if (!entry) return;
    const url = entry.resolved_url ?? entry.url ?? null;
    if (!url) return;
    out.push({
      key: entry.key ?? null,
      sourceId: entry.source_id ?? null,
      url,
      role,
      mimeType: entry.mime_type ?? null,
      alt: entry.alt ?? null
    });
  };
  push(document.media?.featured, 'featured');
  for (const [role, entries] of Object.entries(document.media ?? {})) {
    if (role === 'featured') continue;
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry) => push(entry, role));
  }
  return out;
}

/**
 * Build the exact bytes published for one content resource. The projection is
 * deterministic so a modified resource gets a new hash without changing its
 * QDN identifier. Media references point at already-published QDN triples.
 */
export function renderContentPayload({ document, mediaByUrl, resource, publishedAt }) {
  const media = flattenDocumentMedia(document).map((entry) => {
    const ref = mediaByUrl.get(entry.url) ?? null;
    return {
      url: entry.url,
      role: entry.role,
      key: entry.key,
      sourceId: entry.sourceId,
      mimeType: entry.mimeType,
      alt: entry.alt,
      qdn: ref
        ? {
            service: ref.service,
            name: ref.name,
            identifier: ref.identifier,
            bytes: ref.bytes,
            sha256: ref.sha256
          }
        : null
    };
  });
  const payload = {
    schema: QDN_CONTENT_SCHEMA,
    version: 1,
    id: document.id,
    content_type: document.content_type,
    source: {
      adapter: document.source?.adapter ?? null,
      key: document.source?.key ?? null
    },
    identity: {
      slug: document.identity?.slug ?? null,
      old_url: document.identity?.old_url ?? null,
      canonical_url: document.identity?.canonical_url ?? null,
      parent_key: document.identity?.parent_key ?? null,
      menu_order: document.identity?.menu_order ?? null
    },
    title: document.title ?? null,
    dates: {
      published_at: document.dates?.published_at ?? null,
      modified_at: document.dates?.modified_at ?? null
    },
    publication_status: document.publication_status ?? null,
    body: {
      format: 'html',
      html: document.body?.html ?? '',
      text: document.body?.text ?? '',
      excerpt_html: document.body?.excerpt_html ?? '',
      excerpt_text: document.body?.excerpt_text ?? '',
      summary: document.body?.summary ?? ''
    },
    authors: document.authors ?? [],
    terms: document.terms ?? { categories: [], tags: [] },
    media,
    links: document.links ?? { internal: [], external: [], external_media: [] },
    content_hash: document.content_hash,
    qdn: {
      service: resource.service,
      name: resource.name,
      identifier: resource.identifier
    },
    published_at: publishedAt
  };
  return jsonBytes(payload);
}

function plainText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function searchEntryForContent(resource) {
  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(resource.payload).toString('utf8'));
  } catch {
    payload = null;
  }
  const body = payload && payload.body && typeof payload.body === 'object' ? payload.body : {};
  const title = String(payload?.title || resource.metadata?.title || resource.metadata?.slug || '').trim();
  const slug = String(payload?.identity?.slug || resource.metadata?.slug || '').trim();
  if (!title || !slug) return null;
  const text = String(body.text || plainText(body.html) || '').slice(0, SEARCH_TEXT_LIMIT);
  return {
    id: String(resource.id),
    type: resource.metadata?.contentType === 'page' ? 'page' : 'post',
    title,
    slug,
    excerpt: String(body.excerpt_text || body.summary || '').slice(0, 500),
    text,
    updated_at: payload?.dates?.modified_at || payload?.dates?.published_at || null,
    origin: 'imported'
  };
}

function qdnImageRef(entry) {
  const qdn = entry?.qdn;
  if (!qdn || String(qdn.service || '').toUpperCase() !== 'IMAGE') return null;
  const identifier = String(qdn.identifier || '').trim();
  if (!identifier) return null;
  const ref = { service: 'IMAGE', identifier };
  const name = String(qdn.name || '').trim();
  if (name) ref.name = name;
  return ref;
}

// The post index is the listing contract consumed by the Generic CMS. It must
// only refer to media that has already been resolved into a QDN IMAGE resource
// in the content payload; a source URL is never a card-image fallback.
function featuredImageForContent(resource) {
  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(resource.payload).toString('utf8'));
  } catch {
    return null;
  }
  const media = Array.isArray(payload?.media) ? payload.media : [];
  const featured = media.find((entry) => entry?.role === 'featured' && qdnImageRef(entry));
  const body = featured ? null : media.find((entry) => entry?.role === 'inline' && qdnImageRef(entry));
  const selected = featured || body;
  if (!selected) return null;
  return {
    featured_image: qdnImageRef(selected),
    featured_image_alt: selected.alt == null ? null : String(selected.alt),
    featured_image_source: featured ? 'wordpress' : 'body'
  };
}

function indexPayload(entries, generatedAt, extra = {}) {
  return jsonBytes({
    schema: QDN_INDEX_SCHEMA,
    version: 1,
    generated_at: generatedAt,
    ...extra,
    entries
  });
}

/**
 * Build deterministic catalog/index resources. Values are derived only from
 * the cumulative verified catalog plus the selected updates and target identity.
 */
export function buildIndexPayloads({ siteId = null, namespace, prefix, target, contentResources, mediaResources, generatedAt }) {
  const contentEntries = contentResources.map((resource) => {
    const featuredImage = featuredImageForContent(resource);
    return {
      id: resource.id,
      kind: resource.kind,
      title: resource.metadata?.title ?? null,
      slug: resource.metadata?.slug ?? null,
      contentType: resource.metadata?.contentType ?? null,
      qdn: { service: resource.service, name: resource.name, identifier: resource.identifier },
      contentHash: resource.metadata?.contentHash ?? null,
      mediaHash: resource.metadata?.mediaHash ?? null,
      ...(featuredImage ?? {})
    };
  });
  const mediaEntries = mediaResources.map((resource) => ({
    id: resource.id,
    sourceUrl: resource.metadata?.sourceUrl ?? null,
    mimeType: resource.metadata?.mimeType ?? null,
    bytes: resource.bytes,
    sha256: resource.sha256,
    qdn: { service: resource.service, name: resource.name, identifier: resource.identifier }
  }));
  const categories = [];
  const tags = [];
  const seenCategories = new Set();
  const seenTags = new Set();
  for (const resource of contentResources) {
    for (const term of resource.metadata?.categories ?? []) {
      const key = String(term.key ?? term.source_id ?? term.slug ?? term.name ?? '');
      if (!key || seenCategories.has(key)) continue;
      seenCategories.add(key);
      categories.push({ ...term, contentId: resource.id });
    }
    for (const term of resource.metadata?.tags ?? []) {
      const key = String(term.key ?? term.source_id ?? term.slug ?? term.name ?? '');
      if (!key || seenTags.has(key)) continue;
      seenTags.add(key);
      tags.push({ ...term, contentId: resource.id });
    }
  }
  const urlMap = {};
  for (const resource of contentResources) {
    const oldUrl = resource.metadata?.oldUrl;
    if (typeof oldUrl === 'string' && oldUrl.length > 0) {
      urlMap[oldUrl] = { service: resource.service, name: resource.name, identifier: resource.identifier };
    }
  }
  const mediaMap = {};
  for (const resource of mediaResources) {
    if (resource.metadata?.sourceUrl) {
      mediaMap[resource.metadata.sourceUrl] = {
        service: resource.service,
        name: resource.name,
        identifier: resource.identifier,
        mimeType: resource.metadata?.mimeType ?? null,
        bytes: resource.bytes,
        sha256: resource.sha256
      };
    }
  }
  const postEntries = contentEntries.filter((entry) => entry.contentType === 'post');
  const pageEntries = contentEntries.filter((entry) => entry.contentType === 'page');
  const searchEntries = contentResources
    .map(searchEntryForContent)
    .filter(Boolean)
    .sort((left, right) => left.title.localeCompare(right.title));
  const definitions = [
    {
      key: 'posts',
      label: 'posts-index.json',
      bytes: indexPayload(postEntries, generatedAt, { type: 'posts', count: postEntries.length })
    },
    {
      key: 'pages',
      label: 'pages-index.json',
      bytes: indexPayload(pageEntries, generatedAt, { type: 'pages', count: pageEntries.length })
    },
    {
      key: 'categories',
      label: 'categories.json',
      bytes: indexPayload(categories, generatedAt, { type: 'categories', count: categories.length })
    },
    {
      key: 'tags',
      label: 'tags.json',
      bytes: indexPayload(tags, generatedAt, { type: 'tags', count: tags.length })
    },
    {
      key: 'search',
      label: 'search-index.json',
      bytes: jsonBytes({
        schema: SEARCH_INDEX_SCHEMA,
        version: 1,
        generated_at: generatedAt,
        source: 'import',
        revision: 0,
        entry_count: searchEntries.length,
        entries: searchEntries
      })
    },
    {
      key: 'media-map',
      label: 'media-map.json',
      bytes: jsonBytes({ schema: QDN_INDEX_SCHEMA, version: 1, generated_at: generatedAt, type: 'media-map', entries: mediaMap })
    },
    {
      key: 'url-map',
      label: 'url-map.json',
      bytes: jsonBytes({ schema: QDN_INDEX_SCHEMA, version: 1, generated_at: generatedAt, type: 'url-map', entries: urlMap })
    },
    {
      key: 'import-manifest',
      label: 'import-manifest.json',
      bytes: jsonBytes({
        schema: QDN_INDEX_SCHEMA,
        version: 1,
        generated_at: generatedAt,
        type: 'import-manifest',
        siteId,
        namespace,
        target,
        counts: {
          content: contentResources.length,
          media: mediaResources.length,
          posts: postEntries.length,
          pages: pageEntries.length,
          categories: categories.length,
          tags: tags.length
        }
      })
    }
  ];
  const resources = definitions.map((definition, index) => ({
    id: 'res_' + sha256Bytes(Buffer.from('index|' + definition.key)).slice(7, 27),
    kind: 'index',
    service: 'DOCUMENT',
    key: definition.key,
    label: definition.label,
    payload: definition.bytes,
    bytes: definition.bytes.length,
    sha256: sha256Bytes(definition.bytes),
    identifier: stableSiteIdentifier({ prefix, namespace, kind: 'idx', key: definition.key }),
    order: index + 1,
    contentType: 'application/json; charset=utf-8',
    relativePath: 'payload/index/' + definition.label
  }));
  return resources;
}

export function buildManifestResource({ siteId = null, namespace, prefix, target, handoffId, generatedAt, contentResources, mediaResources, indexResources }) {
  const resources = [...mediaResources, ...contentResources, ...indexResources];
  const byPath = {};
  const byIdentifier = {};
  for (const resource of resources) {
    const ref = { service: resource.service, name: resource.name, identifier: resource.identifier };
    if (resource.relativePath) byPath[resource.relativePath] = ref;
    byIdentifier[resource.identifier] = {
      ...ref,
      kind: resource.kind,
      contentType: resource.contentType,
      bytes: resource.bytes,
      sha256: resource.sha256
    };
  }
  const postCount = contentResources.filter((resource) => resource.metadata?.contentType === 'post').length;
  const pageCount = contentResources.filter((resource) => resource.metadata?.contentType === 'page').length;
  const categoryKeys = new Set();
  const tagKeys = new Set();
  for (const resource of contentResources) {
    for (const term of resource.metadata?.categories ?? []) categoryKeys.add(String(term.key ?? term.source_id ?? term.slug ?? term.name ?? ''));
    for (const term of resource.metadata?.tags ?? []) tagKeys.add(String(term.key ?? term.source_id ?? term.slug ?? term.name ?? ''));
  }
  categoryKeys.delete('');
  tagKeys.delete('');
  const bytes = jsonBytes({
    schema: QDN_MANIFEST_SCHEMA,
    version: QDN_RESOURCE_MANIFEST_VERSION,
    generated_at: generatedAt,
    handoff_id: handoffId,
    site_id: siteId,
    namespace,
    target,
    entrypoints: {
      posts: indexResources.find((resource) => resource.key === 'posts')?.identifier ?? null,
      pages: indexResources.find((resource) => resource.key === 'pages')?.identifier ?? null,
      categories: indexResources.find((resource) => resource.key === 'categories')?.identifier ?? null,
      tags: indexResources.find((resource) => resource.key === 'tags')?.identifier ?? null,
      media_map: indexResources.find((resource) => resource.key === 'media-map')?.identifier ?? null,
      search: indexResources.find((resource) => resource.key === 'search')?.identifier ?? null,
      url_map: indexResources.find((resource) => resource.key === 'url-map')?.identifier ?? null
    },
    resources: { by_path: byPath, by_identifier: byIdentifier },
    summary: {
      content: contentResources.length,
      posts: postCount,
      pages: pageCount,
      categories: categoryKeys.size,
      tags: tagKeys.size,
      media: mediaResources.length,
      indexes: indexResources.length,
      total: resources.length
    }
  });
  return {
    id: 'res_' + sha256Bytes(Buffer.from('manifest|' + handoffId)).slice(7, 27),
    kind: 'manifest',
    service: 'DOCUMENT',
    key: 'site-manifest',
    payload: bytes,
    bytes: bytes.length,
    sha256: sha256Bytes(bytes),
    identifier: stableSiteIdentifier({ prefix, namespace, kind: 'man', key: 'site-manifest' }),
    order: 0,
    contentType: 'application/json; charset=utf-8',
    relativePath: 'payload/manifest/qdn-manifest.json'
  };
}
