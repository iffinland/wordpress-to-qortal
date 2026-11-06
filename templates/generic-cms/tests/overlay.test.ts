import { describe, expect, it } from 'vitest';
import {
  OVERLAY_SCHEMA,
  createOverlayEntry,
  emptyOverlay,
  findOverlayEntry,
  markOverlayConflict,
  mergeOverlayCatalog,
  overlayContentIdentifier,
  readOverlay,
  removeOverlayEntry,
  sourceFingerprint,
  upsertOverlayEntry
} from '../src/lib/overlay.js';

const importedItem = {
  id: 'wp-42',
  type: 'post',
  title: 'Imported title',
  slug: 'imported-title',
  status: 'published',
  excerpt: 'Imported excerpt',
  categoryIds: ['cat-news'],
  tagIds: ['tag-intro'],
  createdAt: '2020-01-01T00:00:00.000Z',
  updatedAt: '2020-02-01T00:00:00.000Z',
  publishedAt: '2020-02-01T00:00:00.000Z',
  contentRef: { service: 'DOCUMENT', name: 'QortalDemo', identifier: 'imported-content' },
  featuredImageRef: null,
  contentHash: 'sha256-imported',
  native: false,
  legacy: { sourceId: 42, oldUrl: 'https://old.example/imported-title/' }
};

function dataset() {
  return {
    posts: [{ ...importedItem }],
    pages: [],
    categories: [{ id: 'cat-news', name: 'News', slug: 'news', count: 1 }],
    tags: [{ id: 'tag-intro', name: 'Intro', slug: 'intro', count: 1 }],
    notices: [],
    media: [],
    urls: { bySourceUrl: {} }
  };
}

function entryFor(overrides: any = {}) {
  return createOverlayEntry({
    item: importedItem,
    content: { title: importedItem.title, html: '<p>Imported body</p>', excerpt: '', modifiedAt: '2020-02-01T00:00:00.000Z' },
    draft: {
      title: overrides.title || 'Local title',
      slug: overrides.slug || 'imported-title',
      excerpt: overrides.excerpt || 'Local excerpt',
      categoryIds: ['cat-news'],
      tagIds: ['tag-intro'],
      author: 'Owner',
      slugAliases: []
    },
    contentRef: { service: 'DOCUMENT', name: 'QortalDemo', identifier: 'qms-cms-ov-test' },
    contentHash: 'sha256:local',
    baseSourceHash: overrides.baseSourceHash || 'sha256:base',
    identity: { address: 'QOwner', qdnName: 'QortalDemo' },
    now: Date.parse('2026-01-01T00:00:00.000Z')
  });
}

describe('edit overlay document', () => {
  it('round-trips and rejects incompatible schemas', () => {
    const overlay = emptyOverlay('site-fixture');
    expect(readOverlay(overlay).ok).toBe(true);
    expect(readOverlay({ schema: 'nope', entries: [] }).ok).toBe(false);
    expect(readOverlay({ schema: OVERLAY_SCHEMA, version: 99, entries: [] }).ok).toBe(false);
    expect(readOverlay({ schema: OVERLAY_SCHEMA, version: 1, entries: [] }).ok).toBe(true);
  });

  it('preserves WordPress source metadata and the imported identity', () => {
    const entry = entryFor();
    expect(entry).toMatchObject({
      source_item_id: 'wp-42',
      source_type: 'post',
      source_slug: 'imported-title',
      source_adapter: 'wordpress',
      source_id: 42,
      source_old_url: 'https://old.example/imported-title/',
      base_source_hash: 'sha256:base'
    });
    expect(entry.content).toEqual({ service: 'DOCUMENT', name: 'QortalDemo', identifier: 'qms-cms-ov-test' });
  });

  it('uses a stable content identifier tied to the imported identity, not the slug', () => {
    const first = overlayContentIdentifier('site-fixture', 'wp-42');
    const second = overlayContentIdentifier('site-fixture', 'wp-42');
    expect(first).toBe(second);
    expect(first.startsWith('qms-cms-ov-')).toBe(true);
    expect(first.length).toBeLessThanOrEqual(64);
    expect(overlayContentIdentifier('site-fixture', 'wp-43')).not.toBe(first);
  });
});

