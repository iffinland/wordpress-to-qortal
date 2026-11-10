import * as cheerio from 'cheerio';
import { inspectPostHtml } from '../../../src/utils/html.js';
import { parseSrcset } from './srcset.js';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'];
const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.m4v', '.ogv'];
const DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.odt', '.xls', '.xlsx', '.epub', '.zip', '.txt', '.csv'];

function extensionOf(url) {
  try {
    return new URL(url).pathname.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
  } catch {
    return '';
  }
}

function typeForExtension(url) {
  const extension = extensionOf(url);
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  if (AUDIO_EXTENSIONS.includes(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.includes(extension)) return 'video';
  if (DOCUMENT_EXTENSIONS.includes(extension)) return 'document';
  return null;
}

export function resolveUrl(value, baseUrl) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const trimmed = value.trim();
  if (/^(?:#|data:|mailto:|tel:|javascript:|blob:)/i.test(trimmed)) {
    return null;
  }
  try {
    return new URL(trimmed, `${String(baseUrl).replace(/\/+$/, '')}/`).toString();
  } catch {
    return null;
  }
}

export function isInternalUrl(url, baseUrl) {
  if (!url) return false;
  if (url.startsWith('/') || url.startsWith('#')) return true;
  try {
    const host = new URL(url, baseUrl).hostname.replace(/^www\./i, '');
    const site = new URL(baseUrl).hostname.replace(/^www\./i, '');
    return Boolean(host) && host === site;
  } catch {
    return false;
  }
}

function addMedia(list, entry) {
  const key = entry.resolved_url || entry.url;
  if (!key) return;
  if (!list.some((item) => (item.resolved_url || item.url) === key)) {
    list.push(entry);
  }
}

function mediaEntry({ url, baseUrl, role, extra = {} }) {
  const resolved = resolveUrl(url, baseUrl);
  if (!resolved) return null;
  return {
    url,
    resolved_url: resolved,
    role,
    external: !isInternalUrl(resolved, baseUrl),
    ...extra
  };
}

/**
 * Enhanced extraction used by qms-content@1. It intentionally preserves the
 * legacy inspection result too, so the Corbett compatibility view can remain
 * byte-comparable without forking the migration rules.
 */
export function extractHtmlResources(html = '', baseUrl) {
  const $ = cheerio.load(String(html ?? ''));
  const images = [];
  const audio = [];
  const video = [];
  const documents = [];
  const embeds = [];
  const internalLinks = [];
  const externalLinks = [];
  const externalMedia = [];

  $('img, source').each((_, element) => {
    const node = $(element);
    const src = node.attr('src') ?? node.attr('data-src') ?? node.attr('data-lazy-src') ?? node.attr('data-original');
    const lazy = !node.attr('src') && Boolean(node.attr('data-src') ?? node.attr('data-lazy-src') ?? node.attr('data-original'));
    const srcset = [
      ...parseSrcset(node.attr('srcset')),
      ...parseSrcset(node.attr('data-srcset')),
      ...parseSrcset(node.attr('imagesrcset'))
    ];
    if (src) {
      const entry = mediaEntry({
        url: src,
        baseUrl,
        role: String(element.tagName).toLowerCase() === 'source' ? 'responsive' : 'inline',
        extra: {
          lazy,
          alt: node.attr('alt') ?? null,
          width: node.attr('width') ? Number(node.attr('width')) : null,
          height: node.attr('height') ? Number(node.attr('height')) : null,
          srcset: srcset.map((item) => `${resolveUrl(item.url, baseUrl) ?? item.url}${item.descriptor ? ` ${item.descriptor}` : ''}`)
        }
      });
      if (entry) addMedia(images, entry);
    }
    for (const candidate of srcset) {
      const entry = mediaEntry({ url: candidate.url, baseUrl, role: 'responsive', extra: { srcset: [] } });
      if (entry) addMedia(images, entry);
    }
  });

  $('audio, audio source').each((_, element) => {
    const entry = mediaEntry({ url: $(element).attr('src'), baseUrl, role: 'inline' });
    if (entry) addMedia(audio, entry);
  });
  $('video, video source').each((_, element) => {
    const entry = mediaEntry({ url: $(element).attr('src'), baseUrl, role: 'inline' });
    if (entry) addMedia(video, entry);
  });

  $('iframe, embed, object').each((_, element) => {
    const node = $(element);
    const src = node.attr('src') ?? node.attr('data-src') ?? node.attr('data');
    const entry = mediaEntry({ url: src, baseUrl, role: 'embed' });
    if (entry) addMedia(embeds, entry);
  });

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;
    const resolved = resolveUrl(href, baseUrl);
    if (!resolved) return;
    if (isInternalUrl(resolved, baseUrl)) {
      internalLinks.push(resolved);
      const type = typeForExtension(resolved);
      const linked = mediaEntry({ url: href, baseUrl, role: 'linked' });
      if (type === 'audio' && linked) addMedia(audio, linked);
      if (type === 'video' && linked) addMedia(video, linked);
      if (type === 'document' && linked) addMedia(documents, linked);
      if (type === 'image' && linked) addMedia(images, linked);
      return;
    }
    externalLinks.push(resolved);
    const type = typeForExtension(resolved);
    if (type) {
      externalMedia.push(resolved);
      const linkedExternal = mediaEntry({ url: href, baseUrl, role: 'linked-external' });
      if (type === 'image' && linkedExternal) addMedia(images, linkedExternal);
      if (type === 'audio' && linkedExternal) addMedia(audio, linkedExternal);
      if (type === 'video' && linkedExternal) addMedia(video, linkedExternal);
      if (type === 'document' && linkedExternal) addMedia(documents, linkedExternal);
    }
  });

  let legacy = null;
  try {
    legacy = inspectPostHtml(String(html ?? ''), baseUrl);
  } catch {
    legacy = null;
  }

  return {
    images,
    audio,
    video,
    documents,
    embeds,
    links: {
      internal: [...new Set(internalLinks)],
      external: [...new Set(externalLinks)],
      external_media: [...new Set(externalMedia)]
    },
    legacy
  };
}

/**
 * Re-read body image references when a persisted source document is planned
 * or handed off. Source documents from an older parser remain hash-valid and
 * retain their verified media receipts, while obsolete numeric srcset tokens
 * stop participating in dependency checks or published payload metadata.
 */
export function refreshHtmlImageMedia(document) {
  const extracted = extractHtmlResources(document?.body?.html ?? '', document?.source?.site ?? null);
  return {
    ...document,
    media: {
      ...(document?.media ?? {}),
      images: extracted.images
    }
  };
}
