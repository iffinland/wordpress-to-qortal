import { createQdnUrl, fetchQdnResource, hasQortalBridge, requestQortal, toBase64, tryRequestQortal } from './qortalClient';
import type { CmsComment, CmsDataset, CmsManifest, CmsPost, CmsPostIndexItem, CmsTerm, QdnRef, ViewerIdentity } from './types';

export const CMS_VERSION = '0.1.0';
export const MANIFEST_IDENTIFIER = 'cms-manifest';
export const POSTS_INDEX_IDENTIFIER = 'cms-posts-index';
export const PAGES_INDEX_IDENTIFIER = 'cms-pages-index';
export const CATEGORIES_IDENTIFIER = 'cms-categories';
export const TAGS_IDENTIFIER = 'cms-tags';
export const COMMENTS_INDEX_IDENTIFIER = 'cms-comments-index';

const LOCAL_STORAGE_KEY = 'qortal-cms-local-dataset-v1';

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

export function getQdnNameFromLocation() {
  const params = new URLSearchParams(window.location.search);
  return params.get('name') || params.get('qdnName') || import.meta.env.VITE_QDN_NAME || '';
}

export function normalizeQortalName(value = '') {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function createEmptyManifest(ownerName: string, ownerAddress = ''): CmsManifest {
  return {
    schema: 'qortal-cms/manifest@1',
    title: 'Qortal CMS',
    owner_name: ownerName,
    owner_address: ownerAddress,
    version: CMS_VERSION,
    updated_at: nowIso(),
    entrypoints: {
      posts_index: { service: 'DOCUMENT', identifier: POSTS_INDEX_IDENTIFIER, name: ownerName },
      pages_index: { service: 'DOCUMENT', identifier: PAGES_INDEX_IDENTIFIER, name: ownerName },
      categories: { service: 'DOCUMENT', identifier: CATEGORIES_IDENTIFIER, name: ownerName },
      tags: { service: 'DOCUMENT', identifier: TAGS_IDENTIFIER, name: ownerName },
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
    comments_enabled: true,
    author: { name: ownerName || 'local-owner', address: '' }
  };

  return {
    manifest: createEmptyManifest(ownerName),
    posts: [toPostIndexItem(post)],
    pages: [],
    categories: [category],
    tags: [tag],
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

export async function getViewerIdentity(ownerName: string): Promise<ViewerIdentity> {
  const bridgeAvailable = hasQortalBridge();
  const account = await tryRequestQortal<{ address?: string }>({ action: 'GET_USER_ACCOUNT' });
  const address = account?.address || '';
  let name = '';

  const names = address
    ? await tryRequestQortal<Array<{ name?: string }> | string[]>({ action: 'GET_ACCOUNT_NAMES', address })
    : null;

  if (Array.isArray(names) && names.length > 0) {
    const first = names[0];
    name = typeof first === 'string' ? first : first.name || '';
  }

  const devName = new URLSearchParams(window.location.search).get('viewerName') || '';
  if (!name && devName) name = devName;

  const normalizedOwner = normalizeQortalName(ownerName);
  const normalizedViewer = normalizeQortalName(name);

  return {
    address,
    name,
    bridgeAvailable,
    role: normalizedOwner && normalizedViewer === normalizedOwner ? 'owner' : 'reader'
  };
}

export async function loadDataset(ownerName: string): Promise<CmsDataset> {
  if (!ownerName) {
    return loadLocalDataset('');
  }

  try {
    const manifest = await fetchQdnResource<CmsManifest>('DOCUMENT', ownerName, MANIFEST_IDENTIFIER);
    const [posts, pages, categories, tags, comments] = await Promise.all([
      fetchQdnResource<CmsPostIndexItem[]>(manifest.entrypoints.posts_index.service, ownerName, manifest.entrypoints.posts_index.identifier),
      fetchQdnResource<CmsPostIndexItem[]>(manifest.entrypoints.pages_index.service, ownerName, manifest.entrypoints.pages_index.identifier),
      fetchQdnResource<CmsTerm[]>(manifest.entrypoints.categories.service, ownerName, manifest.entrypoints.categories.identifier),
      fetchQdnResource<CmsTerm[]>(manifest.entrypoints.tags.service, ownerName, manifest.entrypoints.tags.identifier),
      fetchQdnResource<CmsComment[]>(manifest.entrypoints.comments_index.service, ownerName, manifest.entrypoints.comments_index.identifier)
        .catch(() => [])
    ]);
    return { manifest, posts, pages, categories, tags, comments, local_posts: {} };
  } catch {
    return loadLocalDataset(ownerName);
  }
}

export function loadLocalDataset(ownerName: string): CmsDataset {
  const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as CmsDataset;
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

export function qdnLink(ref: QdnRef) {
  return ref.name ? createQdnUrl(ref.service, ref.name, ref.identifier) : '';
}
