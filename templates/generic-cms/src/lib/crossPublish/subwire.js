/**
 * Subwire publication contract (interoperability adapter).
 *
 * Verified against `Qortal/Subwire` master @ a933a6c:
 *
 *   - `src/qapp-config.ts` / `AppWrapper.tsx`: appName 'subwire' with the public
 *     salt below; no test-identifier branch is active.
 *   - `src/utils/articleQdn.ts`: articles are DOCUMENT resources under
 *     SUBWIRE_ARTICLE / SUBWIRE_ROOT; `coverImage` is required; Core title is
 *     truncated to 75 bytes and the description to 180 bytes; the body is GFM
 *     Markdown with `subwire-image://<index>` references for embedded images.
 *   - `ArticleCard.tsx` / `ArticlePage.tsx` use `coverImage.src` verbatim when
 *     it starts with `data:`, otherwise prefix `data:image/webp;base64,`.
 *     The CMS therefore embeds a data URL and needs no WebP encoder.
 *   - `useResources` (qapp-core) drops hits at 32 bytes or >= 5 MiB, so the
 *     derived artifact is bounded well below that.
 *
 * The CMS body is HTML. Subwire consumes Markdown, so this module owns the
 * derived representation: it is rebuildable from the CMS post at any time.
 */

import { bytesToBase64, fetchQdnBytes } from '../qortal.js';
import { buildQappIdentifier } from './ids.js';

export const SUBWIRE_APP_NAME = 'subwire';
export const SUBWIRE_PUBLIC_SALT = '0drEPfUciLNhQZF9NFBg6RLnwcff/g3Ic7mm3VrIJKw=';
export const SUBWIRE_ARTICLE_ENTITY = 'SUBWIRE_ARTICLE';
export const SUBWIRE_ROOT_ENTITY = 'SUBWIRE_ROOT';
export const SUBWIRE_ARTICLE_TYPE = 'essay';
export const SUBWIRE_TITLE_MAX_BYTES = 75;
export const SUBWIRE_DESCRIPTION_MAX_BYTES = 180;

/** qapp-core drops hits at or above 5 MiB. Fail closed well below it. */
export const SUBWIRE_ARTIFACT_PAYLOAD_CAP_BYTES = 4 * 1024 * 1024;

/** Raw cover bytes embedded as base64 (base64 adds ~33 %). */
export const SUBWIRE_COVER_RAW_MAX_BYTES = 2 * 1024 * 1024;

const IMAGE_MIME_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif'
};

const ALLOWED_IMAGE_MIME = new Set(Object.values(IMAGE_MIME_BY_EXTENSION));

