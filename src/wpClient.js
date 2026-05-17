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
  constructor({ baseUrl, username = '', appPassword = '' }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.username = username;
    this.appPassword = appPassword;
  }

  hasAuth() {
    return Boolean(this.username && this.appPassword);
  }

  getHeaders() {
    const headers = {
      Accept: 'application/json'
    };

    if (this.hasAuth()) {
      const token = Buffer.from(`${this.username}:${this.appPassword}`).toString('base64');
      headers.Authorization = `Basic ${token}`;
    }

    return headers;
  }

  async fetchRoot() {
    return this.fetchJson(new URL(`${this.baseUrl}/wp-json/`));
  }

  async fetchPosts({ limit = 5 } = {}) {
    return this.fetchCollection('/wp-json/wp/v2/posts', { limit });
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

  async fetchMedia({ limit = 100 } = {}) {
    return this.fetchCollection('/wp-json/wp/v2/media', { limit });
  }

  async fetchCollection(endpoint, { limit = 100 } = {}) {
    const items = [];
    const perPage = Math.min(limit, 100);
    let page = 1;

    while (items.length < limit) {
      const url = new URL(`${this.baseUrl}${endpoint}`);
      url.searchParams.set('per_page', String(perPage));
      url.searchParams.set('page', String(page));

      const pageItems = await this.fetchJson(url);

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
