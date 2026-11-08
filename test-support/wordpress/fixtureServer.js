import http from 'node:http';
import { Buffer } from 'node:buffer';

const FIXED_DATE = '2024-01-02T03:04:05';
const FIXED_MODIFIED = '2024-02-03T04:05:06';

function iso(value) {
  return /\.\d{3}Z$/.test(value) ? value : `${value}Z`;
}

export function createFixtureData() {
  return {
    site: {
      name: 'Fixture News',
      description: 'Deterministic WordPress fixture',
      namespaces: ['wp/v2']
    },
    posts: [
      {
        id: 101,
        slug: 'first-post',
        title: 'Corbett&#8217;s &amp; News',
        content: [
          '<p>Hello &amp; welcome to the <a href="/about/">about page</a> and <a href="https://example.org/report">external report</a>.</p>',
          '<img src="/wp-content/uploads/one.jpg" alt="One">',
          '<img data-src="/wp-content/uploads/lazy.jpg" srcset="/wp-content/uploads/lazy-300.jpg 300w, /wp-content/uploads/lazy-600.jpg 600w" alt="Lazy">',
          '<audio src="/wp-content/uploads/audio.mp3"></audio>',
          '<video src="/wp-content/uploads/video.mp4"></video>',
          '<a href="/wp-content/uploads/document.pdf">Document</a>',
          '<a href="https://cdn.example.net/remote.jpg">Remote image</a>',
          '<iframe src="https://www.youtube.com/embed/abc123"></iframe>'
        ].join('\n'),
        excerpt: '<p>First excerpt &amp; summary</p>',
        date: FIXED_DATE,
        date_gmt: FIXED_DATE,
        modified: FIXED_MODIFIED,
        modified_gmt: FIXED_MODIFIED,
        status: 'publish',
        author: 7,
        featured_media: 301,
        categories: [1],
        tags: [10],
        format: 'standard'
      },
      {
        id: 102,
        slug: 'duplicate-slug',
        title: 'Duplicate slug A',
        content: '<p>Duplicate slug A body</p>',
        excerpt: '<p>A</p>',
        date: '2023-01-01T00:00:00',
        date_gmt: '2023-01-01T00:00:00',
        modified: '2023-01-01T00:00:00',
        modified_gmt: '2023-01-01T00:00:00',
        status: 'publish',
        author: 7,
        featured_media: 0,
        categories: [2],
        tags: [10, 11]
      },
      {
        id: 103,
        slug: 'duplicate-slug',
        title: 'Duplicate slug B',
        content: '<p>Duplicate slug B body</p>',
        excerpt: '<p>B</p>',
        date: '2023-01-02T00:00:00',
        date_gmt: '2023-01-02T00:00:00',
        modified: '2023-01-02T00:00:00',
        modified_gmt: '2023-01-02T00:00:00',
        status: 'publish',
        author: 8,
        featured_media: 9999,
        categories: [1],
        tags: []
      },
      {
        id: 104,
        slug: 'draft-post',
        title: 'Draft post',
        content: '<p>Draft body</p>',
        excerpt: '',
        date: '2024-03-01T00:00:00',
        date_gmt: '2024-03-01T00:00:00',
        modified: '2024-03-01T00:00:00',
        modified_gmt: '2024-03-01T00:00:00',
        status: 'draft',
        author: 7,
        featured_media: 0,
        categories: [],
        tags: []
      }
    ],
    pages: [
      {
        id: 201,
        slug: 'about',
        title: 'About',
        content: '<p>About page with <a href="/first-post/">first post</a>.</p>',
        excerpt: '',
        date: '2022-01-01T00:00:00',
        date_gmt: '2022-01-01T00:00:00',
        modified: '2022-01-01T00:00:00',
        modified_gmt: '2022-01-01T00:00:00',
        status: 'publish',
        author: 7,
        featured_media: 0,
        parent: 0,
        menu_order: 1
      },
      {
        id: 202,
        slug: 'contact',
        title: 'Contact',
        content: '<p>Contact page</p>',
        excerpt: '',
        date: '2022-01-02T00:00:00',
        date_gmt: '2022-01-02T00:00:00',
        modified: '2022-01-02T00:00:00',
        modified_gmt: '2022-01-02T00:00:00',
        status: 'publish',
        author: 7,
        featured_media: 0,
        parent: 201,
        menu_order: 2
      }
    ],
    categories: [
      { id: 1, slug: 'news', name: 'News', description: 'News category', count: 2, parent: 0 },
      { id: 2, slug: 'analysis', name: 'Analysis', description: 'Analysis category', count: 1, parent: 1 }
    ],
    tags: [
      { id: 10, slug: 'featured', name: 'Featured', description: '', count: 2, parent: 0 },
      { id: 11, slug: 'archive', name: 'Archive', description: '', count: 1, parent: 0 }
    ],
    media: [
      {
        id: 301,
        slug: 'featured-image',
        title: 'Featured &amp; Image',
        date: FIXED_DATE,
        date_gmt: FIXED_DATE,
        modified: FIXED_MODIFIED,
        modified_gmt: FIXED_MODIFIED,
        status: 'inherit',
        media_type: 'image',
        mime_type: 'image/jpeg',
        source_url: '/wp-content/uploads/featured.jpg',
        alt_text: 'Featured image',
        caption: '<p>Caption</p>',
        description: '<p>Description</p>',
        post: 0,
        width: 1200,
        height: 800
      },
      {
        id: 302,
        slug: 'attachment-doc',
        title: 'Attachment document',
        date: FIXED_DATE,
        date_gmt: FIXED_DATE,
        modified: FIXED_MODIFIED,
        modified_gmt: FIXED_MODIFIED,
        status: 'inherit',
        media_type: 'file',
        mime_type: 'application/pdf',
        source_url: '/wp-content/uploads/document.pdf',
        alt_text: '',
        caption: '',
        description: '',
        post: 101,
        width: null,
        height: null
      },
      {
        id: 303,
        slug: 'audio-file',
        title: 'Audio file',
        date: FIXED_DATE,
        date_gmt: FIXED_DATE,
        modified: FIXED_MODIFIED,
        modified_gmt: FIXED_MODIFIED,
        status: 'inherit',
        media_type: 'audio',
        mime_type: 'audio/mpeg',
        source_url: '/wp-content/uploads/audio.mp3',
        alt_text: '',
        caption: '',
        description: '',
        post: 101,
        width: null,
        height: null
      }
    ],
    customTypes: {
      book: { id: 3, name: 'Books', rest_base: 'books', rest_namespace: 'wp/v2' },
      wp_block: { id: 4, name: 'Reusable blocks', rest_base: 'blocks', rest_namespace: 'wp/v2' }
    },
    books: [
      { id: 501, slug: 'book-one', title: 'Book One', status: 'publish' },
      { id: 502, slug: 'book-two', title: 'Book Two', status: 'publish' },
      { id: 503, slug: 'book-three', title: 'Book Three', status: 'publish' }
    ]
  };
}

