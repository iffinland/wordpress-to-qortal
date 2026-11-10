import test from 'node:test';
import assert from 'node:assert/strict';
import { startWordpressFixtureServer, createFixtureData } from '../../test-support/wordpress/fixtureServer.js';
import { createWordPressAdapter } from '../../lib/source/wordpress/index.js';
import { extractHtmlResources } from '../../lib/source/wordpress/extract.js';
import { inspectPostHtml } from '../../src/utils/html.js';
import { SourceAdapterRegistry } from '../../lib/source/registry.js';
import { SourceError, SOURCE_ERROR_CODES } from '../../lib/source/errors.js';
import { assertContentDocument } from '../../lib/model/content.js';

async function fixture(t, options = {}) {
  const server = await startWordpressFixtureServer(options);
  t.after(() => server.close());
  return server;
}

async function session(t, options = {}, sessionOptions = {}) {
  const server = await fixture(t, options);
  const adapter = createWordPressAdapter();
  const instance = await adapter.createSession({
    config: { baseUrl: server.url, timeoutMs: sessionOptions.timeoutMs ?? 2000 },
    auth: sessionOptions.auth ?? { mode: 'none' }
  });
  t.after(() => instance.close());
  return { server, adapter, session: instance };
}

async function collectTerms(session, options = {}) {
  const lookup = new Map();
  const terms = [];
  for await (const item of session.listTerms(options)) {
    terms.push(item);
    lookup.set(`${item.taxonomy}:${item.raw.id}`, { slug: item.raw.slug, name: item.raw.name });
  }
  return { terms, lookup };
}

test('the adapter registry accepts WordPress and rejects contract violations', () => {
  const adapter = createWordPressAdapter();
  const registry = new SourceAdapterRegistry([adapter]);
  assert.deepEqual(registry.ids(), ['wordpress']);
  assert.equal(registry.capabilities().id, 'wordpress');
  assert.equal(registry.capabilities().contract, 'qms-source-adapter@1');
  assert.throws(() => registry.register(adapter), /already registered/);
  assert.throws(() => registry.register({ id: 'broken' }), (error) => error.code === SOURCE_ERROR_CODES.CONTRACT_VIOLATION);
  assert.throws(() => registry.get('joomla'), (error) => error.code === SOURCE_ERROR_CODES.ADAPTER_NOT_FOUND);
});

test('capabilities advertise supported content, auth and unsupported features', () => {
  const capabilities = createWordPressAdapter().getCapabilities();
  assert.deepEqual(capabilities.contentTypes, ['post', 'page']);
  assert.deepEqual(capabilities.terms, ['category', 'tag']);
  assert.deepEqual(capabilities.authentication, ['none', 'application_password', 'session']);
  assert.equal(capabilities.assets.images, true);
  assert.equal(capabilities.incremental.modified, true);
  assert.equal(capabilities.limits.maxPageSize, 100);
  assert.equal(capabilities.unsupported.customPostTypes, 'reported-with-counts');
});

test('public discovery validates the site, counts collections and reports custom types', async (t) => {
  const { session: instance } = await session(t);
  const report = await instance.validate();
  assert.equal(report.ok, true);
  assert.equal(report.site.name, 'Fixture News');
  assert.deepEqual(report.counts, { posts: 3, pages: 2, categories: 2, tags: 2, media: 3 });
  const books = report.unsupported.find((entry) => entry.type === 'book');
  assert.equal(books.count, 3);
  assert.equal(books.supported, false);
  assert.ok(report.unsupported.some((entry) => entry.feature === 'comments'));
});

test('pagination, duplicate slugs and renamed content keep distinct stable identities', async (t) => {
  const { session: instance } = await session(t);
  const { lookup } = await collectTerms(instance, { perPage: 1 });
  const posts = [];
  for await (const item of instance.listContent({ perPage: 2 })) {
    if (item.contentType === 'post') posts.push(instance.normalizeContent(item, { termLookup: lookup }));
  }
  assert.equal(posts.length, 3);
  assert.deepEqual(new Set(posts.map((post) => post.id)).size, 3);
  assert.equal(posts.filter((post) => post.identity.slug === 'duplicate-slug').length, 2);
  assert.notEqual(
    posts.find((post) => post.identity.source_id === '102').id,
    posts.find((post) => post.identity.source_id === '103').id
  );

  const first = posts.find((post) => post.identity.source_id === '101');
  assert.equal(first.identity.source_id, '101');
});

