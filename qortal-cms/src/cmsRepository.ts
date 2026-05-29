import { createQdnUrl, fetchQdnResource, hasQortalBridge, requestQortal, toBase64, tryRequestQortal } from './qortalClient';
import type { CmsComment, CmsDataset, CmsManifest, CmsMediaItem, CmsMediaType, CmsPost, CmsPostIndexItem, CmsTerm, QdnRef, ViewerIdentity } from './types';

export const CMS_VERSION = '0.1.0';
export const MANIFEST_IDENTIFIER = 'cms-manifest';
export const POSTS_INDEX_IDENTIFIER = 'cms-posts-index';
export const PAGES_INDEX_IDENTIFIER = 'cms-pages-index';
export const CATEGORIES_IDENTIFIER = 'cms-categories';
export const TAGS_IDENTIFIER = 'cms-tags';
export const MEDIA_INDEX_IDENTIFIER = 'cms-media-index';
export const COMMENTS_INDEX_IDENTIFIER = 'cms-comments-index';
export const CMS_POST_IDENTIFIER_PREFIX = 'cms-post-';

const LOCAL_STORAGE_KEY = 'qortal-cms-local-dataset-v1';

function nowIso() {
  return new Date().toISOString();
}

function localDatasetKey(ownerName: string) {
  return `${LOCAL_STORAGE_KEY}:${normalizeQortalName(ownerName) || 'anonymous'}`;
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || `item-${Date.now().toString(36)}`;
}

function compactHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function safeIdentifierPart(value = '') {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'site';
}

export function createSiteId(seed = '') {
  const input = `${seed}:${Date.now()}:${Math.random()}`;
  return `site-${compactHash(input).slice(0, 8)}`;
}

function createLegacySiteId(seed = '') {
  return `site-${compactHash(seed || 'qortal-cms').slice(0, 8)}`;
}

export function createPostIdentifier(slug: string, siteId = '') {
  const sitePart = siteId ? `${safeIdentifierPart(siteId)}-` : '';
  return `${CMS_POST_IDENTIFIER_PREFIX}${sitePart}${slug}-${Date.now().toString(36)}`.slice(0, 64);
}

export function createCommentIdentifier(postId: string) {
  return `cms-comment-${postId.slice(0, 24)}-${Date.now().toString(36)}`.slice(0, 64);
}

export function createMediaIdentifier(filename: string) {
  return `cms-media-${slugify(filename)}-${Date.now().toString(36)}`.slice(0, 64);
}

export function getQdnNameFromLocation() {
  const locations = collectLocationHints();
  for (const location of locations) {
    const name = readNameFromParams(location.search)
      || readNameFromParams(location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : '')
      || readNameFromPath(location.pathname)
      || readNameFromText(location.href);
    if (name) return name;
  }

  const qortalWindow = window as Window & { _qdnBase?: string; _qdnName?: string; _qdnResource?: { name?: string } };
  return qortalWindow._qdnName
    || qortalWindow._qdnResource?.name
    || readNameFromText(qortalWindow._qdnBase || '')
    || import.meta.env.VITE_QDN_NAME
    || '';
}

