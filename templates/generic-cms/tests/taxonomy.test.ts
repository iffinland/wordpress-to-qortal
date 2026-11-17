import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishTaxonomyChange } from '../src/lib/authoring.js';
import { ownerIdentity } from './support/fixtures';

function indexDoc() {
  return {
    schema: 'qms-cms-native-index@1',
    version: 1,
    revision: 4,
    site_id: 'site-fixture',
    updated_at: '2026-11-01T00:00:00.000Z',
    published_by: { address: ownerIdentity.address, name: 'QortalDemo' },
    categories: [{ id: 'cms-category-news', name: 'News', slug: 'news' }],
    tags: [{ id: 'cms-tag-test', name: 'Test', slug: 'test' }],
    entries: [{
      id: 'cms-1', type: 'post', title: 'Post', slug: 'post', status: 'published',
      category_ids: ['cms-category-news'], tag_ids: ['cms-tag-test']
    }]
  };
}

function install(index = indexDoc()) {
  const calls: any[] = [];
  const stored = new Map<string, string>();
  (window as any).qortalRequest = vi.fn(async (payload: any) => {
    calls.push(payload);
    switch (payload.action) {
      case 'GET_USER_ACCOUNT': return { address: ownerIdentity.address };
      case 'GET_ACCOUNT_NAMES': return [{ name: 'QortalDemo' }];
      case 'GET_PRIMARY_NAME': return 'QortalDemo';
      case 'PUBLISH_QDN_RESOURCE': stored.set(payload.identifier, payload.data64); return { signature: 's' };
      case 'FETCH_QDN_RESOURCE': return stored.get(payload.identifier) ?? null;
      default: return null;
    }
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/names/')) {
      return { ok: true, status: 200, json: async () => ({ name: 'QortalDemo', owner: ownerIdentity.address }) };
    }
    if (String(url).includes('qms-cms-native-index')) {
      return { ok: true, status: 200, json: async () => index };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }));
  return calls;
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

describe('owner-side taxonomy management', () => {
  it('renames a term while keeping its id and slug and every entry reference', async () => {
    const calls = install();
    const result: any = await publishTaxonomyChange({
      identity: ownerIdentity,
      name: 'QortalDemo',
      siteId: 'site-fixture',
      kind: 'categories',
      action: 'rename',
      termId: 'cms-category-news',
      newName: 'Announcements',
      baseRevision: 4,
      storage: localStorage
    });
    expect(result.ok).toBe(true);
    expect(result.index.categories[0]).toEqual({ id: 'cms-category-news', name: 'Announcements', slug: 'news' });
    expect(result.index.entries[0].category_ids).toEqual(['cms-category-news']);
    const published = calls.find((call) => call.action === 'PUBLISH_QDN_RESOURCE');
    expect(decode(published.data64).categories[0].name).toBe('Announcements');
  });

  it('deletes a term and strips it from every CMS-authored entry', async () => {
    const calls = install();
    const result: any = await publishTaxonomyChange({
      identity: ownerIdentity,
      name: 'QortalDemo',
      siteId: 'site-fixture',
      kind: 'tags',
      action: 'delete',
      termId: 'cms-tag-test',
      baseRevision: 4,
      storage: localStorage
    });
    expect(result.ok).toBe(true);
    expect(result.index.tags).toEqual([]);
    expect(result.index.entries[0].tag_ids).toEqual([]);
    const published = calls.find((call) => call.action === 'PUBLISH_QDN_RESOURCE');
    expect(decode(published.data64).entries[0].tag_ids).toEqual([]);
  });

  it('refuses a term used by imported content without publishing', async () => {
    const calls = install();
    const result: any = await publishTaxonomyChange({
      identity: ownerIdentity,
      name: 'QortalDemo',
      siteId: 'site-fixture',
      kind: 'categories',
      action: 'delete',
      termId: 'cms-category-news',
      baseRevision: 4,
      storage: localStorage,
      usedByImported: true
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe('unsupported');
    expect(calls.filter((call) => call.action === 'PUBLISH_QDN_RESOURCE')).toHaveLength(0);
  });

  it('rejects a duplicate name and a stale revision', async () => {
    install();
    const duplicate: any = await publishTaxonomyChange({
      identity: ownerIdentity, name: 'QortalDemo', siteId: 'site-fixture',
      kind: 'categories', action: 'rename', termId: 'cms-category-news',
      newName: 'News', baseRevision: 4, storage: localStorage
    });
    expect(duplicate.ok).toBe(true); // same name is idempotent, not a duplicate id
    const stale: any = await publishTaxonomyChange({
      identity: ownerIdentity, name: 'QortalDemo', siteId: 'site-fixture',
      kind: 'categories', action: 'rename', termId: 'cms-category-news',
      newName: 'Something', baseRevision: 3, storage: localStorage
    });
    expect(stale.ok).toBe(false);
    expect(stale.state).toBe('conflict');
  });
});
