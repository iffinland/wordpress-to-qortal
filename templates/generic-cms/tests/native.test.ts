import { describe, expect, it } from 'vitest';
import {
  buildNativeContentPayload,
  emptyNativeIndex,
  mergeNativeCatalog,
  nativeContentIdentifier,
  nativeEntryFromDraft,
  readNativeIndex,
  slugAvailable,
  upsertNativeEntry
} from '../src/lib/nativeCatalog.js';
import { loadFixture } from './support/fixtures';

const identity = { address: 'QOwnerAddress111111111111111111111', qdnName: 'developer iffi' };

function entry(id: string, slug: string, title: string) {
  return { id, type: 'post', title, slug, status: 'published', category_ids: ['cms-category-news'], tag_ids: ['cms-tag-test'], created_at: new Date().toISOString(), published_at: new Date().toISOString(), qdn: { service: 'DOCUMENT', name: 'developer iffi', identifier: 'qms-cms-post-' + slug } };
}

describe('CMS-authored content supplement', () => {
  it('merges CMS posts into the imported QMS catalog without removing imported posts', async () => {
    const fixture = await loadFixture();
    const index = { ...emptyNativeIndex('fixture'), revision: 1, entries: [entry('cms-one', 'cms-one', 'CMS One')], categories: [{ id: 'cms-category-news', name: 'News', slug: 'news' }], tags: [{ id: 'cms-tag-test', name: 'Test', slug: 'test' }] };
    const merged = mergeNativeCatalog(fixture.dataset, index);
    expect(merged.posts.length).toBe(fixture.dataset.posts.length + 1);
    expect(merged.posts.some((item: any) => item.title === 'CMS One')).toBe(true);
    expect(merged.posts.some((item: any) => item.title === 'Hello Qortal')).toBe(true);
    expect(merged.categories.some((term: any) => term.id === 'cms-category-news')).toBe(true);
    expect(merged.tags.some((term: any) => term.id === 'cms-tag-test')).toBe(true);
    expect(merged.posts.find((item: any) => item.title === 'CMS One')?.native).toBe(true);
  });

  it('skips an entry whose slug collides with imported content instead of overwriting it', async () => {
    const fixture = await loadFixture();
    const imported = fixture.dataset.posts[0];
    const index = { ...emptyNativeIndex('fixture'), entries: [entry('cms-collision', imported.slug, 'Collision')] };
    const merged = mergeNativeCatalog(fixture.dataset, index);
    expect(merged.posts.find((item: any) => item.slug === imported.slug)?.title).toBe(imported.title);
    expect(merged.notices.some((notice: any) => notice.code === 'cms-native-slug-collision')).toBe(true);
  });

  it('blocks a slug used by imported content before publication', async () => {
    const fixture = await loadFixture();
    const imported = fixture.dataset.posts[0];
    expect(slugAvailable(fixture.dataset, imported.slug).ok).toBe(false);
    expect(slugAvailable(fixture.dataset, 'a-brand-new-slug').ok).toBe(true);
  });

  it('rejects a stale revision instead of overwriting newer CMS content', () => {
    const index = { ...emptyNativeIndex('site'), revision: 4, entries: [] };
    const result = upsertNativeEntry(index, entry('cms-x', 'cms-x', 'X'), { baseRevision: 3, identity });
    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
  });

  it('creates stable identifiers and qms-qdn-content@1 payloads', () => {
    expect(nativeContentIdentifier('site', 'same-slug')).toBe(nativeContentIdentifier('site', 'same-slug'));
    expect(nativeContentIdentifier('site', 'same-slug')).not.toBe(nativeContentIdentifier('site', 'other-slug'));
    const payload = buildNativeContentPayload({ title: 'T', slug: 't', html: '<p>Body</p>', type: 'post' }, { contentIdentifier: 'qms-cms-post-t', qdnName: 'developer iffi', contentHash: 'sha256:abc' });
    expect(payload.schema).toBe('qms-qdn-content@1');
    expect(payload.qdn.service).toBe('DOCUMENT');
    expect(payload.qdn.identifier).toBe('qms-cms-post-t');
    expect(payload.body.html).toBe('<p>Body</p>');
    expect(payload.publication_status).toBe('published');
  });

  it('validates the native index schema', () => {
    expect(readNativeIndex(emptyNativeIndex()).ok).toBe(true);
    expect(readNativeIndex({ schema: 'other@1', entries: [] }).ok).toBe(false);
    expect(readNativeIndex({ schema: 'qms-cms-native-index@1', version: 99, entries: [] }).ok).toBe(false);
  });
});

