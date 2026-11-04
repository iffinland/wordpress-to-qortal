import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';

/**
 * Universal content model for Qortal Migration Studio.
 *
 * qms-content@1 is source-neutral: adapters own source-specific payloads under
 * `source.extra`, and nothing in this module knows about WordPress, Qortal or
 * QDN publishing.
 */
export const CONTENT_SCHEMA = 'qms-content@1';
export const CONTENT_VERSION = 1;
export const HASH_ALGORITHM = 'qms-content-hash@1';
export const HASH_PROJECTION_VERSION = 1;
export const HTML_CANONICALIZATION = 'qms-html@1';

const ABSOLUTE_ATTRIBUTES = Object.freeze({
  a: ['href'],
  area: ['href'],
  audio: ['src'],
  embed: ['src'],
  iframe: ['src'],
  img: ['src'],
  object: ['data'],
  source: ['src'],
  track: ['src'],
  video: ['src', 'poster']
});

const SRCSET_ATTRIBUTES = Object.freeze(['srcset', 'data-srcset', 'imagesrcset']);
const NON_RESOLVABLE_PROTOCOL = /^(?:#|data:|mailto:|tel:|javascript:|blob:)/i;

export function sha256Text(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function sha256Value(value) {
  return `sha256:${sha256Text(typeof value === 'string' ? value : stableStringify(value))}`;
}

/** Deterministic JSON: object keys sorted recursively, undefined omitted. */
export function stableStringify(value) {
  const seen = new WeakSet();
  const normalize = (input) => {
    if (input === null || typeof input === 'number' || typeof input === 'boolean' || typeof input === 'string') {
      return input;
    }
    if (input === undefined) {
      return undefined;
    }
    if (typeof input === 'bigint') {
      return String(input);
    }
    if (typeof input !== 'object') {
      return String(input);
    }
    if (seen.has(input)) {
      throw new TypeError('Cannot canonicalize a cyclic value.');
    }
    seen.add(input);
    let output;
    if (Array.isArray(input)) {
      output = input.map(normalize).filter((entry) => entry !== undefined);
    } else {
      output = {};
      for (const key of Object.keys(input).sort()) {
        const normalized = normalize(input[key]);
        if (normalized !== undefined) {
          output[key] = normalized;
        }
      }
    }
    seen.delete(input);
    return output;
  };
  return JSON.stringify(normalize(value));
}

function resolveUrl(value, baseUrl) {
  if (typeof value !== 'string' || value === '' || !baseUrl) {
    return value;
  }
  if (NON_RESOLVABLE_PROTOCOL.test(value.trim())) {
    return value;
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function canonicalizeSrcset(value, baseUrl) {
  if (typeof value !== 'string') {
    return value;
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [url, ...descriptor] = entry.split(/\s+/);
      return [resolveUrl(url, baseUrl), ...descriptor].join(' ');
    })
    .join(', ');
}

/**
 * Canonical HTML used only for deterministic hashing and comparison.
 * The original rendered HTML is always preserved in `body.html`; this function
 * never replaces stored content. It normalizes entities, line endings,
 * inter-tag whitespace and relative URLs, and removes comments.
 */
export function canonicalizeHtml(html = '', { baseUrl = null } = {}) {
  if (typeof html !== 'string') {
    return '';
  }
  const $ = cheerio.load(html, { decodeEntities: true }, false);
  $('*')
    .contents()
    .filter((_, node) => node.type === 'comment')
    .remove();

  $('*').each((_, element) => {
    const tag = String(element.tagName || '').toLowerCase();
    const node = $(element);
    for (const attribute of ABSOLUTE_ATTRIBUTES[tag] ?? []) {
      const value = node.attr(attribute);
      if (value !== undefined) {
        node.attr(attribute, resolveUrl(value, baseUrl));
      }
    }
    for (const attribute of SRCSET_ATTRIBUTES) {
      const value = node.attr(attribute);
      if (value !== undefined) {
        node.attr(attribute, canonicalizeSrcset(value, baseUrl));
      }
    }
    const lazy = node.attr('data-src') ?? node.attr('data-lazy-src');
    if (tag === 'img' && lazy && !node.attr('src')) {
      node.attr('src', resolveUrl(lazy, baseUrl));
    }
  });

  return $.html()
    .replace(/\r\n?/g, '\n')
    .replace(/>\s+</g, '><')
    .trim();
}

export function canonicalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const text = String(value).trim();
  const candidate = /(?:z|[+-]\d\d:\d\d)$/i.test(text) ? text : `${text}Z`;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function contentId(adapterId, contentType, sourceKey) {
  const clean = (value) => String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  void contentType;
  const id = ['src', clean(adapterId), clean(sourceKey)].filter(Boolean).join('_');
  return id.slice(0, 160);
}

function uniqueSorted(values, selector = (value) => value) {
  const map = new Map();
  for (const value of values ?? []) {
    if (value === null || value === undefined) {
      continue;
    }
    const key = selector(value);
    if (!map.has(key)) {
      map.set(key, value);
    }
  }
  return [...map.entries()].sort(([left], [right]) => String(left).localeCompare(String(right))).map(([, value]) => value);
}

function normalizeAuthor(author) {
  return {
    role: author?.role ?? 'source',
    name: canonicalizeText(author?.name) || null,
    source_id: author?.source_id === null || author?.source_id === undefined ? null : String(author.source_id)
  };
}

function normalizeTerm(term) {
  return {
    key: term?.key ?? null,
    source_id: term?.source_id === null || term?.source_id === undefined ? null : String(term.source_id),
    slug: term?.slug ?? null,
    name: canonicalizeText(term?.name) || null
  };
}

function normalizeMediaEntry(entry) {
  if (!entry) {
    return null;
  }
  const normalized = {
    key: entry.key ?? null,
    source_id: entry.source_id === null || entry.source_id === undefined ? null : String(entry.source_id),
    url: entry.url ?? null,
    resolved_url: entry.resolved_url ?? entry.url ?? null,
    role: entry.role ?? null,
    mime_type: entry.mime_type ?? null,
    title: canonicalizeText(entry.title) || null,
    alt: canonicalizeText(entry.alt) || null,
    width: Number.isFinite(entry.width) ? entry.width : null,
    height: Number.isFinite(entry.height) ? entry.height : null,
    lazy: Boolean(entry.lazy),
    external: Boolean(entry.external),
    srcset: Array.isArray(entry.srcset) ? entry.srcset.filter((value) => typeof value === 'string').sort() : []
  };
  return normalized;
}

function normalizeMediaList(entries) {
  const normalized = (entries ?? [])
    .map(normalizeMediaEntry)
    .filter(Boolean)
    .filter((entry) => entry.url || entry.source_id);
  return uniqueSorted(normalized, (entry) => entry.key ?? `${entry.source_id ?? ''}|${entry.resolved_url ?? entry.url ?? ''}`);
}

function sortedStrings(values) {
  return uniqueSorted((values ?? []).filter((value) => typeof value === 'string' && value !== ''), (value) => value);
}

/**
 * The semantic projection hashed by qms-content@1. Identity, slugs, raw source
 * metadata, provenance timestamps and modified-at are intentionally excluded:
 * a slug rename or a non-semantic API mutation must not create a false revision.
 * Published date and publication status are included because they change the
 * migrated meaning of the item.
 */
export function canonicalProjection(document, { baseUrl = null } = {}) {
  const body = document.body ?? {};
  const resolutionBase = baseUrl ?? document.source?.site ?? null;
  return {
    projection: HASH_PROJECTION_VERSION,
    hash_algorithm: HASH_ALGORITHM,
    schema: CONTENT_SCHEMA,
    content_type: document.content_type ?? null,
    title: canonicalizeText(document.title),
    body: {
      format: body.format ?? 'html',
      html: canonicalizeHtml(body.html ?? '', { baseUrl: resolutionBase }),
      text: canonicalizeText(body.text),
      excerpt_html: canonicalizeHtml(body.excerpt_html ?? '', { baseUrl: resolutionBase }),
      excerpt_text: canonicalizeText(body.excerpt_text),
      summary: canonicalizeText(body.summary)
    },
    publication_status: document.publication_status ?? null,
    published_at: normalizeTimestamp(document.dates?.published_at),
    authors: uniqueSorted((document.authors ?? []).map(normalizeAuthor), (author) => `${author.role}|${author.source_id ?? ''}|${author.name ?? ''}`),
    terms: {
      categories: uniqueSorted((document.terms?.categories ?? []).map(normalizeTerm), (term) => term.key ?? term.source_id ?? term.slug ?? ''),
      tags: uniqueSorted((document.terms?.tags ?? []).map(normalizeTerm), (term) => term.key ?? term.source_id ?? term.slug ?? '')
    },
    media: {
      featured: normalizeMediaEntry(document.media?.featured ?? null),
      images: normalizeMediaList(document.media?.images),
      audio: normalizeMediaList(document.media?.audio),
      video: normalizeMediaList(document.media?.video),
      documents: normalizeMediaList(document.media?.documents),
      embeds: normalizeMediaList(document.media?.embeds),
      attachments: normalizeMediaList(document.media?.attachments)
    },
    links: {
      internal: sortedStrings(document.links?.internal),
      external: sortedStrings(document.links?.external),
      external_media: sortedStrings(document.links?.external_media)
    }
  };
}

export function computeContentHash(document, options = {}) {
  const projection = canonicalProjection(document, options);
  return sha256Value(projection);
}

export function assertContentDocument(document, { verifyHash = true, baseUrl = null } = {}) {
  const fail = (reason) => {
    throw new TypeError(`Invalid ${CONTENT_SCHEMA}: ${reason}`);
  };
  if (!document || typeof document !== 'object' || Array.isArray(document)) fail('document must be an object');
  if (document.schema !== CONTENT_SCHEMA) fail('schema');
  if (document.version !== CONTENT_VERSION) fail('version');
  if (typeof document.id !== 'string' || !document.id) fail('id');
  if (!document.source || typeof document.source !== 'object') fail('source');
  if (typeof document.source.adapter !== 'string' || !document.source.adapter) fail('source.adapter');
  if (typeof document.source.key !== 'string' || !document.source.key) fail('source.key');
  if (typeof document.content_type !== 'string' || !document.content_type) fail('content_type');
  if (!document.identity || typeof document.identity !== 'object') fail('identity');
  if (!document.body || typeof document.body !== 'object') fail('body');
  if (!document.dates || typeof document.dates !== 'object') fail('dates');
  if (!document.terms || typeof document.terms !== 'object') fail('terms');
  if (!document.media || typeof document.media !== 'object') fail('media');
  if (!document.links || typeof document.links !== 'object') fail('links');
  if (typeof document.content_hash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(document.content_hash)) fail('content_hash');
  if (verifyHash) {
    const expected = computeContentHash(document, { baseUrl });
    if (expected !== document.content_hash) {
      fail(`content_hash mismatch (stored ${document.content_hash}, computed ${expected})`);
    }
  }
  return document;
}