describe('overlay merge and WordPress sync behavior', () => {
  it('shows the local edit while keeping source identity and links', () => {
    const overlay = upsertOverlayEntry(emptyOverlay('site-fixture'), entryFor(), { baseRevision: 0, identity: { address: 'QOwner' }, now: 1 }).overlay;
    const merged = mergeOverlayCatalog(dataset(), overlay);
    const post = merged.posts[0];
    expect(post.title).toBe('Local title');
    expect(post.excerpt).toBe('Local excerpt');
    expect(post.id).toBe('wp-42');
    expect(post.slug).toBe('imported-title');
    expect(post.edited).toBe(true);
    expect(post.sourceKind).toBe('wordpress-overlay');
    expect(post.legacy).toEqual(importedItem.legacy);
    expect(post.sourceContentRef).toEqual(importedItem.contentRef);
    expect(post.contentRef).toEqual({ service: 'DOCUMENT', name: 'QortalDemo', identifier: 'qms-cms-ov-test' });
    expect(merged.notices.some((notice: any) => notice.code === 'cms-local-edits-applied')).toBe(true);
  });

  it('an unchanged WordPress rebuild does not erase the local edit', () => {
    const overlay = upsertOverlayEntry(emptyOverlay('site-fixture'), entryFor(), { baseRevision: 0, now: 1 }).overlay;
    const rebuilt = dataset(); // a fresh incremental sync rebuild
    const merged = mergeOverlayCatalog(rebuilt, overlay);
    expect(merged.posts[0].title).toBe('Local title');
    expect(merged.posts[0].contentRef.identifier).toBe('qms-cms-ov-test');
  });

  it('a changed source is detectable against the stored fingerprint', () => {
    const base = sourceFingerprint({ title: 'Imported title', html: '<p>Imported body</p>', excerpt: '', modifiedAt: '2020-02-01T00:00:00.000Z', sourceId: 42 });
    const changed = sourceFingerprint({ title: 'Imported title v2', html: '<p>Imported body</p>', excerpt: '', modifiedAt: '2026-01-01T00:00:00.000Z', sourceId: 42 });
    expect(base).not.toBe(changed);
    expect(sourceFingerprint({ title: 'Imported title', html: '<p>Imported body</p>', excerpt: '', modifiedAt: '2020-02-01T00:00:00.000Z', sourceId: 42 })).toBe(base);
  });

  it('preserves old slugs as aliases after an explicit slug change', () => {
    const entry = entryFor({ title: 'New local title', slug: 'new-local-title' });
    expect(entry.slug).toBe('new-local-title');
    expect(entry.slug_aliases).toContain('imported-title');
    const overlay = upsertOverlayEntry(emptyOverlay('site-fixture'), entry, { baseRevision: 0, now: 1 }).overlay;
    const merged = mergeOverlayCatalog(dataset(), overlay);
    expect(merged.posts[0].slug).toBe('new-local-title');
    expect(merged.posts[0].originalSlug).toBe('imported-title');
    expect(merged.posts[0].slugAliases).toContain('imported-title');
  });

  it('reports orphaned edits instead of silently deleting them', () => {
    const overlay = upsertOverlayEntry(emptyOverlay('site-fixture'), entryFor(), { baseRevision: 0, now: 1 }).overlay;
    const merged = mergeOverlayCatalog({ ...dataset(), posts: [] }, overlay);
    expect(merged.notices.some((notice: any) => notice.code === 'cms-local-edit-orphaned')).toBe(true);
  });
});

describe('overlay revision and conflict handling', () => {
  it('blocks a stale revision instead of clobbering a newer edit', () => {
    const first = upsertOverlayEntry(emptyOverlay('site-fixture'), entryFor(), { baseRevision: 0, now: 1 });
    expect(first.ok).toBe(true);
    const stale = upsertOverlayEntry(first.overlay, entryFor({ title: 'Stale' }), { baseRevision: 0, now: 2 });
    expect(stale.ok).toBe(false);
    expect(stale.conflict).toBe(true);
  });

  it('keeps local edits on conflict resolution and can accept upstream by removing the entry', () => {
    let overlay = upsertOverlayEntry(emptyOverlay('site-fixture'), entryFor(), { baseRevision: 0, now: 1 }).overlay;
    overlay = markOverlayConflict(overlay, 'wp-42', { conflict: true, now: 2 });
    expect(findOverlayEntry(overlay, 'wp-42').conflict_state).toBe('open');

    const resolved = markOverlayConflict(overlay, 'wp-42', { conflict: false, baseSourceHash: 'sha256:new-base', now: 3 });
    const entry = findOverlayEntry(resolved, 'wp-42');
    expect(entry.conflict_state).toBe('clean');
    expect(entry.base_source_hash).toBe('sha256:new-base');
    expect(entry.title).toBe('Local title');

    const accepted = removeOverlayEntry(resolved, 'wp-42', { baseRevision: resolved.revision, now: 4 });
    expect(accepted.ok).toBe(true);
    expect(findOverlayEntry(accepted.overlay, 'wp-42')).toBeNull();
    // The imported item itself is untouched and visible again.
    const merged = mergeOverlayCatalog(dataset(), accepted.overlay);
    expect(merged.posts[0].title).toBe('Imported title');
    expect(merged.posts[0].edited).toBeUndefined();
  });
});