test('renaming a slug updates metadata without creating a new source identity or revision', async (t) => {
  const { server, session: instance } = await session(t);
  const { lookup } = await collectTerms(instance);
  const first = [];
  for await (const item of instance.listContent({ perPage: 2, contentTypes: ['post'] })) {
    if (item.raw.id === 101) first.push(instance.normalizeContent(item, { termLookup: lookup }));
  }
  server.renamePost(101, 'renamed-first-post');
  const second = [];
  for await (const item of instance.listContent({ perPage: 2, contentTypes: ['post'] })) {
    if (item.raw.id === 101) second.push(instance.normalizeContent(item, { termLookup: lookup }));
  }
  assert.equal(first[0].id, second[0].id);
  assert.equal(first[0].content_hash, second[0].content_hash);
  assert.equal(first[0].identity.slug, 'first-post');
  assert.equal(second[0].identity.slug, 'renamed-first-post');
});

test('post normalization preserves entities, lazy/srcset media, relative URLs, links and attachments', async (t) => {
  const { session: instance } = await session(t);
  const { lookup } = await collectTerms(instance);
  let document = null;
  for await (const item of instance.listContent({ perPage: 2 })) {
    if (item.contentType === 'post' && item.raw.id === 101) {
      const assets = [];
      for await (const asset of instance.listAssets({ perPage: 100 })) assets.push(asset.raw);
      document = instance.normalizeContent(item, {
        termLookup: lookup,
        attachments: assets.filter((asset) => asset.post === 101)
      });
    }
  }
  assert.ok(document);
  assert.equal(document.title, 'Corbett’s & News');
  assert.equal(document.identity.source_id, '101');
  assert.equal(document.media.featured.source_id, '301');
  assert.equal(document.media.featured.mime_type, 'image/jpeg');
  const imageUrls = document.media.images.map((entry) => entry.resolved_url);
  assert.ok(imageUrls.includes(`${instance.client.baseUrl}/wp-content/uploads/lazy.jpg`));
  assert.ok(imageUrls.includes(`${instance.client.baseUrl}/wp-content/uploads/lazy-300.jpg`));
  assert.ok(imageUrls.includes(`${instance.client.baseUrl}/wp-content/uploads/one.jpg`));
  assert.ok(imageUrls.includes('https://cdn.example.net/remote.jpg'));
  assert.equal(document.media.audio.length, 1);
  assert.equal(document.media.video.length, 1);
  assert.equal(document.media.documents.length, 1);
  assert.equal(document.media.embeds.length, 1);
  assert.ok(document.links.internal.includes(`${instance.client.baseUrl}/about/`));
  assert.ok(document.links.external.includes('https://example.org/report'));
  assert.ok(document.links.external_media.includes('https://cdn.example.net/remote.jpg'));
  assert.equal(document.media.attachments.length, 2);
  assertContentDocument(document);
});

test('srcset keeps NASA comma-bearing resize URLs intact and never promotes dimensions to media URLs', () => {
  const html = [
    '<img src="https://www.nasa.gov/wp-content/uploads/example.jpg?w=1024"',
    ' srcset="https://www.nasa.gov/wp-content/uploads/example.jpg?resize=300,200 300w,',
    ' https://www.nasa.gov/wp-content/uploads/example.jpg?resize=1024,683 1024w,',
    ' https://www.nasa.gov/wp-content/uploads/example.jpg?resize=1536,1025 1536w">'
  ].join('');
  const urls = extractHtmlResources(html, 'https://nasa.gov').images.map((entry) => entry.resolved_url);
  assert.deepEqual(urls, [
    'https://www.nasa.gov/wp-content/uploads/example.jpg?w=1024',
    'https://www.nasa.gov/wp-content/uploads/example.jpg?resize=300,200',
    'https://www.nasa.gov/wp-content/uploads/example.jpg?resize=1024,683',
    'https://www.nasa.gov/wp-content/uploads/example.jpg?resize=1536,1025'
  ]);
  assert.deepEqual(inspectPostHtml(html, 'https://nasa.gov').images, urls);
  assert.equal(urls.some((url) => /^https:\/\/nasa\.gov\/\d+\/?$/.test(url)), false);
});

