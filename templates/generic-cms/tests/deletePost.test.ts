import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteNativePost } from '../src/lib/authoring.js';
import { emptySearchIndex } from '../src/lib/search.js';
import { ownerIdentity } from './support/fixtures';

const CONTENT_ID = 'qms-cms-site-fixture-post-delete-me-abc';

function item() {
  return {
    id: 'cms-delete-me',
    type: 'post' as const,
    title: 'Delete me',
    slug: 'delete-me',
    status: 'published',
    excerpt: '',
    categoryIds: ['cms-category-news'],
    tagIds: ['cms-tag-test'],
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    publishedAt: '2026-11-01T00:00:00.000Z',
    contentRef: { service: 'DOCUMENT', name: 'QortalDemo', identifier: CONTENT_ID },
    featuredImageRef: null,
    contentHash: null,
    native: true,
    sourceKind: 'cms-authored' as const
  };
}

function indexDoc(entries: any[]) {
  return {
    schema: 'qms-cms-native-index@1',
    version: 1,
    revision: 7,
    site_id: 'site-fixture',
    updated_at: '2026-11-01T00:00:00.000Z',
    published_by: { address: ownerIdentity.address, name: 'QortalDemo' },
    categories: [{ id: 'cms-category-news', name: 'News', slug: 'news' }],
    tags: [{ id: 'cms-tag-test', name: 'Test', slug: 'test' }],
    entries
  };
}

function install(index: any) {
  const calls: any[] = [];
  const stored = new Map<string, string>();
  let currentIndex = index;
  (window as any).qortalRequest = vi.fn(async (payload: any) => {
    calls.push(payload);
    switch (payload.action) {
      case 'GET_USER_ACCOUNT': return { address: ownerIdentity.address };
      case 'GET_ACCOUNT_NAMES': return [{ name: 'QortalDemo' }];
      case 'GET_PRIMARY_NAME': return 'QortalDemo';
      case 'PUBLISH_MULTIPLE_QDN_RESOURCES':
        for (const resource of payload.resources) {
          stored.set(resource.identifier, resource.data64);
          if (resource.identifier === 'qms-cms-native-index') currentIndex = decode(resource.data64);
        }
        return { ok: true };
      case 'FETCH_QDN_RESOURCE': return stored.get(payload.identifier) ?? null;
      default: return null;
    }
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/names/')) {
      return { ok: true, status: 200, json: async () => ({ name: 'QortalDemo', owner: ownerIdentity.address }) };
    }
    if (String(url).includes('qms-cms-native-index')) {
      return { ok: true, status: 200, json: async () => currentIndex };
    }
    if (String(url).includes('qms-cms-search-index')) {
      const search: any = emptySearchIndex('site-fixture');
      search.revision = 3;
      search.entries = [{
        id: 'cms-delete-me',
        type: 'post',
        slug: 'delete-me',
        title: 'Delete me',
        text: 'Delete me body',
        excerpt: '',
        updated_at: '2026-11-01T00:00:00.000Z'
      }];
      return { ok: true, status: 200, json: async () => search };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }));
  return { calls, stored };
}

function decode(bytes: string) {
  const binary = atob(bytes);
  const data = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index);
  return JSON.parse(new TextDecoder().decode(data));
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  delete (window as any).qortalRequest;
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('owner-only post deletion', () => {
  it('tombstones the stable content resource and removes catalog, search and assignments in one approval', async () => {
    const entry = {
      id: 'cms-delete-me',
      type: 'post',
      title: 'Delete me',
      slug: 'delete-me',
      status: 'published',
      excerpt: '',
      category_ids: ['cms-category-news'],
      tag_ids: ['cms-tag-test'],
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-01T00:00:00.000Z',
      published_at: '2026-11-01T00:00:00.000Z',
      qdn: { service: 'DOCUMENT', name: 'QortalDemo', identifier: CONTENT_ID }
    };
    const { calls, stored } = install(indexDoc([entry]));
    const result: any = await deleteNativePost({
      identity: ownerIdentity,
      name: 'QortalDemo',
      siteId: 'site-fixture',
      item: item(),
      baseRevision: 7,
      storage: localStorage
    });

    expect(result.ok).toBe(true);
    expect(result.index.entries).toEqual([]);
    expect(result.contentIdentifier).toBe(CONTENT_ID);
    expect(result.message).toContain('not physically erased');

    const batched = calls.filter((call) => call.action === 'PUBLISH_MULTIPLE_QDN_RESOURCES');
    expect(batched).toHaveLength(1);
    const contentResource = batched[0].resources.find((resource: any) => resource.identifier === CONTENT_ID);
    const tombstone = decode(contentResource.data64);
    expect(tombstone.publication_status).toBe('deleted');
    expect(tombstone.qdn.identifier).toBe(CONTENT_ID);
    expect(tombstone.body.html).toBe('');

    const indexResource = batched[0].resources.find((resource: any) => resource.identifier === 'qms-cms-native-index');
    expect(decode(indexResource.data64).entries).toEqual([]);
    const searchResource = batched[0].resources.find((resource: any) => resource.identifier === 'qms-cms-search-index');
    expect(decode(searchResource.data64).entries).toEqual([]);
    expect(result.tombstone.qdn.identifier).toBe(CONTENT_ID);

    // A repeated click must not resend a batch.
    const again: any = await deleteNativePost({
      identity: ownerIdentity,
      name: 'QortalDemo',
      siteId: 'site-fixture',
      item: item(),
      baseRevision: 7,
      storage: localStorage
    });
    expect(again.ok).toBe(false);
    expect(calls.filter((call) => call.action === 'PUBLISH_MULTIPLE_QDN_RESOURCES')).toHaveLength(1);
  });

  it('refuses imported content instead of pretending to erase it', async () => {
    const { calls } = install(indexDoc([]));
    const result: any = await deleteNativePost({
      identity: ownerIdentity,
      name: 'QortalDemo',
      siteId: 'site-fixture',
      item: { ...item(), native: false, sourceKind: 'wordpress-imported' },
      baseRevision: 7,
      storage: localStorage
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe('unsupported');
    expect(calls.filter((call) => call.action === 'PUBLISH_MULTIPLE_QDN_RESOURCES')).toHaveLength(0);
  });

  it('blocks a stale revision before publishing anything', async () => {
    const { calls } = install(indexDoc([]));
    const result: any = await deleteNativePost({
      identity: ownerIdentity,
      name: 'QortalDemo',
      siteId: 'site-fixture',
      item: item(),
      baseRevision: 6,
      storage: localStorage
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe('conflict');
    expect(calls.filter((call) => call.action === 'PUBLISH_MULTIPLE_QDN_RESOURCES')).toHaveLength(0);
  });
});