export function createLargeFixtureData(options = {}) {
  const postCount = options.posts ?? 36_000;
  const mediaCount = options.media ?? 250_000;
  const categoryCount = options.categories ?? 2_053;
  const tagCount = options.tags ?? 50;
  const oldDate = '2020-01-01T00:00:00';
  const richDate = '2026-01-02T03:04:05';
  const posts = [
    {
      id: 101,
      slug: 'nasa-article-one',
      title: 'NASA article one',
      content: '<p>Article one</p><img class="wp-image-777" src="/wp-content/uploads/embed-777.jpg" alt="Embedded">',
      excerpt: '<p>One</p>',
      date: richDate,
      date_gmt: richDate,
      modified: richDate,
      modified_gmt: richDate,
      status: 'publish',
      author: 7,
      featured_media: 301,
      categories: [1, 2],
      tags: [10]
    },
    {
      id: 102,
      slug: 'nasa-article-two',
      title: 'NASA article two',
      content: '<p>Article two</p>',
      excerpt: '<p>Two</p>',
      date: '2026-01-01T03:04:05',
      date_gmt: '2026-01-01T03:04:05',
      modified: '2026-01-01T03:04:05',
      modified_gmt: '2026-01-01T03:04:05',
      status: 'publish',
      author: 7,
      featured_media: 303,
      categories: [1],
      tags: [11]
    },
    {
      id: 103,
      slug: 'nasa-article-three',
      title: 'NASA article three',
      content: '<p>Article three</p>',
      excerpt: '<p>Three</p>',
      date: '2025-12-31T03:04:05',
      date_gmt: '2025-12-31T03:04:05',
      modified: '2025-12-31T03:04:05',
      modified_gmt: '2025-12-31T03:04:05',
      status: 'publish',
      author: 7,
      featured_media: 0,
      categories: [2],
      tags: [10, 11]
    }
  ];
  // Bulk records stay compact on purpose: the fixture must describe a
  // NASA-scale site without materialising hundreds of thousands of full
  // WordPress payloads in memory. Representation helpers derive the display
  // fields (slug, title, content) from the id.
  for (let id = 104; posts.length < postCount; id += 1) {
    posts.push({
      id,
      date: oldDate,
      date_gmt: oldDate,
      modified: oldDate,
      modified_gmt: oldDate,
      status: 'publish',
      author: 7,
      featured_media: 0,
      categories: [1],
      tags: []
    });
  }
  const media = [
    { id: 301, slug: 'featured-one', title: 'Featured one', date: oldDate, date_gmt: oldDate, modified: oldDate, modified_gmt: oldDate, status: 'inherit', media_type: 'image', mime_type: 'image/jpeg', source_url: '/wp-content/uploads/featured-one.jpg', alt_text: 'Featured one', caption: '', description: '', post: 0, width: 1200, height: 800 },
    { id: 302, slug: 'attachment-one', title: 'Attachment one', date: oldDate, date_gmt: oldDate, modified: oldDate, modified_gmt: oldDate, status: 'inherit', media_type: 'file', mime_type: 'application/pdf', source_url: '/wp-content/uploads/attachment-one.pdf', alt_text: '', caption: '', description: '', post: 101, width: null, height: null },
    { id: 303, slug: 'featured-two', title: 'Featured two', date: oldDate, date_gmt: oldDate, modified: oldDate, modified_gmt: oldDate, status: 'inherit', media_type: 'image', mime_type: 'image/jpeg', source_url: '/wp-content/uploads/featured-two.jpg', alt_text: 'Featured two', caption: '', description: '', post: 0, width: 1000, height: 600 },
    { id: 777, slug: 'embedded-one', title: 'Embedded one', date: oldDate, date_gmt: oldDate, modified: oldDate, modified_gmt: oldDate, status: 'inherit', media_type: 'image', mime_type: 'image/jpeg', source_url: '/wp-content/uploads/embed-777.jpg', alt_text: 'Embedded', caption: '', description: '', post: 101, width: 800, height: 500 }
  ];
  for (let id = 10_000; media.length < mediaCount; id += 1) {
    media.push({
      id,
      date: oldDate,
      date_gmt: oldDate,
      modified: oldDate,
      modified_gmt: oldDate,
      status: 'inherit',
      media_type: 'image',
      mime_type: 'image/jpeg',
      post: 0
    });
  }
  const categories = [];
  for (let id = 1; categories.length < categoryCount; id += 1) {
    categories.push({ id, slug: 'category-' + id, name: 'Category ' + id, description: '', count: id <= 2 ? 3 : 1, parent: 0 });
  }
  const tags = [];
  for (let id = 10; tags.length < tagCount; id += 1) {
    tags.push({ id, slug: 'tag-' + id, name: 'Tag ' + id, description: '', count: id <= 11 ? 2 : 1, parent: 0 });
  }
  return {
    site: { name: 'Large Fixture', description: 'NASA-scale synthetic fixture', namespaces: ['wp/v2'] },
    posts,
    pages: [],
    categories,
    tags,
    media,
    customTypes: {},
    books: []
  };
}

