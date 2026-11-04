import { SOURCE_ADAPTER_CONTRACT, SOURCE_ADAPTER_CONTRACT_VERSION, normalizeCapabilities } from '../contract.js';
import { SourceError, SOURCE_ERROR_CODES, throwIfAborted } from '../errors.js';
import { WordPressClient, MAX_PAGE_SIZE } from './client.js';
import { normalizeMedia, normalizePostOrPage, normalizeTerm, ADAPTER_ID, ADAPTER_VERSION } from './normalize.js';

export const WORDPRESS_CAPABILITIES = normalizeCapabilities({
  contentTypes: ['post', 'page'],
  terms: ['category', 'tag'],
  assets: { images: true, audio: true, video: true, documents: true, embeds: true },
  states: ['publish', 'draft', 'pending', 'private', 'future', 'inherit', 'unknown'],
  incremental: { new: true, modified: true, deleted: false, cursor: 'date' },
  authentication: ['none', 'application_password', 'session'],
  limits: { maxPageSize: MAX_PAGE_SIZE, supportsDateFilters: true, supportsModifiedFilters: true, supportsOffset: true, boundedMemory: true },
  unsupported: {
    customPostTypes: 'reported-with-counts',
    comments: 'reported-not-migrated',
    users: 'reported-not-migrated',
    menus: 'reported-not-migrated',
    widgets: 'reported-not-migrated',
    reusableBlocks: 'reported-not-migrated'
  }
});

const SUPPORTED_CONTENT_TYPES = new Set(['post', 'page']);
const SUPPORTED_TAXONOMIES = new Set(['category', 'tag']);

function isoDate(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new SourceError(SOURCE_ERROR_CODES.INVALID_CONFIG, `${field} must be a valid ISO timestamp.`, {
      details: { field, value }
    });
  }
  return new Date(parsed).toISOString();
}

function normalizeQuery(query = {}) {
  const output = {};
  for (const field of ['after', 'before', 'modified_after', 'modified_before']) {
    const value = isoDate(query[field], field);
    if (value) output[field] = value;
  }
  if (query.order === 'asc' || query.order === 'desc') output.order = query.order;
  if (typeof query.orderby === 'string' && /^[a-z_]+$/.test(query.orderby)) output.orderby = query.orderby;
  if (typeof query.status === 'string' && /^[a-z_,]+$/.test(query.status)) output.status = query.status;
  if (typeof query.search === 'string' && query.search.trim() !== '') output.search = query.search.trim();
  return output;
}

export class WordPressSession {
  constructor({ config, auth, client = null }) {
    this.config = config ?? {};
    this.auth = auth ?? { mode: 'none' };
    this.client = client ?? new WordPressClient({
      baseUrl: this.config.baseUrl,
      auth: this.auth,
      timeoutMs: this.config.timeoutMs,
      maxRetries: this.config.maxRetries ?? 0,
      fetchImpl: this.config.fetchImpl
    });
    this.site = this.config.baseUrl?.toString?.() ?? String(this.config.baseUrl ?? '');
    this._featuredCache = new Map();
    this._warnings = [];
    this._types = null;
    this._closed = false;
  }

  get capabilities() {
    return WORDPRESS_CAPABILITIES;
  }

  warnings() {
    return [...this._warnings];
  }

  _warn(code, message, details = {}) {
    const warning = { code, message, details };
    this._warnings.push(warning);
    return warning;
  }

  async validate({ signal = null } = {}) {
    throwIfAborted(signal);
    const root = await this.client.getSiteInfo({ signal });
    const types = await this._loadTypes({ signal, bestEffort: true });
    const counts = await this.counts({ signal, bestEffort: true });
    const unsupported = await this.describeUnsupported({ signal, types, bestEffort: true });
    const warnings = [...this._warnings];
    if ((this.auth.mode ?? 'none') !== 'none' && !this.client.authSummary().authenticated) {
      warnings.push({ code: 'AUTH_NOT_VERIFIED', message: 'Authentication was configured but not verified.', details: {} });
    }
    return {
      ok: true,
      adapter: ADAPTER_ID,
      adapterVersion: ADAPTER_VERSION,
      contract: SOURCE_ADAPTER_CONTRACT,
      site: {
        name: root.name ?? null,
        description: root.description ?? null,
        url: root.url ?? this.site,
        namespaces: Array.isArray(root.namespaces) ? root.namespaces : []
      },
      auth: this.client.authSummary(),
      capabilities: WORDPRESS_CAPABILITIES,
      counts,
      contentTypes: types ? Object.keys(types) : [],
      unsupported,
      warnings
    };
  }

