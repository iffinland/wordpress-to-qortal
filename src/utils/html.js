import * as cheerio from 'cheerio';

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function splitSrcset(value) {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter(Boolean);
}

export function isInternalUrl(url, wordpressBaseUrl) {
  if (!url) {
    return false;
  }

  if (url.startsWith('/') || url.startsWith('#')) {
    return true;
  }

  try {
    const linkHost = new URL(url, wordpressBaseUrl).hostname.replace(/^www\./, '');
    const siteHost = new URL(wordpressBaseUrl).hostname.replace(/^www\./, '');
    return Boolean(linkHost) && linkHost === siteHost;
  } catch {
    return false;
  }
}

function normalizeComparableUrl(value, wordpressBaseUrl) {
  try {
    const url = new URL(value, `${wordpressBaseUrl.replace(/\/+$/, '')}/`);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return '';
  }
}

const LINKED_FILE_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif',
  '.mp3', '.m4a', '.wav', '.ogg', '.flac',
  '.mp4', '.webm', '.mov', '.m4v',
  '.pdf', '.doc', '.docx', '.odt', '.xls', '.xlsx', '.epub', '.zip'
];

function qappRouteForInternalUrl(value, wordpressBaseUrl) {
  try {
    const url = new URL(value, `${wordpressBaseUrl.replace(/\/+$/, '')}/`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const normalizedPath = pathname.toLowerCase();
    const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (LINKED_FILE_EXTENSIONS.some((extension) => normalizedPath.endsWith(extension))) return null;
    if (normalizedPath.startsWith('/wp-content/') || normalizedPath.startsWith('/mp4/')) return null;
    if (parts.length === 0) return '#/';
    if (parts[0] === 'category' && parts[1]) return `#/category/${encodeURIComponent(parts.at(-1))}`;
    if (parts[0] === 'tag' && parts[1]) return `#/tag/${encodeURIComponent(parts.at(-1))}`;
    if (['members', 'member', 'login'].includes(parts[0])) return '#/member';
    return `#/posts/${encodeURIComponent(parts.at(-1))}`;
  } catch {
    return null;
  }
}

export function rewriteInternalLinks(contentHtml, wordpressBaseUrl, urlMap) {
  const $ = cheerio.load(contentHtml || '');
  const routes = new Map();

  for (const [sourceUrl, item] of Object.entries(urlMap || {})) {
    if (item.qapp_route) {
      routes.set(normalizeComparableUrl(sourceUrl, wordpressBaseUrl), item.qapp_route);
    }
  }

  $('a[href]').each((_, element) => {
    const link = $(element);
    const href = link.attr('href');
    if (!href || href.startsWith('#') || !isInternalUrl(href, wordpressBaseUrl)) {
      return;
    }

    const route = routes.get(normalizeComparableUrl(href, wordpressBaseUrl))
      || qappRouteForInternalUrl(href, wordpressBaseUrl);
    if (route) {
      link.attr('data-web2-href', href);
      link.attr('href', route);
    }
  });

  return $('body').html() || '';
}

function urlsWithExtensions(urls, extensions) {
  return urls.filter((url) => {
    const normalized = url.toLowerCase().split(/[?#]/)[0];
    return extensions.some((extension) => normalized.endsWith(extension));
  });
}

export function inspectPostHtml(contentHtml, wordpressBaseUrl) {
  const $ = cheerio.load(contentHtml || '');

  const images = unique(
    [
      ...$('img')
        .map((_, element) => $(element).attr('src'))
        .get(),
      ...$('img')
        .map((_, element) => $(element).attr('data-lazy-src'))
        .get(),
      ...$('img')
        .map((_, element) => splitSrcset($(element).attr('srcset')))
        .get()
        .flat(),
      ...$('source')
        .map((_, element) => splitSrcset($(element).attr('srcset')))
        .get()
        .flat()
    ]
  );

  const audio = unique(
    $('audio, audio source')
      .map((_, element) => $(element).attr('src'))
      .get()
  );

  const video = unique(
    $('video, video source')
      .map((_, element) => $(element).attr('src'))
      .get()
  );

  const links = unique(
    $('a')
      .map((_, element) => $(element).attr('href'))
      .get()
  );
  const linkedImages = urlsWithExtensions(links, ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif']);
  const linkedAudio = urlsWithExtensions(links, ['.mp3', '.m4a', '.wav', '.ogg', '.flac']);
  const linkedVideo = urlsWithExtensions(links, ['.mp4', '.webm', '.mov', '.m4v']);
  const documents = urlsWithExtensions(links, [
    '.pdf',
    '.doc',
    '.docx',
    '.odt',
    '.xls',
    '.xlsx',
    '.epub',
    '.zip'
  ]);
  const embeds = unique(
    $('iframe')
      .map((_, element) => $(element).attr('src') || $(element).attr('data-src'))
      .get()
  );

  const internal = links.filter((url) => isInternalUrl(url, wordpressBaseUrl));
  const external = links.filter((url) => !isInternalUrl(url, wordpressBaseUrl));

  return {
    images: unique([...images, ...linkedImages]),
    audio: unique([...audio, ...linkedAudio]),
    video: unique([...video, ...linkedVideo]),
    documents,
    embeds,
    links: {
      internal,
      external
    }
  };
}
