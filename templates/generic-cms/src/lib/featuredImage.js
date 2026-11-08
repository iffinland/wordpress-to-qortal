import { createQdnResourceUrl } from './qortal.js';

/**
 * Featured image rules for CMS-authored and WordPress-imported content.
 *
 * The featured image is optional. Resolution order is deterministic:
 *   1. an explicit owner selection (including a preserved WordPress featured
 *      image),
 *   2. the first suitable image in the post body,
 *   3. no featured image.
 *
 * "Suitable" excludes tracking pixels, spacer/blank pixels, icons, SVG
 * placeholders, video thumbnails/poster images, data/blob URLs and broken or
 * non-resolvable references. A deterministic body image is chosen in document
 * order, so republishing the same body selects the same image.
 */

export const FEATURED_IMAGE_SCHEMA = 'qms-cms-featured-image@1';

export const FEATURED_IMAGE_HELP =
  'Featured image is optional. If you don’t choose one, the first suitable image in your post will be used automatically. If your post has no images, it will be published without a featured image.';

export const FEATURED_IMAGE_SOURCES = Object.freeze({
  EXPLICIT: 'explicit',
  BODY: 'body',
  WORDPRESS: 'wordpress',
  PUBLISHED: 'published',
  LOCAL_FILE: 'local-file',
  NONE: 'none'
});