  async _loadTypes({ signal = null, bestEffort = false } = {}) {
    if (this._types) return this._types;
    try {
      this._types = await this.client.getTypes({ signal });
      return this._types;
    } catch (error) {
      if (bestEffort) {
        this._warn('TYPES_UNAVAILABLE', 'WordPress content types could not be discovered.', {
          code: error.code ?? null
        });
        return null;
      }
      throw error;
    }
  }

  async counts({ signal = null, bestEffort = false } = {}) {
    const counts = {};
    const entries = [
      ['posts', '/wp-json/wp/v2/posts'],
      ['pages', '/wp-json/wp/v2/pages'],
      ['categories', '/wp-json/wp/v2/categories'],
      ['tags', '/wp-json/wp/v2/tags'],
      ['media', '/wp-json/wp/v2/media']
    ];
    for (const [name, endpoint] of entries) {
      try {
        counts[name] = await this.client.countCollection(endpoint, { signal });
      } catch (error) {
        if (!bestEffort) throw error;
        counts[name] = null;
        this._warn('COUNT_UNAVAILABLE', `Could not count ${name}.`, { code: error.code ?? null });
      }
    }
    return counts;
  }

  async describeUnsupported({ signal = null, types = null, bestEffort = true } = {}) {
    const discovered = types ?? await this._loadTypes({ signal, bestEffort });
    const unsupported = [];
    if (discovered) {
      for (const [type, definition] of Object.entries(discovered)) {
        if (SUPPORTED_CONTENT_TYPES.has(type)) continue;
        const restBase = definition?.rest_base ?? null;
        let count = null;
        if (restBase && bestEffort) {
          try {
            count = await this.client.countCollection(`/wp-json/wp/v2/${restBase}`, { signal });
          } catch (error) {
            // Count is advisory; the type is still reported as unsupported.
            count = null;
          }
        }
        unsupported.push({
          code: 'UNSUPPORTED_CONTENT_TYPE',
          type,
          name: definition?.name ?? type,
          restBase,
          count,
          supported: false
        });
      }
    }
    for (const feature of [
      ['comments', 'WordPress comments are not migrated in Phase 2.'],
      ['users', 'WordPress users/authors are represented only by numeric source ids.'],
      ['menus', 'WordPress navigation menus are not migrated in Phase 2.'],
      ['widgets', 'WordPress widgets/sidebars are not migrated in Phase 2.'],
      ['reusableBlocks', 'Reusable block definitions are reported, not migrated.']
    ]) {
      unsupported.push({
        code: 'UNSUPPORTED_SOURCE_FEATURE',
        feature: feature[0],
        message: feature[1],
        supported: false
      });
    }
    return unsupported;
  }

  async *listContent({
    contentTypes = ['post', 'page'],
    perPage = MAX_PAGE_SIZE,
    page = 1,
    offset = null,
    query = {},
    signal = null
  } = {}) {
    throwIfAborted(signal);
    const requested = [...new Set(contentTypes)];
    for (const contentType of requested) {
      if (!SUPPORTED_CONTENT_TYPES.has(contentType)) {
        throw new SourceError(
          SOURCE_ERROR_CODES.UNSUPPORTED_CAPABILITY,
          `Content type is not supported by the WordPress adapter: ${contentType}`,
          { details: { contentType, supported: [...SUPPORTED_CONTENT_TYPES] } }
        );
      }
    }
    const baseQuery = normalizeQuery(query);
    for (const contentType of requested) {
      const endpoint = contentType === 'post' ? '/wp-json/wp/v2/posts' : '/wp-json/wp/v2/pages';
      for await (const raw of this.client.iterateCollection(endpoint, {
        perPage,
        page,
        offset,
        query: baseQuery,
        signal,
        allowNotFound: true
      })) {
        throwIfAborted(signal);
        const featured = await this._featuredMedia(raw.featured_media, signal);
        yield { contentType, rawType: raw.type ?? contentType, raw, featuredMedia: featured };
      }
    }
  }