test('missing featured media is an explicit warning, not silent data loss', async (t) => {
  const { session: instance } = await session(t);
  const { lookup } = await collectTerms(instance);
  let document = null;
  for await (const item of instance.listContent({ perPage: 2 })) {
    if (item.raw.id === 103) document = instance.normalizeContent(item, { termLookup: lookup });
  }
  assert.ok(document);
  assert.equal(document.media.featured, null);
  assert.ok(document.warnings.some((warning) => warning.code === 'FEATURED_MEDIA_UNAVAILABLE'));
});

test('empty middle pages do not hide later pages', async (t) => {
  const { server, session: instance } = await session(t, { emptyMiddlePage: true });
  const posts = [];
  for await (const item of instance.listContent({ perPage: 1, contentTypes: ['post'] })) posts.push(item.raw.id);
  assert.ok(posts.length >= 2);
  assert.ok(server.requests.some((request) => request.path.endsWith('/posts') && request.query.page === '2'));
  assert.ok(server.requests.some((request) => request.path.endsWith('/posts') && request.query.page === '3'));
});

test('application-password authentication is required and accepted', async (t) => {
  const { session: instance } = await session(t, {
    requireAuth: true,
    authMode: 'application_password'
  }, {
    auth: { mode: 'application_password', username: 'fixture-user', appPassword: 'fixture-app-password' }
  });
  const report = await instance.validate();
  assert.equal(report.auth.mode, 'application_password');
  const drafts = [];
  for await (const item of instance.listContent({ perPage: 100, query: { status: 'draft' } })) drafts.push(item.raw.id);
  assert.deepEqual(drafts, [104]);
});

test('missing and wrong application passwords fail with structured auth errors', async (t) => {
  const server = await fixture(t, { requireAuth: true, authMode: 'application_password' });
  const adapter = createWordPressAdapter();
  await assert.rejects(
    () => adapter.createSession({ config: { baseUrl: server.url }, auth: { mode: 'application_password' } }),
    (error) => error.code === SOURCE_ERROR_CODES.AUTH_REQUIRED
  );
  const instance = await adapter.createSession({
    config: { baseUrl: server.url, timeoutMs: 2000 },
    auth: { mode: 'application_password', username: 'fixture-user', appPassword: 'wrong' }
  });
  await assert.rejects(
    () => instance.validate(),
    (error) => error.code === SOURCE_ERROR_CODES.AUTH_FAILED
  );
});

test('session authentication logs in without exposing credentials', async (t) => {
  const { session: instance } = await session(t, {
    requireAuth: true,
    authMode: 'session'
  }, {
    auth: { mode: 'session', username: 'fixture-user', password: 'fixture-password' }
  });
  const report = await instance.validate();
  assert.equal(report.auth.mode, 'session');
  assert.equal(report.auth.authenticated, true);
  assert.ok(!JSON.stringify(report).includes('fixture-password'));
  assert.ok(!JSON.stringify(report).includes('fixture-user'));
});