const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:[?#]|$)/i;
const VIDEO_EXTENSION = /\.(?:avi|m4v|mov|mp4|mpeg|mpg|ogv|webm)(?:[?#]|$)/i;
const UNSUPPORTED_SCHEME = /^(?:about|blob|data|javascript|mailto|tel):/i;
const TRACKING_NAME = /(?:^|[/_.-])(?:1x1|beacon|blank|pixel|spacer|tracking|transparent)(?:[/_.-]|$)/i;
const ICON_NAME = /(?:^|[/_.-])(?:favicon|icon|sprite)(?:[/_.-]|$)/i;

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Normalize a QDN image reference for drafts, indexes and payloads.
 * @returns {any}
 */
export function normalizeFeaturedImage(value) {
  if (!value || typeof value !== 'object') return null;
  const identifier = String(value.identifier || '').trim();
  if (!identifier) return null;
  const service = String(value.service || 'IMAGE').toUpperCase();
  if (service !== 'IMAGE') return null;
  const name = value.name == null ? '' : String(value.name);
  const normalized = {
    service,
    identifier,
    alt: value.alt == null ? null : String(value.alt),
    mimeType: value.mimeType || value.mime_type || null,
    width: finite(value.width),
    height: finite(value.height),
    bytes: finite(value.bytes),
    sha256: value.sha256 || null
  };
  if (name) normalized.name = name;
  if (value.url) normalized.url = String(value.url);
  return normalized;
}

/** Convert an external URL or a QDN URL into a normalized image reference. */
export function parseImageReference(value, fallbackName) {
  const source = String(value || '').trim();
  if (!source) return null;
  const arbitrary = /^(?:https?:\/\/[^/]+)?\/arbitrary\/([A-Za-z]+)\/([^/?#]+)\/([^/?#]+)/i.exec(source);
  if (arbitrary) {
    return normalizeFeaturedImage({
      service: arbitrary[1],
      name: safeDecode(arbitrary[2]),
      identifier: safeDecode(arbitrary[3])
    });
  }
  const qortal = /^qortal:\/\/([A-Za-z]+)\/([^/?#]+)\/([^/?#]+)/i.exec(source);
  if (qortal) {
    return normalizeFeaturedImage({
      service: qortal[1],
      name: safeDecode(qortal[2]),
      identifier: safeDecode(qortal[3])
    });
  }
  if (/^https?:\/\//i.test(source) || /^\//.test(source)) {
    return normalizeFeaturedImage({ service: 'IMAGE', name: fallbackName || '', identifier: source, url: source });
  }
  return null;
}

function pathnameOf(value) {
  try {
    return new URL(value, 'https://qms.invalid').pathname;
  } catch {
    return null;
  }
}

/**
 * Resolve an <img src> to a known QDN image reference. Exact source URLs and
 * path-only matches are both supported so imported media maps keep working.
 */
export function resolveImageReference(src, dataset) {
  const source = String(src || '').trim();
  if (!source) return null;
  const direct = parseImageReference(source);
  if (direct && direct.identifier && direct.identifier !== source) return direct;

  const media = Array.isArray(dataset && dataset.media) ? dataset.media : [];
  for (const entry of media) {
    if (!entry) continue;
    if (entry.url === source && entry.qdn) return normalizeFeaturedImage({ ...entry.qdn, alt: entry.alt });
  }
  const bySourceUrl = dataset && dataset.urls && dataset.urls.bySourceUrl ? dataset.urls.bySourceUrl : {};
  if (bySourceUrl[source]) return normalizeFeaturedImage(bySourceUrl[source]);
  const path = pathnameOf(source);
  if (path) {
    for (const [url, ref] of Object.entries(bySourceUrl)) {
      if (pathnameOf(url) === path) return normalizeFeaturedImage(ref);
    }
  }
  return direct && direct.url === source ? direct : null;
}

/** Deterministic rejection of images that must not become a featured image. */
export function isUnsuitableImage(candidate = {}) {
  const src = String(candidate.src || '').trim();
  if (!src) return true;
  if (UNSUPPORTED_SCHEME.test(src)) return true;
  if (VIDEO_EXTENSION.test(src)) return true;
  if (/\.svg(?:[?#]|$)/i.test(src)) return true;
  if (TRACKING_NAME.test(src)) return true;
  if (ICON_NAME.test(src)) return true;
  const width = finite(candidate.width);
  const height = finite(candidate.height);
  if (width !== null && width < 48) return true;
  if (height !== null && height < 48) return true;
  const query = String(candidate.src || '').toLowerCase();
  if (/[?&](?:w|width|h|height)=1(?:&|$)/.test(query)) return true;
  if (!IMAGE_EXTENSION.test(src) && !/^\/arbitrary\//i.test(src) && !/^qortal:\/\//i.test(src) && !/^https?:\/\//i.test(src)) {
    return true;
  }
  return false;
}

function htmlImages(html) {
  const source = String(html || '');
  if (!source) return [];
  if (typeof DOMParser === 'undefined') return [];
  try {
    const document = new DOMParser().parseFromString('<!doctype html><html><body>' + source + '</body></html>', 'text/html');
    return Array.from(document.body.querySelectorAll('img')).map((image) => ({
      src: image.getAttribute('src') || '',
      alt: image.getAttribute('alt') || '',
      width: image.getAttribute('width'),
      height: image.getAttribute('height'),
      className: image.getAttribute('class') || ''
    }));
  } catch {
    return [];
  }
}

/**
 * First suitable image in the post body. Returns a normalized view:
 * { ref, url, alt, source: 'body' } or null.
 */
export function autoFeaturedImage(html, dataset, options = {}) {
  const fallbackName = options.name || (dataset && dataset.site && dataset.site.ownerName) || '';
  for (const image of htmlImages(html)) {
    if (isUnsuitableImage(image)) continue;
    const resolved = resolveImageReference(image.src, dataset);
    if (resolved && resolved.identifier && resolved.identifier !== image.src) {
      return {
        ref: normalizeFeaturedImage({ ...resolved, alt: resolved.alt || image.alt || null }),
        url: options.createUrl ? options.createUrl(resolved.service, resolved.name || fallbackName, resolved.identifier) : '',
        alt: resolved.alt || image.alt || '',
        source: FEATURED_IMAGE_SOURCES.BODY
      };
    }
    if (/^https?:\/\//i.test(image.src)) {
      return {
        ref: null,
        url: image.src,
        alt: image.alt || '',
        source: FEATURED_IMAGE_SOURCES.BODY
      };
    }
  }
  return null;
}

/**
 * Effective featured image for preview and publication.
 *
 * Explicit and WordPress-provided images are preserved. An automatically
 * chosen image is recomputed from the current body every time so removing the
 * source image cannot leave a stale featured image behind.
 */
export function resolveFeaturedImage(draft, dataset, options = {}) {
  if (!draft) return { ref: null, url: '', alt: '', source: FEATURED_IMAGE_SOURCES.NONE };
  if (draft.featuredImageSuppressed === true) {
    return { ref: null, url: '', alt: '', source: FEATURED_IMAGE_SOURCES.NONE };
  }
  const origin = String(draft.featuredImageOrigin || '');
  const stored = normalizeFeaturedImage(draft.featuredImage);
  if (origin === FEATURED_IMAGE_SOURCES.BODY) {
    return autoFeaturedImage(draft.html, dataset, options)
      || { ref: null, url: '', alt: '', source: FEATURED_IMAGE_SOURCES.NONE };
  }
  if (stored) {
    return {
      ref: stored,
      url: draft.featuredImageUrl || stored.url || '',
      alt: draft.featuredImageAlt || stored.alt || '',
      source: origin || (draft.featuredImageManual ? FEATURED_IMAGE_SOURCES.EXPLICIT : FEATURED_IMAGE_SOURCES.PUBLISHED)
    };
  }
  if (draft.featuredImageUrl) {
    return {
      ref: null,
      url: String(draft.featuredImageUrl),
      alt: draft.featuredImageAlt || '',
      source: origin || FEATURED_IMAGE_SOURCES.BODY
    };
  }
  return autoFeaturedImage(draft.html, dataset, options)
    || { ref: null, url: '', alt: '', source: FEATURED_IMAGE_SOURCES.NONE };
}

/** Persistable native-index / overlay-entry fields. */
export function featuredImageEntryFields(view) {
  if (!view || (!view.ref && !view.url)) {
    return { featured_image: null, featured_image_url: null, featured_image_alt: null, featured_image_source: null };
  }
  return {
    featured_image: view.ref || null,
    featured_image_url: view.url || null,
    featured_image_alt: view.alt || null,
    featured_image_source: view.source || null
  };
}

/** media.featured entry for qms-qdn-content@1. */
export function featuredMediaEntry(view, qdnName) {
  if (!view || (!view.ref && !view.url)) return null;
  if (view.ref) {
    return {
      service: view.ref.service || 'IMAGE',
      name: view.ref.name || qdnName || '',
      identifier: view.ref.identifier,
      url: view.url || '',
      role: 'featured',
      alt: view.alt || view.ref.alt || null,
      mime_type: view.ref.mimeType || null,
      width: view.ref.width,
      height: view.ref.height
    };
  }
  return {
    service: 'IMAGE',
    name: qdnName || '',
    identifier: '',
    url: view.url,
    role: 'featured',
    alt: view.alt || null
  };
}

/** Render URL for a catalog item (QDN reference first, external fallback). */
export function featuredImageUrlForItem(item, dataset) {
  if (!item) return '';
  if (item.featuredImageRef && item.featuredImageRef.identifier) {
    const name = item.featuredImageRef.name || (dataset && dataset.site && dataset.site.ownerName) || '';
    return createQdnResourceUrl(item.featuredImageRef.service || 'IMAGE', name, item.featuredImageRef.identifier);
  }
  return item.featuredImageUrl ? String(item.featuredImageUrl) : '';
}

/** True when a published item carries a usable featured image. */
export function hasFeaturedImage(item) {
  return Boolean(item && ((item.featuredImageRef && item.featuredImageRef.identifier) || item.featuredImageUrl));
}
