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

  if (url.startsWith('/')) {
    return true;
  }

  return url.startsWith(wordpressBaseUrl);
}

export function inspectPostHtml(contentHtml, wordpressBaseUrl) {
  const $ = cheerio.load(contentHtml || '');

  const images = unique(
    [
      ...$('img')
        .map((_, element) => $(element).attr('src'))
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

  const internal = links.filter((url) => isInternalUrl(url, wordpressBaseUrl));
  const external = links.filter((url) => !isInternalUrl(url, wordpressBaseUrl));

  return {
    images,
    audio,
    video,
    links: {
      internal,
      external
    }
  };
}