test('malformed responses, timeouts, network failures and server errors are classified', async (t) => {
  const malformed = await fixture(t, { malformed: true });
  const adapter = createWordPressAdapter();
  const malformedSession = await adapter.createSession({ config: { baseUrl: malformed.url, timeoutMs: 1000 } });
  await assert.rejects(
    () => malformedSession.validate(),
    (error) => error.code === SOURCE_ERROR_CODES.INVALID_RESPONSE
  );

  const slow = await fixture(t, { delayMs: 300 });
  const slowSession = await adapter.createSession({ config: { baseUrl: slow.url, timeoutMs: 50 } });
  await assert.rejects(
    () => slowSession.validate(),
    (error) => error.code === SOURCE_ERROR_CODES.TIMEOUT && error.retryable === true
  );

  const failed = await fixture(t, { failStatus: 500 });
  const failedSession = await adapter.createSession({ config: { baseUrl: failed.url, timeoutMs: 1000 } });
  await assert.rejects(
    () => failedSession.validate(),
    (error) => error.code === SOURCE_ERROR_CODES.HTTP_ERROR && error.retryable === true
  );

  const closed = await fixture(t);
  const closedUrl = closed.url;
  await closed.close();
  const networkSession = await adapter.createSession({ config: { baseUrl: closedUrl, timeoutMs: 500 } });
  await assert.rejects(
    () => networkSession.validate(),
    (error) => error.code === SOURCE_ERROR_CODES.NETWORK_ERROR && error.retryable === true
  );
});

test('cancellation aborts a paginated request', async (t) => {
  const { session: instance } = await session(t, { delayMs: 200 });
  const controller = new AbortController();
  const iterator = instance.client.iterateCollection('/wp-json/wp/v2/posts', {
    perPage: 1,
    signal: controller.signal
  });
  const first = iterator.next();
  controller.abort();
  await assert.rejects(
    () => first,
    (error) => error.code === SOURCE_ERROR_CODES.CANCELLED
  );
});

test('unsupported content types and taxonomies fail explicitly', async (t) => {
  const { session: instance } = await session(t);
  await assert.rejects(async () => {
    for await (const item of instance.listContent({ contentTypes: ['book'] })) void item;
  }, (error) => error.code === SOURCE_ERROR_CODES.UNSUPPORTED_CAPABILITY);
  await assert.rejects(async () => {
    for await (const item of instance.listTerms({ taxonomies: ['custom'] })) void item;
  }, (error) => error.code === SOURCE_ERROR_CODES.UNSUPPORTED_CAPABILITY);
});

test('date and modified filters are forwarded for incremental discovery', async (t) => {
  const { server, session: instance } = await session(t);
  const ids = [];
  for await (const item of instance.listContent({
    perPage: 100,
    contentTypes: ['post'],
    query: { modified_after: '2024-02-01T00:00:00Z', order: 'asc' }
  })) ids.push(item.raw.id);
  assert.deepEqual(ids, [101]);
  const request = server.requests.find((entry) => entry.path.endsWith('/posts'));
  assert.equal(request.query.modified_after, '2024-02-01T00:00:00.000Z');
  assert.equal(request.query.order, 'asc');
});

test('large logical archives are consumed with bounded memory', async (t) => {
  const data = createFixtureData();
  data.posts = Array.from({ length: 4000 }, (_, index) => ({
    id: 10_000 + index,
    slug: `bulk-${index}`,
    title: `Bulk ${index}`,
    content: '<p>Bulk body</p>',
    excerpt: '',
    date: '2023-06-01T00:00:00',
    date_gmt: '2023-06-01T00:00:00',
    modified: '2023-06-01T00:00:00',
    modified_gmt: '2023-06-01T00:00:00',
    status: 'publish',
    author: 7,
    featured_media: 0,
    categories: [],
    tags: []
  }));
  const server = await fixture(t, { data });
  const adapter = createWordPressAdapter();
  const instance = await adapter.createSession({ config: { baseUrl: server.url, timeoutMs: 5000 } });
  const before = process.memoryUsage().heapUsed;
  let count = 0;
  for await (const item of instance.listContent({ perPage: 100, contentTypes: ['post'] })) {
    assert.ok(item.raw.id);
    count += 1;
  }
  const delta = process.memoryUsage().heapUsed - before;
  assert.equal(count, 4000);
  assert.ok(delta < 96 * 1024 * 1024, `heap delta was ${Math.round(delta / 1024 / 1024)} MiB`);
});