function normalizeDate(value) {
  return iso(String(value ?? '').replace(/Z$/, ''));
}

function compareDates(left, right) {
  return Date.parse(normalizeDate(left)) - Date.parse(normalizeDate(right));
}

function requestBase(req) {
  return `http://${req.headers.host}`;
}

function linkFor(req, post) {
  const type = post.type ?? 'post';
  return type === 'page'
    ? `${requestBase(req)}/${post.slug}/`
    : `${requestBase(req)}/${post.slug}/`;
}

function mediaLink(req, media) {
  return `${requestBase(req)}/media/${media.slug}/`;
}

function termLink(req, taxonomy, term) {
  return `${requestBase(req)}/${taxonomy === 'category' ? 'category' : 'tag'}/${term.slug}/`;
}

function textFor(value) {
  return { rendered: value ?? '' };
}

function postRepresentation(req, post) {
  const derivedSlug = post.slug ?? 'nasa-article-' + post.id;
  const derivedTitle = post.title ?? 'NASA article ' + post.id;
  const derivedContent = post.content ?? '<p>Article ' + post.id + '</p>';
  return {
    id: post.id,
    date: normalizeDate(post.date),
    date_gmt: normalizeDate(post.date_gmt ?? post.date),
    modified: normalizeDate(post.modified ?? post.date),
    modified_gmt: normalizeDate(post.modified_gmt ?? post.modified ?? post.date),
    slug: derivedSlug,
    status: post.status ?? 'publish',
    type: post.type ?? 'post',
    link: linkFor(req, post),
    title: textFor(derivedTitle),
    content: { rendered: derivedContent, protected: false },
    excerpt: textFor(post.excerpt ?? ''),
    author: post.author ?? 7,
    featured_media: post.featured_media ?? 0,
    categories: post.categories ?? [],
    tags: post.tags ?? [],
    format: post.format ?? 'standard',
    sticky: Boolean(post.sticky),
    template: post.template ?? '',
    parent: post.parent ?? 0,
    menu_order: post.menu_order ?? 0,
    guid: { rendered: linkFor(req, post) },
    _links: {
      self: [{ href: `${requestBase(req)}/wp-json/wp/v2/posts/${post.id}` }],
      collection: [{ href: `${requestBase(req)}/wp-json/wp/v2/posts` }]
    }
  };
}

