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

const LOCAL_STORAGE_KEY = 'qortal-cms-local-dataset-v1';
const OWNER_STORAGE_KEY = 'qortal-cms-owner-name-v1';

function nowIso() {
  return new Date().toISOString();
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || `item-${Date.now().toString(36)}`;
}

export function createPostIdentifier(slug: string) {
  return `cms-post-${slug}-${Date.now().toString(36)}`.slice(0, 64);
}

export function createCommentIdentifier(postId: string) {
  return `cms-comment-${postId.slice(0, 24)}-${Date.now().toString(36)}`.slice(0, 64);
}

export function createMediaIdentifier(filename: string) {
  return `cms-media-${slugify(filename)}-${Date.now().toString(36)}`.slice(0, 64);
}

export function getQdnNameFromLocation() {
  const fromSearch = readNameFromParams(window.location.search);
  const fromHash = readNameFromParams(window.location.hash.includes('?') ? window.location.hash.slice(window.location.hash.indexOf('?')) : '');
  const fromPath = readNameFromPath(window.location.pathname);
  const fromStorage = localStorage.getItem(OWNER_STORAGE_KEY) || '';
  const name = fromSearch || fromHash || fromPath || import.meta.env.VITE_QDN_NAME || fromStorage || '';
  if (name) localStorage.setItem(OWNER_STORAGE_KEY, name);
  return name;
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

export function normalizeQortalName(value = '') {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeQortalAddress(value = '') {
  return value.trim();
}

export function normalizeAddressList(addresses: string[] = []) {
  return [...new Set(addresses.map(normalizeQortalAddress).filter(Boolean))];
}

export function createEmptyManifest(ownerName: string, ownerAddress = ''): CmsManifest {
  return {
    schema: 'qortal-cms/manifest@1',
    title: 'Qortal CMS',
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

function createSampleDataset(ownerName: string): CmsDataset {
  const created = nowIso();
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
    qdn: { service: 'DOCUMENT', identifier: createPostIdentifier('welcome-to-qortal-cms'), name: ownerName },
    content_html: '<p>This is a local draft. Open the editor, change the content, and publish through Qortal UI dev mode.</p>',
    featured_image: null,
    media: [],
    videos: [],
    comments_enabled: true,
    author: { name: ownerName || 'local-owner', address: '' }
  };

  return {
    manifest: createEmptyManifest(ownerName),
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
  const isCoauthor = Boolean(address && normalizeAddressList(manifest?.coauthors || []).includes(address));

  return {
    address,
    name: displayName,
    names: allNames,
    ownerTarget: ownerName,
    bridgeAvailable,
    role: isSysop ? 'sysop' : isCoauthor ? 'coauthor' : 'reader'
  };
}

export async function loadDataset(ownerName: string): Promise<CmsDataset> {
  if (!ownerName) {
    return loadLocalDataset('');
  }

  try {
    const manifest = await fetchQdnResource<CmsManifest>('DOCUMENT', ownerName, MANIFEST_IDENTIFIER);
    localStorage.setItem(OWNER_STORAGE_KEY, ownerName);
    const mediaRef = manifest.entrypoints.media_index || { service: 'DOCUMENT', identifier: MEDIA_INDEX_IDENTIFIER, name: ownerName };
    manifest.entrypoints.media_index = mediaRef;
    manifest.entrypoints.comments_index ||= { service: 'DOCUMENT', identifier: COMMENTS_INDEX_IDENTIFIER, name: ownerName };
    manifest.coauthors = normalizeAddressList(manifest.coauthors || []);

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
    return { manifest, posts, pages, categories, tags, media, comments, local_posts: {} };
  } catch {
    return loadLocalDataset(ownerName);
  }
}

export function loadLocalDataset(ownerName: string): CmsDataset {
  const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as CmsDataset;
      parsed.media ||= [];
      parsed.manifest.entrypoints.media_index ||= { service: 'DOCUMENT', identifier: MEDIA_INDEX_IDENTIFIER, name: ownerName };
      parsed.manifest.entrypoints.comments_index ||= { service: 'DOCUMENT', identifier: COMMENTS_INDEX_IDENTIFIER, name: ownerName };
      parsed.manifest.coauthors = normalizeAddressList(parsed.manifest.coauthors || []);
      parsed.comments ||= [];
      return parsed;
    } catch {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  }
  const dataset = createSampleDataset(ownerName);
  saveLocalDataset(dataset);
  return dataset;
}

export function saveLocalDataset(dataset: CmsDataset) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(dataset));
}

export async function loadPost(ref: QdnRef, fallback?: CmsPost): Promise<CmsPost> {
  if (!ref.name) {
    if (fallback) return fallback;
    throw new Error('Post has no QDN name and no local fallback.');
  }
  return fetchQdnResource<CmsPost>(ref.service, ref.name, ref.identifier);
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
