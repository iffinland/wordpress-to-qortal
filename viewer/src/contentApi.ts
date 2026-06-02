import { fetchQdnResource } from './qortalClient';
import type { ContentItem, IndexItem, MediaMap, QdnManifest, QdnResourceRef, Term } from './types';

export const CONTENT_BASE = '/qortal-content';
const DEFAULT_QDN_MANIFEST_IDENTIFIER =
  import.meta.env.VITE_QDN_MANIFEST_IDENTIFIER || 'wpq-qdn-manifest';
const QDN_MANIFEST_SERVICE = 'DOCUMENT';

export type ContentSourceMode = 'local' | 'qdn';

export interface ContentSource {
  mode: ContentSourceMode;
  label: string;
  loadIndexes: () => Promise<{
    posts: IndexItem[];
    pages: IndexItem[];
    categories: Term[];
    tags: Term[];
    mediaMap: MediaMap;
  }>;
  loadContent: (file: string) => Promise<ContentItem>;
  resolveMediaUrl: (sourceUrl: string, mediaMap: MediaMap) => string;
}

export function getRouteParams(): URLSearchParams {
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash || '';
  const hashQueryIndex = hash.indexOf('?');

  if (hashQueryIndex >= 0) {
    const hashParams = new URLSearchParams(hash.slice(hashQueryIndex + 1));
    for (const [key, value] of hashParams.entries()) {
      if (!params.has(key)) {
        params.set(key, value);
      }
    }
  }

  const hashPath = hash.split('?')[0].replace(/^#\/?/, '');
  if (hashPath === 'publish' && !params.has('tool')) {
    params.set('tool', 'publish');
  }

  return params;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${CONTENT_BASE}/${path}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function fetchLocalJson<T>(path: string): Promise<T> {
  return fetchJson<T>(path);
}

export function createLocalContentSource(): ContentSource {
  return {
    mode: 'local',
    label: 'Local files',
    loadIndexes: loadLocalIndexes,
    loadContent: (file) => fetchLocalJson<ContentItem>(`converted/${file}`),
    resolveMediaUrl: (sourceUrl, mediaMap) => {
      const match = mediaMap[sourceUrl];
      if (!match?.local_path) {
        return sourceUrl;
      }
      return `${CONTENT_BASE}/${match.local_path}`;
    }
  };
}

export function createQdnContentSource(name: string, manifestIdentifier = DEFAULT_QDN_MANIFEST_IDENTIFIER): ContentSource {
  let manifestPromise: Promise<QdnManifest> | null = null;
  let sourceUrlResources: Record<string, QdnResourceRef> = {};

  const loadManifest = () => {
    manifestPromise ??= fetchQdnResource<QdnManifest>({
      service: QDN_MANIFEST_SERVICE,
      name,
      identifier: manifestIdentifier
    });
    return manifestPromise;
  };

  const loadByRef = async <T>(ref: QdnResourceRef) =>
    fetchQdnResource<T>({
      service: ref.service,
      name: ref.name || name,
      identifier: ref.identifier
    });

  const loadByPath = async <T>(filePath: string) => {
    const manifest = await loadManifest();
    const ref = manifest.resources.by_path[filePath];
    if (!ref) {
      throw new Error(`QDN manifest does not contain ${filePath}`);
    }
    return loadByRef<T>(ref);
  };

  return {
    mode: 'qdn',
    label: `QDN: ${name}`,
    async loadIndexes() {
      const manifest = await loadManifest();
      sourceUrlResources = manifest.resources.by_source_url || {};
      const [posts, pages, categories, tags, mediaMap] = await Promise.all([
        loadByRef<IndexItem[]>(manifest.entrypoints.posts_index),
        loadByRef<IndexItem[]>(manifest.entrypoints.pages_index),
        loadByRef<Term[]>(manifest.entrypoints.categories),
        loadByRef<Term[]>(manifest.entrypoints.tags),
        loadByRef<MediaMap>(manifest.entrypoints.media_map)
      ]);

      return { posts, pages, categories, tags, mediaMap };
    },
    loadContent: (file) => loadByPath<ContentItem>(`converted/${file}`),
    resolveMediaUrl: (sourceUrl, mediaMap) => {
      const manifestRef = sourceUrlResources[sourceUrl];
      if (manifestRef?.service && manifestRef?.identifier) {
        return `/arbitrary/${encodeURIComponent(manifestRef.service)}/${encodeURIComponent(manifestRef.name || name)}/${encodeURIComponent(manifestRef.identifier)}`;
      }

      const media = mediaMap[sourceUrl];
      if (media?.qdn_service && media?.qdn_identifier) {
        return `/arbitrary/${encodeURIComponent(media.qdn_service)}/${encodeURIComponent(name)}/${encodeURIComponent(media.qdn_identifier)}`;
      }
      return sourceUrl;
    }
  };
}

export function createContentSource(): ContentSource {
  const params = getRouteParams();
  const source = params.get('source') || params.get('mode') || 'local';
  const qdnName = params.get('name') || params.get('qdnName') || import.meta.env.VITE_QDN_NAME || '';
  const manifestIdentifier = params.get('manifestIdentifier') || DEFAULT_QDN_MANIFEST_IDENTIFIER;

  if (source.toLowerCase() === 'qdn') {
    if (!qdnName) {
      throw new Error('QDN mode requires ?source=qdn&name=<QortalName>.');
    }
    return createQdnContentSource(qdnName, manifestIdentifier);
  }

  return createLocalContentSource();
}

export async function loadLocalIndexes() {
  const [posts, pages, categories, tags, mediaMap] = await Promise.all([
    fetchLocalJson<IndexItem[]>('converted/posts-index.json'),
    fetchLocalJson<IndexItem[]>('converted/pages-index.json'),
    fetchLocalJson<Term[]>('converted/categories.json'),
    fetchLocalJson<Term[]>('converted/tags.json'),
    fetchLocalJson<MediaMap>('converted/media-map.json')
  ]);

  return { posts, pages, categories, tags, mediaMap };
}

export function rewriteHtmlMedia(
  contentHtml: string,
  mediaMap: MediaMap,
  resolveMediaUrl: (sourceUrl: string, mediaMap: MediaMap) => string
): string {
  const parser = new DOMParser();
  const document = parser.parseFromString(contentHtml, 'text/html');

  for (const image of Array.from(document.querySelectorAll('img'))) {
    const source = image.getAttribute('src');
    if (source) {
      image.setAttribute('src', resolveMediaUrl(source, mediaMap));
    }
    image.removeAttribute('srcset');
    image.removeAttribute('sizes');
    image.setAttribute('loading', 'lazy');
  }

  for (const link of Array.from(document.querySelectorAll('a[href]'))) {
    const href = link.getAttribute('href');
    if (!href) continue;
    link.setAttribute('href', resolveMediaUrl(href, mediaMap));
    if (href.startsWith('http')) {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noreferrer');
    }
  }

  for (const element of Array.from(document.querySelectorAll('script, style'))) {
    element.remove();
  }

  return document.body.innerHTML;
}

export function formatBytes(bytes?: number): string {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
