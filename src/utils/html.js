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

function isInternalUrl(url, wordpressBaseUrl) {
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