function safeDecode(value = '') {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function readNameFromParams(value: string) {
  if (!value) return '';
  const params = new URLSearchParams(value.startsWith('?') ? value : `?${value}`);
  return params.get('name') || params.get('qdnName') || params.get('appName') || '';
}

function collectLocationHints() {
  const hints: Array<Pick<Location, 'href' | 'pathname' | 'search' | 'hash'>> = [window.location];
  try {
    if (window.parent && window.parent !== window) hints.push(window.parent.location);
  } catch {
    // Cross-frame location access is not always allowed.
  }
  try {
    if (window.top && window.top !== window) hints.push(window.top.location);
  } catch {
    // Cross-frame location access is not always allowed.
  }
  if (document.referrer) {
    try {
      hints.push(new URL(document.referrer));
    } catch {
      // Ignore non-standard referrer values.
    }
  }
  return hints;
}

function readNameFromPath(pathname: string) {
  const parts = pathname.split('/').filter(Boolean).map(safeDecode);
  for (let index = 0; index < parts.length; index += 1) {
    const current = parts[index].toUpperCase();
    if ((current === 'APP' || current === 'WEBSITE') && parts[index + 1]) {
      return parts[index + 1];
    }
  }

  const appIndex = parts.findIndex((part) => part.toLowerCase() === 'app');
  if (appIndex >= 0 && parts[appIndex + 1] && parts[appIndex + 1].toUpperCase() !== 'APP') {
    return parts[appIndex + 1];
  }

  return '';
}

function readNameFromText(value: string) {
  if (!value) return '';
  const patterns = [
    /\/arbitrary\/(?:APP|WEBSITE)\/([^/?#]+)/i,
    /\/(?:APP|WEBSITE)\/([^/?#]+)/i,
    /qortal:\/\/(?:APP|WEBSITE)\/([^/?#]+)/i,
    /[?&](?:name|qdnName|appName)=([^&#]+)/i
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return safeDecode(match[1]);
  }
  return '';
}

export function normalizeQortalName(value = '') {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeQortalAddress(value = '') {
  return value.trim();
}

export function normalizeAddressList(addresses: string[] = []) {
  return [...new Set(addresses.map(normalizeQortalAddress).filter(Boolean))];
}

export function normalizePrincipal(value = '') {
  return normalizeQortalName(value);
}

export function principalMatches(value: string, viewer: { address?: string; names?: string[]; name?: string }) {
  const normalizedValue = normalizePrincipal(value);
  if (!normalizedValue) return false;
  if (viewer.address && normalizePrincipal(viewer.address) === normalizedValue) return true;
  if (viewer.name && normalizePrincipal(viewer.name) === normalizedValue) return true;
  return (viewer.names || []).some((name) => normalizePrincipal(name) === normalizedValue);
}

export function createEmptyManifest(ownerName: string, ownerAddress = ''): CmsManifest {
  const title = ownerName ? `${ownerName} CMS` : 'Qortal CMS';
  return {
    schema: 'qortal-cms/manifest@1',
    site_id: createSiteId(ownerName || title),
    title,
    tagline: 'A Qortal-native publishing site.',
    owner_name: ownerName,
    owner_address: ownerAddress,
    coauthors: [],
    version: CMS_VERSION,
    updated_at: nowIso(),
    entrypoints: {
      posts_index: { service: 'DOCUMENT', identifier: POSTS_INDEX_IDENTIFIER, name: ownerName },
      pages_index: { service: 'DOCUMENT', identifier: PAGES_INDEX_IDENTIFIER, name: ownerName },
      categories: { service: 'DOCUMENT', identifier: CATEGORIES_IDENTIFIER, name: ownerName },
      tags: { service: 'DOCUMENT', identifier: TAGS_IDENTIFIER, name: ownerName },
      media_index: { service: 'DOCUMENT', identifier: MEDIA_INDEX_IDENTIFIER, name: ownerName },
      comments_index: { service: 'DOCUMENT', identifier: COMMENTS_INDEX_IDENTIFIER, name: ownerName }
    }
  };
}

function ensureManifestShape(manifest: CmsManifest, ownerName: string): CmsManifest {
  const normalizedCoauthors = normalizeAddressList(manifest.coauthors || []);
  const ownerChanged = Boolean(
    manifest.owner_name &&
    ownerName &&
    normalizeQortalName(manifest.owner_name) !== normalizeQortalName(ownerName)
  );
  const owner = ownerName || manifest.owner_name;
  const entrypoints = manifest.entrypoints || {};
  return {
    ...manifest,
    site_id: ownerChanged ? createSiteId(owner || manifest.title) : manifest.site_id || createLegacySiteId(owner || manifest.title),
    title: manifest.title || (owner ? `${owner} CMS` : 'Qortal CMS'),
    tagline: manifest.tagline || '',
    owner_name: owner,
    owner_address: ownerChanged ? '' : manifest.owner_address || '',
    coauthors: ownerChanged ? [] : normalizedCoauthors,
    entrypoints: {
      posts_index: entrypoints.posts_index || { service: 'DOCUMENT', identifier: POSTS_INDEX_IDENTIFIER, name: owner },
      pages_index: entrypoints.pages_index || { service: 'DOCUMENT', identifier: PAGES_INDEX_IDENTIFIER, name: owner },
      categories: entrypoints.categories || { service: 'DOCUMENT', identifier: CATEGORIES_IDENTIFIER, name: owner },
      tags: entrypoints.tags || { service: 'DOCUMENT', identifier: TAGS_IDENTIFIER, name: owner },
      media_index: entrypoints.media_index || { service: 'DOCUMENT', identifier: MEDIA_INDEX_IDENTIFIER, name: owner },
      comments_index: entrypoints.comments_index || { service: 'DOCUMENT', identifier: COMMENTS_INDEX_IDENTIFIER, name: owner }
    }
  };
}

function createSampleDataset(ownerName: string): CmsDataset {
  const created = nowIso();
  const manifest = createEmptyManifest(ownerName);
  const category: CmsTerm = { id: 'cat-news', name: 'News', slug: 'news', created_at: created, updated_at: created };
  const tag: CmsTerm = { id: 'tag-qortal', name: 'Qortal', slug: 'qortal', created_at: created, updated_at: created };
  const post: CmsPost = {
    schema: 'qortal-cms/post@1',
    id: 'sample-post',
    type: 'post',
    title: 'Welcome to Qortal CMS',
    slug: 'welcome-to-qortal-cms',
    status: 'draft',
    excerpt: 'A local sample post for testing the CMS editor.',
    category_ids: [category.id],
    tag_ids: [tag.id],
    created_at: created,
    updated_at: created,
    published_at: null,
    qdn: { service: 'DOCUMENT', identifier: createPostIdentifier('welcome-to-qortal-cms', manifest.site_id), name: ownerName },
    content_html: '<p>This is a local draft. Open the editor, change the content, and publish through Qortal UI dev mode.</p>',
    cms_site_id: manifest.site_id,
    cms_site_name: ownerName,
    featured_image: null,
    media: [],
    videos: [],
    comments_enabled: true,
    author: { name: ownerName || 'local-owner', address: '' }
  };

  return {
    manifest,
    posts: [toPostIndexItem(post)],
    pages: [],
    categories: [category],
    tags: [tag],
    media: [],
    comments: [],
    local_posts: {
      [post.id]: post
    }
  };
}

export function toPostIndexItem(post: CmsPost): CmsPostIndexItem {
  return {
    id: post.id,
    type: post.type,
    title: post.title,
    slug: post.slug,
    status: post.status,
    excerpt: post.excerpt,
    category_ids: post.category_ids,
    tag_ids: post.tag_ids,
    created_at: post.created_at,
    updated_at: post.updated_at,
    published_at: post.published_at,
    qdn: post.qdn
  };
}

export async function getViewerIdentity(ownerName: string, manifest?: CmsManifest): Promise<ViewerIdentity> {
  const bridgeAvailable = hasQortalBridge();
  const account = await tryRequestQortal<{ address?: string; name?: string; primaryName?: string }>({ action: 'GET_USER_ACCOUNT' });
  const address = account?.address || '';
  const discoveredNames = new Set<string>();

  if (account?.name) discoveredNames.add(account.name);
  if (account?.primaryName) discoveredNames.add(account.primaryName);

  const names = address
    ? await tryRequestQortal<Array<{ name?: string }> | string[]>({ action: 'GET_ACCOUNT_NAMES', address })
    : null;

  if (Array.isArray(names)) {
    for (const item of names) {
      const nextName = typeof item === 'string' ? item : item.name || '';
      if (nextName) discoveredNames.add(nextName);
    }
  }

  const primaryName = address
    ? await tryRequestQortal<string>({ action: 'GET_PRIMARY_NAME', address })
    : null;
  if (primaryName) discoveredNames.add(primaryName);

  const devName = new URLSearchParams(window.location.search).get('viewerName') || '';
  if (devName) discoveredNames.add(devName);

  const normalizedOwner = normalizeQortalName(ownerName);
  const allNames = [...discoveredNames].filter(Boolean);
  const matchingOwnerName = allNames.find((nextName) => normalizeQortalName(nextName) === normalizedOwner) || '';
  const displayName = matchingOwnerName || allNames[0] || '';
  const isSysop = normalizedOwner && Boolean(matchingOwnerName);
  const isCoauthor = (manifest?.coauthors || []).some((coauthor) => principalMatches(coauthor, { address, name: displayName, names: allNames }));

  return {
    address,
    name: displayName,
    names: allNames,
    ownerTarget: ownerName,
    bridgeAvailable,
    role: isSysop ? 'sysop' : isCoauthor ? 'coauthor' : 'reader'
  };
}

export async function loadQdnDataset(ownerName: string): Promise<CmsDataset | null> {
  if (!ownerName) {
    return null;
  }

  try {
    const manifest = ensureManifestShape(await fetchQdnResource<CmsManifest>('DOCUMENT', ownerName, MANIFEST_IDENTIFIER), ownerName);
    const mediaRef = manifest.entrypoints.media_index;

    const [posts, pages, categories, tags, media, comments] = await Promise.all([
      fetchQdnResource<CmsPostIndexItem[]>(manifest.entrypoints.posts_index.service, ownerName, manifest.entrypoints.posts_index.identifier),
      fetchQdnResource<CmsPostIndexItem[]>(manifest.entrypoints.pages_index.service, ownerName, manifest.entrypoints.pages_index.identifier),
      fetchQdnResource<CmsTerm[]>(manifest.entrypoints.categories.service, ownerName, manifest.entrypoints.categories.identifier),
      fetchQdnResource<CmsTerm[]>(manifest.entrypoints.tags.service, ownerName, manifest.entrypoints.tags.identifier),
      fetchQdnResource<CmsMediaItem[]>(mediaRef.service, ownerName, mediaRef.identifier)
        .catch(() => []),
      fetchQdnResource<CmsComment[]>(manifest.entrypoints.comments_index.service, ownerName, manifest.entrypoints.comments_index.identifier)
        .catch(() => [])
    ]);
    const discoveredPosts = await discoverCmsPosts(ownerName, manifest.site_id).catch(() => []);
    return { manifest, posts: mergePostIndexes(posts, discoveredPosts), pages, categories, tags, media, comments, local_posts: {} };
  } catch {
    return null;
  }
}

export async function loadDataset(ownerName: string): Promise<CmsDataset> {
  const qdnDataset = await loadQdnDataset(ownerName);
  return qdnDataset || loadLocalDataset(ownerName);
}

export function loadLocalDataset(ownerName: string): CmsDataset {
  const stored = localStorage.getItem(localDatasetKey(ownerName)) || localStorage.getItem(LOCAL_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as CmsDataset;
      parsed.media ||= [];
      parsed.manifest = ensureManifestShape(parsed.manifest, ownerName);
      if (normalizeQortalName(parsed.manifest.owner_name) !== normalizeQortalName(ownerName)) {
        const dataset = createSampleDataset(ownerName);
        saveLocalDataset(dataset);
        return dataset;
      }
      parsed.comments ||= [];
      if (parsed.local_posts) {
        parsed.local_posts = Object.fromEntries(Object.entries(parsed.local_posts).map(([id, post]) => [
          id,
          { ...post, cms_site_id: post.cms_site_id || parsed.manifest.site_id, cms_site_name: post.cms_site_name || parsed.manifest.owner_name }
        ]));
      }
      saveLocalDataset(parsed);
      return parsed;
    } catch {
      localStorage.removeItem(localDatasetKey(ownerName));
    }
  }
  const dataset = createSampleDataset(ownerName);
  saveLocalDataset(dataset);
  return dataset;
}

export function saveLocalDataset(dataset: CmsDataset) {
  localStorage.setItem(localDatasetKey(dataset.manifest.owner_name), JSON.stringify(dataset));
}

export async function loadPost(ref: QdnRef, fallback?: CmsPost): Promise<CmsPost> {
  if (!ref.name) {
    if (fallback) return fallback;
    throw new Error('Post has no QDN name and no local fallback.');
  }
  return fetchQdnResource<CmsPost>(ref.service, ref.name, ref.identifier);
}

interface SearchQdnResourceResult {
  name?: string;
  service?: string;
  identifier?: string;
}

function isCmsPost(value: unknown): value is CmsPost {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as CmsPost).schema === 'qortal-cms/post@1' &&
    (value as CmsPost).id &&
    (value as CmsPost).qdn
  );
}

function sameSitePost(post: CmsPost, ownerName: string, resourceName = '', siteId = '') {
  if (siteId && post.cms_site_id) {
    return post.cms_site_id === siteId;
  }

  const normalizedOwner = normalizeQortalName(ownerName);
  if (!normalizedOwner) return true;
  return normalizeQortalName(post.cms_site_name || post.site_owner_name || '') === normalizedOwner
    || normalizeQortalName(post.qdn.name || '') === normalizedOwner
    || normalizeQortalName(resourceName) === normalizedOwner;
}

function mergePostIndexes(existing: CmsPostIndexItem[], discovered: CmsPostIndexItem[]) {
  const byId = new Map<string, CmsPostIndexItem>();
  for (const item of [...existing, ...discovered]) {
    const previous = byId.get(item.id);
    if (!previous || new Date(item.updated_at).getTime() >= new Date(previous.updated_at).getTime()) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()].sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime());
}

export async function discoverCmsPosts(ownerName: string, siteId = ''): Promise<CmsPostIndexItem[]> {
  if (!hasQortalBridge()) return [];
  const results = await requestQortal({
    action: 'SEARCH_QDN_RESOURCES',
    service: 'DOCUMENT',
    identifier: CMS_POST_IDENTIFIER_PREFIX,
    prefix: true,
    mode: 'ALL',
    reverse: true,
    limit: 100,
    offset: 0
  }) as SearchQdnResourceResult[];

  const posts: CmsPostIndexItem[] = [];
  for (const result of Array.isArray(results) ? results : []) {
    if (!result.name || !result.identifier) continue;
    try {
      const post = await fetchQdnResource<CmsPost>(result.service || 'DOCUMENT', result.name, result.identifier);
      if (!isCmsPost(post) || !sameSitePost(post, ownerName, result.name, siteId)) continue;
      posts.push(toPostIndexItem({ ...post, qdn: { ...post.qdn, name: result.name, identifier: result.identifier, service: post.qdn.service || 'DOCUMENT' } }));
    } catch {
      // Ignore malformed or unavailable resources.
    }
  }
  return posts;
}

export async function publishJsonResource<T>(name: string, ref: QdnRef, data: T, title: string, description: string) {
  await requestQortal({
    action: 'PUBLISH_QDN_RESOURCE',
    name,
    service: ref.service,
    identifier: ref.identifier,
    data64: toBase64(JSON.stringify(data, null, 2)),
    encoding: 'base64',
    title,
    description
  });
}

export interface JsonPublishItem<T = unknown> {
  ref: QdnRef;
  data: T;
  title: string;
  description: string;
  filename?: string;
}

export function mediaTypeForFile(file: File): CmsMediaType {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type === 'application/pdf' || file.type.includes('document')) return 'document';
  return 'file';
}

export function mediaServiceForType(type: CmsMediaType) {
  if (type === 'image') return 'IMAGE';
  if (type === 'audio') return 'AUDIO';
  if (type === 'video') return 'VIDEO';
  return 'FILE';
}

export function createMediaItem(file: File, ownerName: string, ownerAddress: string): CmsMediaItem {
  const created = nowIso();
  const type = mediaTypeForFile(file);
  return {
    schema: 'qortal-cms/media@1',
    id: `media-${Date.now().toString(36)}`,
    type,
    title: file.name.replace(/\.[^.]+$/, ''),
    filename: file.name,
    mime_type: file.type || 'application/octet-stream',
    bytes: file.size,
    created_at: created,
    updated_at: created,
    author: { name: ownerName, address: ownerAddress },
    qdn: {
      service: mediaServiceForType(type),
      identifier: createMediaIdentifier(file.name),
      name: ownerName
    }
  };
}

export async function publishMediaWithIndex(name: string, file: File, mediaItem: CmsMediaItem, mediaIndex: CmsMediaItem[], manifest: CmsManifest) {
  await requestQortal({
    action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
    resources: [
      {
        name,
        service: mediaItem.qdn.service,
        identifier: mediaItem.qdn.identifier,
        title: mediaItem.title,
        description: `CMS media file: ${mediaItem.filename}`,
        filename: mediaItem.filename,
        file
      },
      {
        name,
        service: manifest.entrypoints.media_index.service,
        identifier: manifest.entrypoints.media_index.identifier,
        title: 'CMS media index',
        description: 'Qortal CMS media index',
        filename: 'cms-media-index.json',
        data64: toBase64(JSON.stringify(mediaIndex, null, 2))
      },
      {
        name,
        service: 'DOCUMENT',
        identifier: MANIFEST_IDENTIFIER,
        title: 'CMS manifest',
        description: 'Qortal CMS manifest',
        filename: 'cms-manifest.json',
        data64: toBase64(JSON.stringify(manifest, null, 2))
      }
    ]
  });
}

export async function publishJsonResources(name: string, items: JsonPublishItem[]) {
  await requestQortal({
    action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
    resources: items.map((item) => ({
      name,
      service: item.ref.service,
      identifier: item.ref.identifier,
      title: item.title,
      description: item.description,
      filename: item.filename || `${item.ref.identifier}.json`,
      data64: toBase64(JSON.stringify(item.data, null, 2))
    }))
  });
}

export function qdnLink(ref: QdnRef) {
  return ref.name ? createQdnUrl(ref.service, ref.name, ref.identifier) : '';
}
