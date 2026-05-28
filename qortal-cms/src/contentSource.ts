import { fetchQdnResource } from './qortalClient';
import type { ContentItem, IndexItem, MediaMap, QdnManifest, QdnResourceRef, Term } from './types';

const CONTENT_BASE = '/qortal-content';
const QDN_MANIFEST_SERVICE = 'DOCUMENT';
const QDN_MANIFEST_IDENTIFIER = 'cr-qdn-manifest';

export interface CmsData {
  posts: IndexItem[];
  pages: IndexItem[];
  categories: Term[];
  tags: Term[];
  mediaMap: MediaMap;
}

export interface CmsSource {
  mode: 'local' | 'qdn';
  label: string;
  qdnName: string;
  manifest: QdnManifest | null;
  loadInitialData: () => Promise<CmsData>;
  loadContent: (file: string) => Promise<ContentItem>;
  resolveMediaUrl: (sourceUrl: string, mediaMap: MediaMap) => string;
  getResourceForPath: (path: string) => QdnResourceRef | null;
}

async function fetchLocalJson<T>(path: string): Promise<T> {
  const response = await fetch(`${CONTENT_BASE}/${path}`);
  if (!response.ok) throw new Error(`Unable to load ${path}: ${response.status}`);
  return response.json() as Promise<T>;
}

export function createLocalSource(): CmsSource {
  return {
    mode: 'local',
    label: 'Local dataset',
    qdnName: '',
    manifest: null,
    async loadInitialData() {
      const [posts, pages, categories, tags, mediaMap] = await Promise.all([
        fetchLocalJson<IndexItem[]>('converted/posts-index.json'),
        fetchLocalJson<IndexItem[]>('converted/pages-index.json'),
        fetchLocalJson<Term[]>('converted/categories.json'),
        fetchLocalJson<Term[]>('converted/tags.json'),
        fetchLocalJson<MediaMap>('converted/media-map.json')
      ]);
      return { posts, pages, categories, tags, mediaMap };
    },
    loadContent: (file) => fetchLocalJson<ContentItem>(`converted/${file}`),
    resolveMediaUrl(sourceUrl, mediaMap) {
      const localPath = mediaMap[sourceUrl]?.local_path;
      return localPath ? `${CONTENT_BASE}/${localPath}` : sourceUrl;
    },
    getResourceForPath() {
      return null;
    }
  };
}

export async function createQdnSource(name: string): Promise<CmsSource> {
  const manifest = await fetchQdnResource<QdnManifest>(QDN_MANIFEST_SERVICE, name, QDN_MANIFEST_IDENTIFIER);
  const loadByRef = <T>(ref: QdnResourceRef) => fetchQdnResource<T>(ref.service, name, ref.identifier);

  return {
    mode: 'qdn',
    label: `QDN: ${name}`,
    qdnName: name,
    manifest,
    async loadInitialData() {
      const [posts, pages, categories, tags, mediaMap] = await Promise.all([
        loadByRef<IndexItem[]>(manifest.entrypoints.posts_index),
        loadByRef<IndexItem[]>(manifest.entrypoints.pages_index),
        loadByRef<Term[]>(manifest.entrypoints.categories),
        loadByRef<Term[]>(manifest.entrypoints.tags),
        loadByRef<MediaMap>(manifest.entrypoints.media_map)
      ]);
      return { posts, pages, categories, tags, mediaMap };
    },
    async loadContent(file) {
      const ref = manifest.resources.by_path[`converted/${file}`];
      if (!ref) throw new Error(`Manifest does not contain ${file}`);
      return loadByRef<ContentItem>(ref);
    },
    resolveMediaUrl(sourceUrl) {
      const ref = manifest.resources.by_source_url[sourceUrl];
      if (!ref) return sourceUrl;
      return `/arbitrary/${encodeURIComponent(ref.service)}/${encodeURIComponent(name)}/${encodeURIComponent(ref.identifier)}`;
    },
    getResourceForPath(filePath) {
      return manifest.resources.by_path[filePath] || null;
    }
  };
}

export async function createSourceFromLocation(): Promise<CmsSource> {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('source') || 'local';
  const name = params.get('name') || import.meta.env.VITE_QDN_NAME || '';

  if (mode === 'qdn') {
    if (!name) throw new Error('QDN mode requires ?source=qdn&name=<QortalName>.');
    return createQdnSource(name);
  }

  return createLocalSource();
}