  async _featuredMedia(id, signal) {
    if (!id) return null;
    if (this._featuredCache.has(id)) {
      return this._featuredCache.get(id);
    }
    try {
      const media = await this.client.getMedia(id, { signal });
      this._featuredCache.set(id, media);
      return media;
    } catch (error) {
      if (error instanceof SourceError && [SOURCE_ERROR_CODES.NOT_FOUND, SOURCE_ERROR_CODES.AUTH_REQUIRED].includes(error.code)) {
        this._featuredCache.set(id, null);
        this._warn('FEATURED_MEDIA_UNAVAILABLE', `Featured media ${id} is not accessible.`, {
          mediaId: id,
          code: error.code
        });
        return null;
      }
      throw error;
    }
  }

  async *listTerms({ taxonomies = ['category', 'tag'], perPage = MAX_PAGE_SIZE, page = 1, offset = null, signal = null } = {}) {
    for (const taxonomy of [...new Set(taxonomies)]) {
      if (!SUPPORTED_TAXONOMIES.has(taxonomy)) {
        throw new SourceError(SOURCE_ERROR_CODES.UNSUPPORTED_CAPABILITY, `Taxonomy is not supported: ${taxonomy}`, {
          details: { taxonomy, supported: [...SUPPORTED_TAXONOMIES] }
        });
      }
      const endpoint = `/wp-json/wp/v2/${taxonomy === 'category' ? 'categories' : 'tags'}`;
      for await (const raw of this.client.iterateCollection(endpoint, {
        perPage,
        page,
        offset,
        signal,
        allowNotFound: true
      })) {
        throwIfAborted(signal);
        yield { taxonomy, raw };
      }
    }
  }

  async *listAssets({ perPage = MAX_PAGE_SIZE, page = 1, offset = null, signal = null } = {}) {
    for await (const raw of this.client.iterateCollection('/wp-json/wp/v2/media', {
      perPage,
      page,
      offset,
      signal,
      allowNotFound: true
    })) {
      throwIfAborted(signal);
      yield { kind: 'media', raw };
    }
  }

  async getMedia(id, { signal = null } = {}) {
    return this.client.getMedia(id, { signal });
  }

  normalizeContent(item, context = {}) {
    return normalizePostOrPage({
      contentType: item.contentType,
      raw: item.raw,
      site: this.client.baseUrl,
      featuredMedia: item.featuredMedia ?? context.featuredMedia ?? null,
      attachments: context.attachments ?? [],
      termLookup: context.termLookup ?? null
    });
  }

  normalizeTerm(item, context = {}) {
    return normalizeTerm({ taxonomy: item.taxonomy, raw: item.raw, site: this.client.baseUrl, ...context });
  }

  normalizeAsset(item, context = {}) {
    return normalizeMedia({ raw: item.raw, site: this.client.baseUrl, ...context });
  }

  collectionMeta() {
    return this.client.lastCollectionMeta;
  }

  async close() {
    this._closed = true;
  }
}

export class WordPressAdapter {
  constructor() {
    this.id = 'wordpress';
    this.displayName = 'WordPress REST API';
    this.version = ADAPTER_VERSION;
    this.contractVersion = SOURCE_ADAPTER_CONTRACT_VERSION;
  }

  getCapabilities() {
    return WORDPRESS_CAPABILITIES;
  }

  async createSession({ config = {}, auth = { mode: 'none' }, signal = null, client = null } = {}) {
    throwIfAborted(signal);
    const session = new WordPressSession({
      config: { ...config, baseUrl: config.baseUrl ?? this.config?.baseUrl },
      auth,
      client
    });
    return session;
  }
}

export function createWordPressAdapter() {
  return new WordPressAdapter();
}

export { SUPPORTED_CONTENT_TYPES, SUPPORTED_TAXONOMIES, normalizeQuery };