function extensionOf(name) {
  const match = /\.([a-z0-9]{1,10})$/i.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

/** Truncate to a UTF-8 byte budget without splitting a code point. */
export function truncateUtf8Bytes(text, maxBytes) {
  const source = String(text || '').trim();
  if (!source) return '';
  const encoder = new TextEncoder();
  let used = 0;
  let out = '';
  for (const character of source) {
    const size = encoder.encode(character).length;
    if (used + size > maxBytes) break;
    used += size;
    out += character;
  }
  return out;
}

export function subwireCoreTitle(title) {
  return truncateUtf8Bytes(title, SUBWIRE_TITLE_MAX_BYTES);
}

export function subwireCoreDescription(subtitle) {
  return truncateUtf8Bytes(subtitle, SUBWIRE_DESCRIPTION_MAX_BYTES);
}

function escapeMarkdownText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/([*_`])/g, '\\$1')
    // Subwire renders Markdown without a sanitizer, so literal angle brackets
    // from CMS text must never become raw HTML in the derived article.
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeLinkLabel(text) {
  return String(text || '').replace(/([\[\]])/g, '\\$1');
}

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function attachmentMarkdown() {
  // Audio, video and file attachments have no GFM Markdown equivalent that
  // Subwire can use, so they are dropped from the derived article. The CMS post
  // keeps the authoritative attachment.
  return '';
}

/** Only absolute web URLs, qortal:// links and site-relative paths survive. */
function safeUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^(https?:|mailto:|qortal:)/i.test(url)) return url;
  if (url.startsWith('/') || url.startsWith('#')) return url;
  return '';
}

function renderChildren(node, context) {
  let out = '';
  const children = node.childNodes ? Array.from(node.childNodes) : [];
  for (const child of children) out += renderNode(child, context);
  return out;
}

function renderNode(node, context) {
  if (!node) return '';
  if (node.nodeType === 3) {
    const raw = node.nodeValue || '';
    return context.preserve ? raw : escapeMarkdownText(raw.replace(/\s+/g, ' '));
  }
  if (node.nodeType !== 1) return '';
  const tag = String(node.tagName || '').toLowerCase();
  switch (tag) {
    case 'h1': return '# ' + renderChildren(node, context).trim() + '\n\n';
    case 'h2': return '## ' + renderChildren(node, context).trim() + '\n\n';
    case 'h3': return '### ' + renderChildren(node, context).trim() + '\n\n';
    case 'h4': return '#### ' + renderChildren(node, context).trim() + '\n\n';
    case 'h5': return '##### ' + renderChildren(node, context).trim() + '\n\n';
    case 'h6': return '###### ' + renderChildren(node, context).trim() + '\n\n';
    case 'p': {
      const inner = renderChildren(node, context).trim();
      return inner ? inner + '\n\n' : '';
    }
    case 'br': return '  \n';
    case 'strong': case 'b': return '**' + renderChildren(node, context) + '**';
    case 'em': case 'i': return '*' + renderChildren(node, context) + '*';
    case 's': case 'del': case 'strike': return '~~' + renderChildren(node, context) + '~~';
    case 'code': return '`' + String(node.textContent || '').replace(/`/g, '\\`') + '`';
    case 'pre': return '```\n' + String(node.textContent || '').replace(/\n$/, '') + '\n```\n\n';
    case 'blockquote': {
      const inner = renderChildren(node, context).trim();
      return inner.split('\n').map((line) => '> ' + line).join('\n') + '\n\n';
    }
    case 'ul': case 'ol': {
      let index = 0;
      let out = '';
      for (const child of Array.from(node.children || [])) {
        if (String(child.tagName || '').toLowerCase() !== 'li') continue;
        index += 1;
        const marker = tag === 'ol' ? index + '. ' : '- ';
        const inner = renderChildren(child, context).trim().replace(/\n{2,}/g, '\n').replace(/\n/g, '\n  ');
        out += marker + inner + '\n';
      }
      return out ? out + '\n' : '';
    }
    case 'a': {
      const href = safeUrl(node.getAttribute('href') || '');
      const label = renderChildren(node, context).trim() || href;
      return href ? '[' + escapeLinkLabel(label) + '](' + href + ')' : label;
    }
    case 'img': {
      const src = safeUrl(node.getAttribute('src') || '');
      const alt = node.getAttribute('alt') || '';
      return src ? '![' + escapeLinkLabel(alt) + '](' + src + ')' : '';
    }
    case 'hr': return '---\n\n';
    case 'figcaption': return '_' + renderChildren(node, context).trim() + '_\n\n';
    case 'tr': return renderChildren(node, context) + '\n';
    case 'td': case 'th': return renderChildren(node, context).trim() + ' | ';
    case 'table': return renderChildren(node, context) + '\n\n';
    case 'div': {
      if (node.hasAttribute && node.hasAttribute('data-qms-attachment')) {
        const attachment = attachmentMarkdown(node);
        return attachment ? attachment + '\n\n' : '';
      }
      const inner = renderChildren(node, context).trim();
      return inner ? inner + '\n\n' : '';
    }
    case 'span': case 'u': case 'mark': case 'small': case 'sup': case 'sub': case 'section': case 'article':
      return renderChildren(node, context);
    default:
      return renderChildren(node, context);
  }
}

/**
 * Convert sanitized CMS HTML into GFM Markdown for Subwire.
 *
 * Unknown tags are flattened to their text, attachments become qortal:// links
 * and body images stay absolute URLs, which Subwire's `marked` renderer keeps.
 */
export function markdownFromHtml(html, options = {}) {
  const Parser = options.windowLike || (typeof window !== 'undefined' ? window : null);
  const source = String(html || '');
  let markdown = '';
  if (!Parser || !Parser.DOMParser) {
    markdown = source.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  } else {
    const doc = new Parser.DOMParser().parseFromString('<body>' + source + '</body>', 'text/html');
    markdown = renderChildren(doc.body, { preserve: false });
  }
  const result = markdown
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const postUrl = safeUrl(options.postUrl);
  if (!postUrl) return result;
  const backlink = '[Read this post on the original site](' + postUrl + ')';
  return (result ? result + '\n\n---\n\n' : '') + backlink;
}

function normalizeImageMime(mime, name) {
  const value = String(mime || '').toLowerCase();
  if (ALLOWED_IMAGE_MIME.has(value)) return value;
  return IMAGE_MIME_BY_EXTENSION[extensionOf(name)] || '';
}

function webpName(name) {
  const base = String(name || 'cover').replace(/\.[^.]+$/, '');
  return (base || 'cover') + '.webp';
}

/**
 * Embed WebP bytes as bare base64. Subwire prefixes
 * `data:image/webp;base64,` when `src` is not already a data URL.
 */
export function subwireCoverFromBytes({ bytes, mime = '', name = 'cover' }) {
  if (!bytes || !bytes.length) return null;
  if (bytes.length > SUBWIRE_COVER_RAW_MAX_BYTES) return null;
  const type = normalizeImageMime(mime, name);
  if (type !== 'image/webp') return null;
  return { name: webpName(name), src: bytesToBase64(bytes) };
}

function loadImage(win, url) {
  return new Promise((resolve, reject) => {
    const image = new win.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The featured image could not be decoded, so it cannot be converted to WebP.'));
    image.src = url;
  });
}

/**
 * Convert the featured image to WebP in the webview canvas, bounded by
 * SUBWIRE_COVER_RAW_MAX_BYTES. An already-WebP image is passed through.
 * Throws a clear, owner-facing message when conversion is impossible.
 */
/**
 * @param {{ bytes?: any, mime?: string, name?: string, maxDimension?: number, maxBytes?: number, windowLike?: any }} [options]
 */
export async function convertCoverToWebp(options = {}) {
  const {
    bytes,
    mime = '',
    name = 'cover',
    maxDimension = 1600,
    maxBytes = SUBWIRE_COVER_RAW_MAX_BYTES,
    windowLike
  } = options;
  if (!bytes || !bytes.length) return null;
  const type = normalizeImageMime(mime, name);
  if (!type) {
    throw new Error('The featured image format is not supported. SubWire needs a WebP cover; choose a JPEG, PNG, GIF, AVIF or WebP image.');
  }
  if (type === 'image/webp') {
    if (bytes.length > maxBytes) {
      throw new Error('The featured image is ' + bytes.length + ' bytes, above the ' + maxBytes + '-byte SubWire cover cap. Choose a smaller image or clear the SubWire option.');
    }
    return { bytes, mime: 'image/webp', name: webpName(name) };
  }
  const win = windowLike || (typeof window !== 'undefined' ? window : null);
  if (!win || !win.document || typeof win.Image !== 'function' || !win.URL
    || typeof win.URL.createObjectURL !== 'function') {
    throw new Error('The featured image could not be converted to WebP because this webview has no canvas image encoder. Choose a WebP image or clear the SubWire option.');
  }
  const blob = new win.Blob([bytes], { type });
  const url = win.URL.createObjectURL(blob);
  try {
    const image = await loadImage(win, url);
    const width = Number(image.width) || 0;
    const height = Number(image.height) || 0;
    if (!width || !height) throw new Error('The featured image has no usable dimensions, so it cannot be converted to WebP.');
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const canvas = win.document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext && canvas.getContext('2d');
    if (!context) throw new Error('The featured image could not be converted to WebP because the canvas is unavailable.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const outBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!outBlob) {
      throw new Error('This webview cannot encode WebP, so the featured image cannot be used as the SubWire cover. Choose a WebP image or clear the SubWire option.');
    }
    const out = new Uint8Array(await outBlob.arrayBuffer());
    if (out.length > maxBytes) {
      throw new Error('The converted WebP cover is ' + out.length + ' bytes, above the ' + maxBytes + '-byte SubWire cap. Choose a smaller image or clear the SubWire option.');
    }
    return { bytes: out, mime: 'image/webp', name: webpName(name) };
  } finally {
    try { win.URL.revokeObjectURL(url); } catch {}
  }
}

/**
 * Deterministic fallback cover. Subwire requires a cover image, but a post may
 * have no featured image; a small generated SVG keeps the article compatible
 * without inventing or re-uploading binary assets.
 */
export function fallbackSubwireCover({ title = '', siteTitle = '', accent = '#1f2937' } = {}) {
  const color = /^#[0-9a-f]{3,8}$/i.test(String(accent || '')) ? String(accent) : '#1f2937';
  const heading = escapeXml(truncateUtf8Bytes(title || 'Publication', 70));
  const brand = escapeXml(truncateUtf8Bytes(siteTitle || '', 40));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">'
    + '<rect width="1200" height="630" fill="' + escapeXml(color) + '"/>'
    + '<rect x="64" y="64" width="1072" height="502" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="2"/>'
    + '<text x="96" y="300" fill="#ffffff" font-family="system-ui, sans-serif" font-size="54" font-weight="700">' + heading + '</text>'
    + '<text x="96" y="380" fill="rgba(255,255,255,0.8)" font-family="system-ui, sans-serif" font-size="28">' + brand + '</text>'
    + '</svg>';
  return {
    name: 'cover.svg',
    src: 'data:image/svg+xml;base64,' + bytesToBase64(new TextEncoder().encode(svg))
  };
}

/**
 * Resolve the Subwire cover: captured featured-image bytes, then the selected
 * QDN image reference, then the deterministic generated cover.
 */
/**
 * @param {{ bytes?: any, meta?: any, featured?: any, name?: string, title?: string, siteTitle?: string, accent?: string, readBytes?: Function }} [options]
 */
export async function resolveSubwireCover(options = {}) {
  const {
    bytes = null,
    meta = null,
    featured = null,
    name = '',
    title = '',
    siteTitle = '',
    accent = '#1f2937',
    readBytes = fetchQdnBytes
  } = options;
  let local = null;
  if (bytes) {
    const converted = await convertCoverToWebp({
      bytes,
      mime: (meta && meta.type) || '',
      name: (meta && meta.name) || 'cover'
    });
    local = subwireCoverFromBytes({
      bytes: converted.bytes,
      mime: 'image/webp',
      name: converted.name
    });
  }
  if (local) return { ...local, kind: 'featured' };
  const ref = featured && featured.ref ? featured.ref : null;
  if (ref && ref.identifier) {
    try {
      const remoteBytes = await readBytes(ref.service || 'IMAGE', ref.name || name, ref.identifier);
      const converted = await convertCoverToWebp({
        bytes: remoteBytes,
        mime: (ref.mimeType || ''),
        name: (ref.identifier || 'cover') + '.' + (extensionOf(ref.identifier) || 'jpg')
      });
      const embedded = subwireCoverFromBytes({
        bytes: converted.bytes,
        mime: 'image/webp',
        name: converted.name
      });
      if (embedded) return { ...embedded, kind: 'featured' };
    } catch {
      // A read failure must not block publication; use the generated cover.
    }
  }
  return { ...fallbackSubwireCover({ title, siteTitle, accent }), kind: 'generated' };
}

/** Subwire's article payload. Field names are the contract. */
export function buildSubwireArticle({ title, subtitle = '', markdown, cover, timestamp, name }) {
  const summary = String(subtitle || '').trim();
  return {
    title: String(title || '').trim(),
    ...(summary ? { subtitle: summary } : {}),
    content: String(markdown || ''),
    coverImage: { name: cover && cover.name ? cover.name : 'cover.svg', src: cover ? cover.src : '' },
    timestamp: Number(timestamp) || Date.now(),
    name: String(name || '').trim(),
    type: SUBWIRE_ARTICLE_TYPE,
    published: true
  };
}

/** Fail-closed self-check mirroring what Subwire's readers consume. */
export function isSubwireRenderableArticle(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof value.title !== 'string' || !value.title.trim()) return false;
  if (typeof value.content !== 'string' || !value.content.trim()) return false;
  if (value.type !== 'essay' && value.type !== 'episode') return false;
  if (value.published !== true) return false;
  if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) return false;
  if (typeof value.name !== 'string' || !value.name.trim()) return false;
  if (!value.coverImage || typeof value.coverImage !== 'object') return false;
  return typeof value.coverImage.src === 'string' && value.coverImage.src.length > 0;
}

