function safeDecode(value) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function parseHashRoute(hash = '') {
  const raw = String(hash || '').replace(/^#/, '');
  const queryIndex = raw.indexOf('?');
  const path = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
  const query = new URLSearchParams(queryIndex >= 0 ? raw.slice(queryIndex + 1) : '');
  const parts = path.split('/').filter(Boolean).map(safeDecode);

  if (parts.length === 0) return { kind: 'home' };
  if (parts[0] === 'posts' && parts[1]) return { kind: 'post', slug: parts[1] };
  if (parts[0] === 'posts') return { kind: 'posts', page: positiveInteger(query.get('page')) };
  if (parts[0] === 'pages' && parts[1]) return { kind: 'page', slug: parts[1] };
  if (parts[0] === 'category' && parts[1]) return { kind: 'category', slug: parts[1], page: positiveInteger(query.get('page')) };
  if (parts[0] === 'tag' && parts[1]) return { kind: 'tag', slug: parts[1], page: positiveInteger(query.get('page')) };
  if (parts[0] === 'archive') {
    const year = parts[1] ? Number.parseInt(parts[1], 10) : undefined;
    const rawMonth = parts[2] ? Number.parseInt(parts[2], 10) : undefined;
    const month = Number.isFinite(rawMonth) && rawMonth >= 1 && rawMonth <= 12 ? rawMonth : undefined;
    return {
      kind: 'archive',
      year: Number.isFinite(year) ? year : undefined,
      month,
      page: positiveInteger(query.get('page'))
    };
  }
  if (parts[0] === 'search') return { kind: 'search', query: query.get('q') || '' };
  if (parts[0] === 'gallery') return parts[1] ? { kind: 'gallery', slug: parts[1] } : { kind: 'gallery' };
  if (parts[0] === 'admin') {
    if (!parts[1]) return { kind: 'admin' };
    const section = parts[1] === 'settings' || parts[1] === 'editor' || parts[1] === 'galleries' ? parts[1] : 'overview';
    return { kind: 'admin', section, id: parts[2] ? parts[2] : undefined };
  }
  return { kind: 'not-found' };
}

function encode(value) {
  return encodeURIComponent(String(value));
}

export function postHref(slug) {
  return '#/posts/' + encode(slug);
}

export function pageHref(slug) {
  return '#/pages/' + encode(slug);
}

export function categoryHref(slug, page = 1) {
  const base = '#/category/' + encode(slug);
  return page > 1 ? base + '?page=' + page : base;
}

export function tagHref(slug, page = 1) {
  const base = '#/tag/' + encode(slug);
  return page > 1 ? base + '?page=' + page : base;
}

export function archiveHref(year, month, page = 1) {
  const base = year
    ? '#/archive/' + year + (month ? '/' + String(month).padStart(2, '0') : '')
    : '#/archive';
  return page > 1 ? base + '?page=' + page : base;
}

export function searchHref(query = '') {
  return query ? '#/search?q=' + encode(query) : '#/search';
}

export function adminHref(section = 'overview', id = '') {
  if (!section || section === 'overview') return '#/admin';
  return '#/admin/' + encode(section) + (id ? '/' + encode(id) : '');
}

export function galleryHref(slug = '') {
  return slug ? '#/gallery/' + encode(slug) : '#/gallery';
}

export function routeKey(route) {
  if (!route) return 'none';
  if (route.kind === 'post' || route.kind === 'page') return route.kind + ':' + route.slug;
  if (route.kind === 'category' || route.kind === 'tag') return route.kind + ':' + route.slug + ':' + route.page;
  if (route.kind === 'archive') return 'archive:' + (route.year || '') + ':' + (route.month || '') + ':' + route.page;
  if (route.kind === 'search') return 'search:' + route.query;
  if (route.kind === 'posts') return 'posts:' + route.page;
  if (route.kind === 'gallery') return 'gallery:' + (route.slug || '');
  if (route.kind === 'admin') return route.section && route.section !== 'overview' ? 'admin:' + route.section + ':' + (route.id || '') : 'admin';
  return route.kind;
}
