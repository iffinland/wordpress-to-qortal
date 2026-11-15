import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCmsRepository } from '../src/lib/repository.js';
import { cmsConfig } from '../src/config/cmsConfig';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, '..', 'fixtures');
const MANIFEST_ID = 'qms-cms-manifest';
const NATIVE_ID = 'qms-cms-native-index';

function configFor(siteId = 'site-fixture') {
  const config = structuredClone(cmsConfig);
  config.site.id = siteId;
  config.site.ownerName = 'QortalDemo';
  config.admin.qdnName = 'QortalDemo';
  return config;
}

function jsonResponse(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload } as Response;
}

function notFound() {
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
}

function fixtureManifest() {
  return JSON.parse(readFileSync(path.join(FIXTURES, 'qms-cms-manifest.json'), 'utf8'));
}

function nativeIndex(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'qms-cms-native-index@1',
    version: 1,
    revision: 1,
    site_id: 'site-fixture',
    updated_at: '2026-11-14T12:00:00.000Z',
    published_by: 'QOwnerAddress111111111111111111111',
    categories: [{ id: 'cms-category-news', name: 'News', slug: 'news' }],
    tags: [{ id: 'cms-tag-update', name: 'Update', slug: 'update' }],
    entries: [{
      id: 'cms-native-1',
      type: 'post',
      title: 'CMS only post',
      slug: 'cms-only-post',
      status: 'published',
      excerpt: 'Published without a WordPress manifest.',
      category_ids: ['cms-category-news'],
      tag_ids: ['cms-tag-update'],
      created_at: '2026-11-14T12:00:00.000Z',
      updated_at: '2026-11-14T12:00:00.000Z',
      published_at: '2026-11-14T12:00:00.000Z',
      featured_image: null,
      featured_image_url: null,
      qdn: { service: 'DOCUMENT', name: 'QortalDemo', identifier: 'cms-content-1' }
    }],
    ...overrides
  };
}

const cmsContent = {
  schema: 'qms-qdn-content@1',
  version: 1,
  id: 'cms-native-1',
  content_type: 'post',
  identity: { slug: 'cms-only-post' },
  title: 'CMS only post',
  dates: { published_at: '2026-11-14T12:00:00.000Z', modified_at: '2026-11-14T12:00:00.000Z' },
  body: { format: 'html', html: '<p>CMS-authored body.</p>', text: 'CMS-authored body.' },
  authors: [{ name: 'Owner' }],
  terms: { categories: [], tags: [] },
  media: [],
  content_hash: 'sha256-cms'
};

function qdnFetch(options: { manifest?: any; native?: any } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.includes('/arbitrary/DOCUMENT/QortalDemo/')) return notFound();
    const identifier = decodeURIComponent(url.split('?')[0].split('/').pop() || '');
    if (identifier === NATIVE_ID) return options.native ? jsonResponse(options.native) : notFound();
    if (identifier === MANIFEST_ID) return options.manifest ? jsonResponse(options.manifest) : notFound();
    if (identifier === 'cr-qdn-manifest' || identifier === 'qms-cms-edit-overlay'
      || identifier === 'qms-cms-search-index' || identifier === 'qms-cms-gallery') {
      return notFound();
    }
    if (identifier === 'cms-content-1') return jsonResponse(cmsContent);
    if (options.manifest && options.manifest.resources?.by_identifier?.[identifier]?.local_path) {
      const localPath = options.manifest.resources.by_identifier[identifier].local_path;
      return jsonResponse(JSON.parse(readFileSync(path.join(FIXTURES, localPath), 'utf8')));
    }
    return notFound();
  });
}

beforeEach(() => {
  localStorage.clear();
  (window as any)._qdnResource = { name: 'QortalDemo', service: 'WEBSITE', identifier: 'default' };
});

afterEach(() => {
  delete (window as any)._qdnResource;
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('CMS catalog loading without a QMS import manifest', () => {
  it('shows a valid CMS-native index on its own', async () => {
    vi.stubGlobal('fetch', qdnFetch({ native: nativeIndex() }));
    const repository = createCmsRepository(configFor(), { source: 'qdn' });
    const dataset = await repository.loadDataset();

    expect(dataset.state).toBe('partial');
    expect(dataset.availability.posts).toBe(true);
    expect(dataset.posts).toHaveLength(1);
    expect(dataset.posts[0].title).toBe('CMS only post');
    expect(dataset.posts[0].native).toBe(true);
    expect(dataset.categories.map((term: any) => term.name)).toContain('News');
    expect(dataset.notices.some((notice: any) => notice.code === 'catalog-import-unavailable')).toBe(true);

    const item = await repository.findPost('cms-only-post');
    expect(item).not.toBeNull();
    const content = await repository.loadContent(item);
    expect(content.html).toContain('CMS-authored body');
  });

  it('keeps imported posts and CMS-authored posts together when both exist', async () => {
    vi.stubGlobal('fetch', qdnFetch({ manifest: fixtureManifest(), native: nativeIndex() }));
    const repository = createCmsRepository(configFor(), { source: 'qdn' });
    const dataset = await repository.loadDataset();

    expect(dataset.state).toBe('ready');
    expect(dataset.posts).toHaveLength(4);
    expect(dataset.posts.map((item: any) => item.title)).toContain('Hello Qortal');
    expect(dataset.posts.map((item: any) => item.title)).toContain('CMS only post');
    expect(dataset.notices.some((notice: any) => notice.code === 'catalog-import-unavailable')).toBe(false);
  });

  it('still shows the imported catalog when only the manifest exists', async () => {
    vi.stubGlobal('fetch', qdnFetch({ manifest: fixtureManifest() }));
    const repository = createCmsRepository(configFor(), { source: 'qdn' });
    const dataset = await repository.loadDataset();

    expect(dataset.state).toBe('ready');
    expect(dataset.posts).toHaveLength(3);
    expect(dataset.posts.map((item: any) => item.title)).toContain('Hello Qortal');
  });

  it('reports an invalid native index instead of fabricating an empty catalog', async () => {
    vi.stubGlobal('fetch', qdnFetch({ native: { schema: 'not-a-native-index', version: 1, entries: [] } }));
    const repository = createCmsRepository(configFor(), { source: 'qdn' });
    const dataset = await repository.loadDataset();

    expect(dataset.state).toBe('error');
    expect(dataset.posts).toHaveLength(0);
    expect(dataset.message).toContain('No CMS catalog manifest could be read');
    expect(dataset.message).toContain('CMS native index is invalid');
  });

  it('accepts the legacy site placeholder written by older CMS versions', async () => {
    vi.stubGlobal('fetch', qdnFetch({ native: nativeIndex({ site_id: 'site' }) }));
    const repository = createCmsRepository(configFor(), { source: 'qdn' });
    const dataset = await repository.loadDataset();

    expect(dataset.state).toBe('partial');
    expect(dataset.posts).toHaveLength(1);
    expect(dataset.posts[0].title).toBe('CMS only post');
  });

  it('rejects a native index belonging to another site identity', async () => {
    vi.stubGlobal('fetch', qdnFetch({ native: nativeIndex({ site_id: 'other-site' }) }));
    const repository = createCmsRepository(configFor(), { source: 'qdn' });
    const dataset = await repository.loadDataset();

    expect(dataset.state).toBe('error');
    expect(dataset.posts).toHaveLength(0);
    expect(dataset.message).toContain('site identity');
  });
});