/** Deterministic Subwire article identifier for one CMS post token. */
export async function subwireArticleIdentifier(token) {
  return buildQappIdentifier({
    appName: SUBWIRE_APP_NAME,
    publicSalt: SUBWIRE_PUBLIC_SALT,
    entityType: SUBWIRE_ARTICLE_ENTITY,
    parentId: SUBWIRE_ROOT_ENTITY,
    uid: token
  });
}

/** The SubWire deep link for one article. */
export function subwireArticleUrl(publisherName, identifier) {
  return 'qortal://APP/Subwire/article/' + encodeURIComponent(publisherName) + '/' + encodeURIComponent(identifier);
}

/** Batch resource entry for the Subwire article DOCUMENT. */
export function buildSubwireResource({ article, identifier }) {
  if (!isSubwireRenderableArticle(article)) throw new Error('The generated Subwire article is not valid.');
  return {
    stage: 'subwire',
    service: 'DOCUMENT',
    identifier,
    document: article,
    title: subwireCoreTitle(article.title),
    description: subwireCoreDescription(article.subtitle || ''),
    filename: identifier + '.json'
  };
}

/** UTF-8 size of the serialized article; used against the discovery cap. */
export function subwireArticleByteLength(article) {
  return new TextEncoder().encode(JSON.stringify(article)).length;
}