function pageRepresentation(req, page) {
  return { ...postRepresentation(req, { ...page, type: 'page' }), type: 'page' };
}

function mediaRepresentation(req, media) {
  return {
    id: media.id,
    date: normalizeDate(media.date),
    date_gmt: normalizeDate(media.date_gmt ?? media.date),
    modified: normalizeDate(media.modified ?? media.date),
    modified_gmt: normalizeDate(media.modified_gmt ?? media.modified ?? media.date),
    slug: media.slug ?? 'media-' + media.id,
    status: media.status ?? 'inherit',
    type: 'attachment',
    link: mediaLink(req, media),
    title: textFor(media.title ?? 'Media ' + media.id),
    author: 7,
    featured_media: 0,
    media_type: media.media_type ?? 'file',
    mime_type: media.mime_type ?? 'application/octet-stream',
    source_url: media.source_url?.startsWith('http') ? media.source_url : `${requestBase(req)}${media.source_url ?? '/wp-content/uploads/media-' + media.id + '.jpg'}`,
    alt_text: media.alt_text ?? '',
    caption: textFor(media.caption ?? ''),
    description: textFor(media.description ?? ''),
    post: media.post ?? 0,
    media_details: { width: media.width ?? null, height: media.height ?? null }
  };
}

function termRepresentation(req, taxonomy, term) {
  return {
    id: term.id,
    count: term.count ?? 0,
    description: term.description ?? '',
    link: termLink(req, taxonomy, term),
    name: term.name,
    slug: term.slug,
    taxonomy,
    parent: term.parent ?? 0
  };
}

