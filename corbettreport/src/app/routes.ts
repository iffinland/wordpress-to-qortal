import { WEB2_BASE_URL } from '../config/site';

export type AppRoute =
  | { kind: 'home' }
  | { kind: 'post'; slug: string }
  | { kind: 'category'; slug: string }
  | { kind: 'tag'; slug: string }
  | { kind: 'page'; slug: string }
  | { kind: 'member' }
  | { kind: 'admin' }
  | { kind: 'not-found' };

export function parseHashRoute(hash = window.location.hash): AppRoute {
  const [path] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);

  if (parts.length === 0) return { kind: 'home' };
  if (parts[0] === 'posts' && parts[1]) return { kind: 'post', slug: parts[1] };
  if (parts[0] === 'category' && parts[1]) return { kind: 'category', slug: parts[1] };
  if (parts[0] === 'tag' && parts[1]) return { kind: 'tag', slug: parts[1] };
  if (parts[0] === 'pages' && parts[1]) return { kind: 'page', slug: parts[1] };
  if (parts[0] === 'member') return { kind: 'member' };
  if (parts[0] === 'admin') return { kind: 'admin' };
  return { kind: 'not-found' };
}

export function postHref(slug: string) {
  return `#/posts/${encodeURIComponent(slug)}`;
}

export function categoryHref(slug: string) {
  return `#/category/${encodeURIComponent(slugify(slug))}`;
}

export function pageHref(slug: string) {
  return `#/pages/${encodeURIComponent(slug)}`;
}

export function tagHref(slug: string) {
  return `#/tag/${encodeURIComponent(slugify(slug))}`;
}

export function slugify(value: string) {
  return value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function internalRouteForWeb2Url(value: string): string | null {
  try {
    const url = new URL(value, WEB2_BASE_URL);
    const web2 = new URL(WEB2_BASE_URL);
    if (url.hostname.replace(/^www\./, '') !== web2.hostname.replace(/^www\./, '')) return null;

    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const normalizedPath = url.pathname.toLowerCase();
    const fileExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.mp3', '.m4a', '.wav', '.ogg', '.flac', '.mp4', '.webm', '.mov', '.m4v', '.pdf', '.doc', '.docx', '.odt', '.xls', '.xlsx', '.epub', '.zip'];
    if (fileExtensions.some((extension) => normalizedPath.endsWith(extension))) return null;
    if (normalizedPath.startsWith('/wp-content/') || normalizedPath.startsWith('/mp4/') || normalizedPath.startsWith('/arbitrary/')) return null;
    if (parts.length === 0) return '#/';
    if (parts[0] === 'category' && parts[1]) return categoryHref(parts[parts.length - 1]);
    if (parts[0] === 'tag' && parts[1]) return tagHref(parts[parts.length - 1]);
    if (['members', 'member', 'login'].includes(parts[0])) return '#/member';
    const staticPages = new Map([
      ['about', 'about'],
      ['contact', 'contact'],
      ['rssfeeds', 'rss'],
      ['shop', 'shop'],
    ]);
    const pageSlug = staticPages.get(parts[0]);
    if (pageSlug) return pageHref(pageSlug);
    return postHref(parts[parts.length - 1]);
  } catch {
    return null;
  }
}
