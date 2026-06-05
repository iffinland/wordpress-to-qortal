import * as cheerio from 'cheerio';

export class WordPressApiError extends Error {
  constructor({ status, statusText, body, url }) {
    super(`WordPress API request failed: ${status} ${statusText} ${body}`);
    this.name = 'WordPressApiError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
    this.url = url;
  }
}

export class WordPressClient {
  constructor({
    baseUrl,
    authMode = 'application_password',
    loginUrl = '/login/',
    username = '',
    appPassword = '',
    password = ''
  }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authMode = authMode;
    this.loginUrl = loginUrl;
    this.username = username;
    this.appPassword = appPassword;
    this.password = password;
    this.cookies = new Map();
    this.sessionAuthenticated = false;
  }

  hasAuth() {
    if (this.authMode === 'session') {
      return Boolean(this.username && this.password);
    }

    return Boolean(this.username && this.appPassword);
  }

  getHeaders() {
    const headers = {
      Accept: 'application/json'
    };

    if (this.authMode === 'application_password' && this.hasAuth()) {
      const token = Buffer.from(`${this.username}:${this.appPassword}`).toString('base64');
      headers.Authorization = `Basic ${token}`;
    }

    const cookieHeader = this.getCookieHeader();
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    return headers;
  }

  async authenticate() {
    if (this.authMode !== 'session' || this.sessionAuthenticated) {
      return;
    }

    if (!this.hasAuth()) {
      throw new Error('Session authentication requires WORDPRESS_USERNAME and WORDPRESS_PASSWORD.');
    }

    const loginUrl = new URL(this.loginUrl, `${this.baseUrl}/`);
    const loginPageResponse = await fetch(loginUrl, {
      headers: { Accept: 'text/html' },
      redirect: 'manual'
    });
    this.storeResponseCookies(loginPageResponse);

    const loginHtml = await loginPageResponse.text();
    const $ = cheerio.load(loginHtml);
    const form = $('#loginform');

    if (!form.length) {
      throw new Error('Could not find the WordPress login form.');
    }

    const formData = new URLSearchParams();
    form.find('input').each((_, element) => {
      const name = $(element).attr('name');
      const value = $(element).attr('value');

      if (name && value !== undefined) {
        formData.set(name, value);
      }
    });
    formData.set('log', this.username);
    formData.set('pwd', this.password);
    formData.set('rememberme', 'forever');

    const actionUrl = new URL(form.attr('action') || loginUrl.toString(), loginUrl);
    const loginResponse = await fetch(actionUrl, {
      method: 'POST',
      headers: {
        Accept: 'text/html',
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: this.getCookieHeader()
      },
      body: formData,
      redirect: 'manual'
    });
    this.storeResponseCookies(loginResponse);

    if (!this.hasLoggedInCookie()) {
      const responseHtml = await loginResponse.text();
      const errorMessage = cheerio.load(responseHtml)('#login_error').text().replace(/\s+/g, ' ').trim();
      throw new Error(errorMessage || 'WordPress session login failed.');
    }

    this.sessionAuthenticated = true;
  }

  storeResponseCookies(response) {
    const setCookies =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie')].filter(Boolean);

    for (const cookie of setCookies) {
      const pair = cookie.split(';', 1)[0];
      const separatorIndex = pair.indexOf('=');

      if (separatorIndex > 0) {
        this.cookies.set(pair.slice(0, separatorIndex), pair.slice(separatorIndex + 1));
      }
    }
  }

  getCookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  hasLoggedInCookie() {
    return [...this.cookies.keys()].some((name) => name.startsWith('wordpress_logged_in_'));
  }

  async fetchRoot() {
    return this.fetchJson(new URL(`${this.baseUrl}/wp-json/`));
  }

  async fetchPosts({ limit = 5, offset = 0, before = '', after = '', order = 'desc' } = {}) {
    return this.fetchCollection('/wp-json/wp/v2/posts', {
      limit,
      offset,
      query: {
        order,
        orderby: 'date',
        ...(before ? { before } : {}),
        ...(after ? { after } : {})
      }
    });
  }

  async fetchPages({ limit = 5 } = {}) {
    return this.fetchCollection('/wp-json/wp/v2/pages', { limit });
  }

  async fetchCategories({ limit = 100 } = {}) {
    return this.fetchCollection('/wp-json/wp/v2/categories', { limit });
  }

  async fetchTags({ limit = 100 } = {}) {
    return this.fetchCollection('/wp-json/wp/v2/tags', { limit });
  }

  async fetchMedia({ limit = 100, parent } = {}) {
    return this.fetchCollection('/wp-json/wp/v2/media', {
      limit,
      query: parent ? { parent: String(parent) } : {}
    });
  }

  async fetchMediaItem(id) {
    return this.fetchJson(new URL(`${this.baseUrl}/wp-json/wp/v2/media/${id}`));
  }

  async fetchMediaForPosts(posts) {
    const mediaById = new Map();

    for (const post of posts) {
      const attachments = await this.fetchMedia({ limit: 1000, parent: post.id });

      for (const attachment of attachments) {
        mediaById.set(attachment.id, attachment);
      }
    }

    const featuredIds = [...new Set(posts.map((post) => post.featured_media).filter(Boolean))];

    for (const mediaId of featuredIds) {
      if (!mediaById.has(mediaId)) {
        mediaById.set(mediaId, await this.fetchMediaItem(mediaId));
      }
    }

    return [...mediaById.values()];
  }

  async fetchCollection(endpoint, { limit = 100, offset = 0, query = {} } = {}) {
    const items = [];
    const perPage = Math.min(limit, 100);
    let page = 1;

    while (items.length < limit) {
      const url = new URL(`${this.baseUrl}${endpoint}`);
      url.searchParams.set('per_page', String(perPage));
      if (offset > 0) {
        url.searchParams.set('offset', String(offset + items.length));
      } else {
        url.searchParams.set('page', String(page));
      }
      Object.entries(query).forEach(([name, value]) => url.searchParams.set(name, value));

      let pageItems;

      try {
        pageItems = await this.fetchJson(url);
      } catch (error) {
        if (page > 1 && error.status === 400 && error.body?.includes('rest_post_invalid_page_number')) {
          break;
        }

        throw error;
      }

      if (!Array.isArray(pageItems) || pageItems.length === 0) {
        break;
      }

      items.push(...pageItems);

      if (pageItems.length < perPage) {
        break;
      }

      page += 1;
    }

    return items.slice(0, limit);
  }

  async fetchJson(url) {
    await this.authenticate();

    const response = await fetch(url, {
      headers: this.getHeaders()
    });

    if (!response.ok) {
      const body = await response.text();
      throw new WordPressApiError({
        status: response.status,
        statusText: response.statusText,
        body,
        url: url.toString()
      });
    }

    return response.json();
  }
}