function collection(items, query, { emptyMiddlePage = false, defaultOrderBy = 'date', defaultStatus = null } = {}) {
  const perPageRaw = Number(query.get('per_page') ?? 10);
  const perPage = Math.max(1, Math.min(Number.isFinite(perPageRaw) ? perPageRaw : 10, 100));
  const offsetParam = query.get('offset');
  const pageParam = Number(query.get('page') ?? 1);
  const order = query.get('order') === 'asc' ? 'asc' : 'desc';
  const orderBy = query.get('orderby') ?? defaultOrderBy;
  let filtered = [...items];

  const include = query.get('include');
  if (include) {
    const allowed = new Set(include.split(',').map((value) => value.trim()));
    filtered = filtered.filter((item) => allowed.has(String(item.id)));
  }
  const slugFilter = query.get('slug');
  if (slugFilter) {
    const allowed = new Set(slugFilter.split(',').map((value) => value.trim()));
    filtered = filtered.filter((item) => allowed.has(String(item.slug)));
  }

  const status = query.get('status');
  if (status) {
    const allowed = new Set(status.split(','));
    filtered = filtered.filter((item) => allowed.has(item.status ?? 'publish'));
  } else if (defaultStatus) {
    filtered = filtered.filter((item) => (item.status ?? 'publish') === defaultStatus);
  }
  for (const [field, after] of [['after', 'after'], ['before', 'before']]) {
    const value = query.get(field);
    if (value) {
      filtered = filtered.filter((item) => {
        const comparison = compareDates(item.date_gmt ?? item.date, value);
        return field === 'after' ? comparison >= 0 : comparison <= 0;
      });
    }
  }
  const modifiedAfter = query.get('modified_after');
  if (modifiedAfter) {
    filtered = filtered.filter((item) => compareDates(item.modified_gmt ?? item.modified ?? item.date, modifiedAfter) >= 0);
  }
  const modifiedBefore = query.get('modified_before');
  if (modifiedBefore) {
    filtered = filtered.filter((item) => compareDates(item.modified_gmt ?? item.modified ?? item.date, modifiedBefore) <= 0);
  }
  const search = query.get('search');
  if (search) {
    const needle = search.toLowerCase();
    filtered = filtered.filter((item) => String(item.title ?? '').toLowerCase().includes(needle));
  }
  filtered.sort((left, right) => {
    const leftValue = orderBy === 'id' ? left.id : orderBy === 'modified' ? (left.modified_gmt ?? left.modified ?? left.date) : (left.date_gmt ?? left.date);
    const rightValue = orderBy === 'id' ? right.id : orderBy === 'modified' ? (right.modified_gmt ?? right.modified ?? right.date) : (right.date_gmt ?? right.date);
    const comparison = orderBy === 'id'
      ? Number(leftValue) - Number(rightValue)
      : compareDates(leftValue, rightValue);
    return order === 'asc' ? comparison : -comparison;
  });

  const total = filtered.length;
  let page = Math.max(1, Number.isFinite(pageParam) ? pageParam : 1);
  if (offsetParam !== null) {
    const offset = Math.max(0, Number(offsetParam));
    const slice = filtered.slice(offset, offset + perPage);
    return { items: slice, total, totalPages: Math.ceil(Math.max(0, total - offset) / perPage) || 1, page: 1, perPage };
  }
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const emptyPage = emptyMiddlePage && page === 2 && totalPages >= 3;
  return {
    items: emptyPage ? [] : filtered.slice((page - 1) * perPage, page * perPage),
    total,
    totalPages,
    page,
    perPage
  };
}

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function authUser(options) {
  return options.authUser ?? 'fixture-user';
}

