import type { ContentItem, IndexItem, MediaMap, Term } from './types';

export const CONTENT_BASE = '/qortal-content';

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${CONTENT_BASE}/${path}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function loadIndexes() {
  const [posts, pages, categories, tags, mediaMap] = await Promise.all([
    fetchJson<IndexItem[]>('converted/posts-index.json'),
    fetchJson<IndexItem[]>('converted/pages-index.json'),
    fetchJson<Term[]>('converted/categories.json'),
    fetchJson<Term[]>('converted/tags.json'),
    fetchJson<MediaMap>('converted/media-map.json')
  ]);

  return { posts, pages, categories, tags, mediaMap };
}

export function loadContent(file: string) {
  return fetchJson<ContentItem>(`converted/${file}`);
}

export function resolveMediaUrl(sourceUrl: string, mediaMap: MediaMap): string {
  const match = mediaMap[sourceUrl];
  if (!match?.local_path) {
    return sourceUrl;
  }
  return `${CONTENT_BASE}/${match.local_path}`;
}

export function rewriteHtmlMedia(contentHtml: string, mediaMap: MediaMap): string {
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
