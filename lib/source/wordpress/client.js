import * as cheerio from 'cheerio';
import {
  SourceError,
  SOURCE_ERROR_CODES,
  httpError,
  throwIfAborted
} from '../errors.js';

export const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_PAGE_SIZE = 100;

function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SourceError(SOURCE_ERROR_CODES.INVALID_CONFIG, 'WordPress base URL is required.', {
      details: { field: 'baseUrl' }
    });
  }
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch (error) {
    throw new SourceError(SOURCE_ERROR_CODES.INVALID_CONFIG, 'WordPress base URL is not a valid URL.', {
      cause: error,
      details: { baseUrl: value }
    });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new SourceError(SOURCE_ERROR_CODES.INVALID_CONFIG, 'WordPress base URL must use http or https.', {
      details: { baseUrl: value }
    });
  }
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/+$/, '');
}

function parseIntegerHeader(value) {
  if (value === null || value === undefined || !/^\d+$/.test(String(value).trim())) {
    return null;
  }
  return Number(value);
}

function parseRetryAfter(value) {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function hasNextLink(header) {
  return typeof header === 'string' && /<[^>]+>\s*;\s*rel="?next"?/i.test(header);
}

/**
 * Minimal, deterministic WordPress REST client used only by the WordPress
 * adapter. It never logs or serializes credentials, and exposes structured
 * retry metadata for a future engine-level retry/backoff policy.
 */
export class WordPressClient {
  constructor({
    baseUrl,
    auth = { mode: 'none' },
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    userAgent = 'Qortal-Migration-Studio-WordPress-Adapter/1.0',
    maxRetries = 0,
    retryDelayMs = 250
  } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.auth = { mode: 'none', ...(auth ?? {}) };
    this.timeoutMs = Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
    this.fetchImpl = fetchImpl;
    this.userAgent = userAgent;
    this.maxRetries = Number.isInteger(maxRetries) && maxRetries > 0 ? maxRetries : 0;
    this.retryDelayMs = retryDelayMs;
    this.cookies = new Map();
    this.sessionAuthenticated = false;
    this.requestCount = 0;
    this.lastCollectionMeta = null;
    this._validateAuth();
  }

  _validateAuth() {
    const mode = this.auth.mode ?? 'none';
    if (!['none', 'application_password', 'session'].includes(mode)) {
      throw new SourceError(
        SOURCE_ERROR_CODES.UNSUPPORTED_AUTH,
        `Unsupported WordPress authentication mode: ${mode}`,
        { details: { mode, supported: ['none', 'application_password', 'session'] } }
      );
    }
    if (mode === 'application_password') {
      if (!this.auth.username || !this.auth.appPassword) {
        throw new SourceError(
          SOURCE_ERROR_CODES.AUTH_REQUIRED,
          'Application-password authentication requires username and application password.',
          { details: { mode } }
        );
      }
    }
    if (mode === 'session' && (!this.auth.username || !this.auth.password)) {
      throw new SourceError(
        SOURCE_ERROR_CODES.AUTH_REQUIRED,
        'Session authentication requires username and password.',
        { details: { mode } }
      );
    }
  }

  authSummary() {
    return { mode: this.auth.mode ?? 'none', authenticated: this.auth.mode === 'none' || this.sessionAuthenticated || Boolean(this.auth.appPassword) };
  }

  _headers({ accept = 'application/json', contentType = null } = {}) {
    const headers = {
      Accept: accept,
      'User-Agent': this.userAgent
    };
    if (contentType) {
      headers['Content-Type'] = contentType;
    }
    if (this.auth.mode === 'application_password') {
      const token = Buffer.from(`${this.auth.username}:${this.auth.appPassword}`, 'utf8').toString('base64');
      headers.Authorization = `Basic ${token}`;
    }
    if (this.auth.mode === 'token' && this.auth.token) {
      headers.Authorization = `Bearer ${this.auth.token}`;
    }
    const cookieHeader = this._cookieHeader();
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }
    return headers;
  }

  _cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  _storeCookies(response) {
    const values = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    for (const cookie of values) {
      const pair = String(cookie).split(';', 1)[0];
      const index = pair.indexOf('=');
      if (index > 0) {
        this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
    }
  }

  _hasLoggedInCookie() {
    return [...this.cookies.keys()].some((name) => name.startsWith('wordpress_logged_in_'));
  }

  async _fetch(url, options, signal) {
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort('cancelled');
    if (signal) {
      if (signal.aborted) {
        throwIfAborted(signal);
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort('timeout');
    }, this.timeoutMs);
    this.requestCount += 1;
    try {
      const response = await this.fetchImpl(url, { ...options, signal: controller.signal, redirect: options.redirect ?? 'follow' });
      return response;
    } catch (error) {
      if (timedOut) {
        throw new SourceError(SOURCE_ERROR_CODES.TIMEOUT, `WordPress request timed out after ${this.timeoutMs} ms.`, {
          cause: error,
          retryable: true,
          details: { timeoutMs: this.timeoutMs }
        });
      }
      if (signal?.aborted) {
        throw new SourceError(SOURCE_ERROR_CODES.CANCELLED, 'Source operation was cancelled.', {
          cause: error,
          retryable: true
        });
      }
      throw new SourceError(SOURCE_ERROR_CODES.NETWORK_ERROR, 'Could not reach the WordPress site.', {
        cause: error,
        retryable: true,
        details: { reason: error?.cause?.code ?? error?.name ?? 'network' }
      });
    } finally {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  }

  async authenticate(signal) {
    if (this.auth.mode !== 'session' || this.sessionAuthenticated) {
      return;
    }
    throwIfAborted(signal);
    const loginUrl = new URL(this.auth.loginUrl || '/login/', `${this.baseUrl}/`);
    const page = await this._fetch(loginUrl, {
      headers: this._headers({ accept: 'text/html' }),
      redirect: 'manual'
    }, signal);
    this._storeCookies(page);
    const html = await page.text();
    const $ = cheerio.load(html);
    const form = $('#loginform');
    if (!form.length) {
      throw new SourceError(SOURCE_ERROR_CODES.CONNECTION_FAILED, 'Could not find the WordPress login form.', {
        details: { loginUrl: loginUrl.toString() }
      });
    }
    const body = new URLSearchParams();
    form.find('input').each((_, element) => {
      const name = $(element).attr('name');
      const value = $(element).attr('value');
      if (name && value !== undefined) {
        body.set(name, value);
      }
    });
    body.set('log', this.auth.username);
    body.set('pwd', this.auth.password);
    body.set('rememberme', 'forever');
    const action = new URL(form.attr('action') || loginUrl.toString(), loginUrl);
    const response = await this._fetch(action, {
      method: 'POST',
      headers: {
        ...this._headers({ accept: 'text/html', contentType: 'application/x-www-form-urlencoded' }),
        Cookie: this._cookieHeader()
      },
      body,
      redirect: 'manual'
    }, signal);
    this._storeCookies(response);
    if (!this._hasLoggedInCookie()) {
      throw new SourceError(SOURCE_ERROR_CODES.AUTH_FAILED, 'WordPress session login failed.', {
        details: { loginUrl: loginUrl.toString() }
      });
    }
    this.sessionAuthenticated = true;
  }

  buildUrl(pathOrUrl, query = {}) {
    const url = /^https?:\/\//i.test(pathOrUrl)
      ? new URL(pathOrUrl)
      : new URL(`${this.baseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`);
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(name, String(value));
      }
    }
    return url;
  }

  async request(pathOrUrl, { query = {}, signal = null, allowStatuses = [], headers = {}, method = 'GET', body = undefined } = {}) {
    throwIfAborted(signal);
    await this.authenticate(signal);
    const url = this.buildUrl(pathOrUrl, query);
    let lastError = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0) {
        const delay = lastError?.retryAfterMs ?? this.retryDelayMs * attempt;
        await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 30_000)));
        throwIfAborted(signal);
      }
      const response = await this._fetch(url, {
        method,
        headers: { ...this._headers(), ...headers },
        body
      }, signal);
      this._storeCookies(response);
      const text = await response.text();
      let data = null;
      if (text.trim() !== '') {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      if (response.ok || allowStatuses.includes(response.status)) {
        return {
          data,
          status: response.status,
          headers: response.headers,
          url,
          text
        };
      }
      const error = httpError(response.status, response.statusText, {
        body: text,
        url: url.toString(),
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after'))
      });
      lastError = error;
      if (!error.retryable || attempt >= this.maxRetries) {
        throw error;
      }
    }
    throw lastError;
  }

  async requestJson(pathOrUrl, options = {}) {
    const response = await this.request(pathOrUrl, options);
    if (response.data === null) {
      throw new SourceError(SOURCE_ERROR_CODES.INVALID_RESPONSE, 'WordPress returned a non-JSON response.', {
        details: { url: response.url.toString(), status: response.status, body: response.text.slice(0, 200) }
      });
    }
    return response;
  }

  async getSiteInfo(options = {}) {
    const response = await this.requestJson('/wp-json/', options);
    if (!response.data || typeof response.data !== 'object' || Array.isArray(response.data)) {
      throw new SourceError(SOURCE_ERROR_CODES.INVALID_RESPONSE, 'WordPress REST root is not an object.', {
        details: { url: response.url.toString() }
      });
    }
    return response.data;
  }

  async getTypes(options = {}) {
    const response = await this.requestJson('/wp-json/wp/v2/types', options);
    if (!response.data || typeof response.data !== 'object' || Array.isArray(response.data)) {
      throw new SourceError(SOURCE_ERROR_CODES.INVALID_RESPONSE, 'WordPress types endpoint is not an object.');
    }
    return response.data;
  }

  async *iterateCollectionPages(endpoint, {
    perPage = MAX_PAGE_SIZE,
    page = 1,
    offset = null,
    query = {},
    signal = null,
    maxPages = 100_000,
    allowNotFound = false
  } = {}) {
    const pageSize = Math.max(1, Math.min(Number(perPage) || MAX_PAGE_SIZE, MAX_PAGE_SIZE));
    let currentPage = Math.max(1, page);
    let pages = 0;
    while (pages < maxPages) {
      throwIfAborted(signal);
      const pageQuery = {
        per_page: pageSize,
        ...(offset === null ? { page: currentPage } : { offset: offset + pages * pageSize }),
        ...query
      };
      let response;
      try {
        response = await this.requestJson(endpoint, { query: pageQuery, signal, allowStatuses: allowNotFound ? [404] : [] });
      } catch (error) {
        if (error instanceof SourceError && error.httpStatus === 400 && String(error.details?.body ?? '').includes('rest_post_invalid_page_number')) {
          return;
        }
        if (allowNotFound && error instanceof SourceError && error.httpStatus === 404) {
          return;
        }
        throw error;
      }
      if (response.status === 404) {
        return;
      }
      if (!Array.isArray(response.data)) {
        throw new SourceError(SOURCE_ERROR_CODES.INVALID_RESPONSE, `Expected a WordPress collection at ${endpoint}.`, {
          details: { endpoint, status: response.status }
        });
      }
      const total = parseIntegerHeader(response.headers.get('x-wp-total'));
      const totalPages = parseIntegerHeader(response.headers.get('x-wp-totalpages'));
      const next = hasNextLink(response.headers.get('link'));
      const meta = { page: currentPage, offset: offset === null ? null : offset + pages * pageSize, total, totalPages, count: response.data.length };
      this.lastCollectionMeta = meta;
      yield { items: response.data, meta };
      pages += 1;
      currentPage += 1;
      if (response.data.length === 0) {
        if (totalPages !== null && pages < totalPages) {
          continue;
        }
        return;
      }
      if (totalPages !== null ? pages >= totalPages : next ? false : response.data.length < pageSize) {
        return;
      }
    }
  }

  async *iterateCollection(endpoint, options = {}) {
    for await (const page of this.iterateCollectionPages(endpoint, options)) {
      for (const item of page.items) {
        yield item;
      }
    }
  }

  async countCollection(endpoint, { query = {}, signal = null } = {}) {
    const response = await this.requestJson(endpoint, {
      query: { per_page: 1, ...query },
      signal,
      allowStatuses: [400, 404]
    });
    if (response.status === 404 || response.status === 400) {
      return null;
    }
    return parseIntegerHeader(response.headers.get('x-wp-total'));
  }

  async getMedia(id, options = {}) {
    return (await this.requestJson(`/wp-json/wp/v2/media/${encodeURIComponent(String(id))}`, options)).data;
  }
}

export { normalizeBaseUrl, parseRetryAfter };