function authAppPassword(options) {
  return options.authAppPassword ?? 'fixture-app-password';
}

function authPassword(options) {
  return options.authPassword ?? 'fixture-password';
}

function isAuthorized(req, options) {
  if (!options.requireAuth) return true;
  const authorization = req.headers.authorization ?? '';
  if (options.authMode !== 'session' && authorization.startsWith('Basic ')) {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const [username, password] = decoded.split(':');
    return username === authUser(options) && password === authAppPassword(options);
  }
  if (options.authMode === 'session') {
    const cookie = req.headers.cookie ?? '';
    return cookie.split(/;\s*/).some((entry) => entry.startsWith('wordpress_logged_in_fixture='));
  }
  return false;
}

export async function startWordpressFixtureServer(options = {}) {
  const data = options.data ?? createFixtureData();
  const state = {
    delayMs: options.delayMs ?? 0,
    malformed: options.malformed ?? false,
    failStatus: options.failStatus ?? null,
    emptyMiddlePage: options.emptyMiddlePage ?? false,
    requests: []
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const query = url.searchParams;
    state.requests.push({
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(query.entries()),
      authorization: req.headers.authorization ?? null,
      cookie: req.headers.cookie ?? null
    });
    if (state.delayMs > 0 || query.get('trigger') === 'timeout') {
      await new Promise((resolve) => setTimeout(resolve, query.get('trigger') === 'timeout' ? 500 : state.delayMs));
    }
    if (query.get('trigger') === '500') {
      sendJson(res, 500, { code: 'fixture_error', message: 'Fixture server error' });
      return;
    }
    if (query.get('trigger') === '429') {
      sendJson(res, 429, { code: 'fixture_rate_limit' }, { 'Retry-After': '1' });
      return;
    }
    if (state.failStatus) {
      sendJson(res, state.failStatus, { code: 'fixture_failure' });
      return;
    }
    if (state.malformed || query.get('malformed') === '1') {
      sendText(res, 200, 'not-json', 'application/json');
      return;
    }

    if (url.pathname === '/login/' && req.method === 'GET') {
      sendText(res, 200, '<html><body><form id="loginform" action="/login/"><input name="nonce" value="abc"><input name="log"><input name="pwd"></form></body></html>', 'text/html; charset=utf-8');
      return;
    }
    if (url.pathname === '/login/' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      if (body.get('log') === authUser(options) && body.get('pwd') === authPassword(options)) {
        res.writeHead(302, {
          Location: '/wp-admin/',
          'Set-Cookie': 'wordpress_logged_in_fixture=yes; Path=/; HttpOnly'
        });
        res.end();
      } else {
        sendText(res, 200, '<html><body><div id="login_error">Invalid credentials</div></body></html>', 'text/html; charset=utf-8');
      }
      return;
    }

    if (!url.pathname.startsWith('/wp-json')) {
      sendJson(res, 404, { code: 'rest_no_route' });
      return;
    }
    if (!isAuthorized(req, options)) {
      sendJson(res, 401, { code: 'rest_forbidden', message: 'Authentication required' });
      return;
    }

    if (url.pathname === '/wp-json/') {
      sendJson(res, 200, {
        name: data.site.name,
        description: data.site.description,
        url: requestBase(req),
        home: requestBase(req),
        gmt_offset: 0,
        namespaces: data.site.namespaces,
        authentication: {},
        routes: { '/wp/v2/posts': {}, '/wp/v2/pages': {}, '/wp/v2/media': {} }
      });
      return;
    }
    if (url.pathname === '/wp-json/wp/v2/types') {
      sendJson(res, 200, {
        post: { id: 1, name: 'Posts', rest_base: 'posts', rest_namespace: 'wp/v2' },
        page: { id: 2, name: 'Pages', rest_base: 'pages', rest_namespace: 'wp/v2' },
        ...data.customTypes
      });
      return;
    }

    let collectionResult = null;
    let mapping = null;
    if (url.pathname === '/wp-json/wp/v2/posts') {
      collectionResult = collection(data.posts, query, { emptyMiddlePage: state.emptyMiddlePage, defaultStatus: 'publish' });
      mapping = (item) => postRepresentation(req, item);
    } else if (url.pathname === '/wp-json/wp/v2/pages') {
      collectionResult = collection(data.pages, query, { emptyMiddlePage: state.emptyMiddlePage, defaultStatus: 'publish' });
      mapping = (item) => pageRepresentation(req, item);
    } else if (url.pathname === '/wp-json/wp/v2/categories') {
      collectionResult = collection(data.categories, query, { defaultOrderBy: 'id' });
      mapping = (item) => termRepresentation(req, 'category', item);
    } else if (url.pathname === '/wp-json/wp/v2/tags') {
      collectionResult = collection(data.tags, query, { defaultOrderBy: 'id' });
      mapping = (item) => termRepresentation(req, 'post_tag', item);
    } else if (url.pathname === '/wp-json/wp/v2/media') {
      const parent = query.get('parent');
      const mediaItems = parent ? data.media.filter((item) => String(item.post) === String(parent)) : data.media;
      collectionResult = collection(mediaItems, query, { defaultOrderBy: 'date' });
      mapping = (item) => mediaRepresentation(req, item);
    } else if (url.pathname === '/wp-json/wp/v2/books') {
      collectionResult = collection(data.books, query, { defaultOrderBy: 'id' });
      mapping = (item) => ({ ...item, type: 'book', link: `${requestBase(req)}/books/${item.slug}/` });
    } else {
      const mediaMatch = url.pathname.match(/^\/wp-json\/wp\/v2\/media\/(\d+)$/);
      if (mediaMatch) {
        const media = data.media.find((item) => String(item.id) === mediaMatch[1]);
        if (!media) {
          sendJson(res, 404, { code: 'rest_post_invalid_id' });
          return;
        }
        sendJson(res, 200, mediaRepresentation(req, media));
        return;
      }
      const postMatch = url.pathname.match(/^\/wp-json\/wp\/v2\/posts\/(\d+)$/);
      if (postMatch) {
        const post = data.posts.find((item) => String(item.id) === postMatch[1]);
        if (!post) {
          sendJson(res, 404, { code: 'rest_post_invalid_id' });
          return;
        }
        sendJson(res, 200, postRepresentation(req, post));
        return;
      }
      sendJson(res, 404, { code: 'rest_no_route' });
      return;
    }

    if (collectionResult.page > collectionResult.totalPages) {
      sendJson(res, 400, { code: 'rest_post_invalid_page_number', message: 'The page number requested is larger than the number of pages available.' });
      return;
    }
    sendJson(res, 200, collectionResult.items.map(mapping), {
      'X-WP-Total': String(collectionResult.total),
      'X-WP-TotalPages': String(collectionResult.totalPages)
    });
  });

  await new Promise((resolve) => server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://${options.host ?? '127.0.0.1'}:${address.port}`;
  return {
    url,
    port: address.port,
    data,
    state,
    requests: state.requests,
    renamePost(id, slug) {
      const post = data.posts.find((item) => item.id === Number(id));
      if (!post) throw new Error(`No fixture post ${id}`);
      post.slug = slug;
      post.link = `${url}/${slug}/`;
    },
    setDelay(ms) {
      state.delayMs = ms;
    },
    setMalformed(value) {
      state.malformed = value;
    },
    setFailStatus(status) {
      state.failStatus = status;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

export { FIXED_DATE, FIXED_MODIFIED };
