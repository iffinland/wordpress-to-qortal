import { describe, expect, it } from 'vitest';
import {
  buildSearchIndexDocument,
  createSearchEntryFromDraft,
  highlightTextParts,
  isSearchIndexStale,
  makeSnippet,
  readSearchIndex,
  searchIndexEntries,
  tokenizeQuery,
  upsertSearchEntry,
  SEARCH_INDEX_SCHEMA
} from '../src/lib/search.js';
import { mergeNativeCatalog, emptyNativeIndex, nativeEntryFromDraft } from '../src/lib/nativeCatalog.js';
import { publishedPosts } from '../src/lib/archive.js';
import { loadFixture } from './support/fixtures';

function entry(overrides: any = {}) {
  return {
    id: overrides.id || 'cms-one',
    type: overrides.type || 'post',
    title: overrides.title || 'Põhja-Šotimaa žürii',
    slug: overrides.slug || 'pohja-sotimaa',
    excerpt: overrides.excerpt || 'Eesti tähed õ ä ö ü š ž',
    text: overrides.text || 'Artikkel räägib Põhja-Šotimaa žüriist ja teistest teemadest.',
    updated_at: overrides.updated_at || '2026-11-01T00:00:00.000Z',
    origin: overrides.origin || 'cms'
  };
}

function indexOf(entries: any[]) {
  return buildSearchIndexDocument({ siteId: 'site', entries: entries as never[] });
}

describe('versioned search index', () => {
  it('round-trips a valid index and rejects newer or malformed documents', () => {
    const document = indexOf([entry()]);
    expect(document.schema).toBe(SEARCH_INDEX_SCHEMA);
    expect(readSearchIndex(document).ok).toBe(true);
    expect(readSearchIndex({ ...document, version: 99 }).ok).toBe(false);
    expect(readSearchIndex({ schema: 'other@1', entries: [] }).ok).toBe(false);
    expect(readSearchIndex({ schema: SEARCH_INDEX_SCHEMA, version: 1 }).ok).toBe(false);
  });

  it('indexes CMS and imported entries together and upserts by slug', () => {
    const imported = entry({ id: 'wp-1', slug: 'imported-post', title: 'Imported Post', origin: 'imported' });
    const cms = entry({ id: 'cms-1', slug: 'cms-post', title: 'CMS Post', origin: 'cms' });
    const document = indexOf([imported, cms]);
    expect(document.entry_count).toBe(2);
    const updated = upsertSearchEntry(document, entry({ id: 'cms-1', slug: 'cms-post', title: 'CMS Post edited' }));
    expect(updated.ok).toBe(true);
    expect(updated.index!.revision).toBe(1);
    expect(updated.index!.entries.find((item: any) => item.slug === 'cms-post')?.title).toBe('CMS Post edited');
    expect(updated.index!.entries.some((item: any) => item.slug === 'imported-post')).toBe(true);
  });

  it('detects a stale index honestly', () => {
    const document = indexOf([entry()]);
    expect(isSearchIndexStale({ updated_at: document.updated_at }, Date.parse('2026-12-20T00:00:00Z'))).toBe(true);
    expect(isSearchIndexStale({ updated_at: document.updated_at }, Date.parse('2026-11-02T00:00:00Z'))).toBe(false);
  });
});

describe('Unicode and phrase matching', () => {
  it('matches Estonian characters case-insensitively and accent-insensitively', () => {
    const index = indexOf([entry()]);
    for (const query of ['põhja', 'PÕHJA', 'Põhja', 'pohja', 'žürii', 'ZURII']) {
      const result = searchIndexEntries(index, query);
      expect(result.total, query).toBeGreaterThan(0);
      expect(result.results[0].entry.slug).toBe('pohja-sotimaa');
    }
  });

  it('requires a quoted phrase to match in order', () => {
    const index = indexOf([entry({ text: 'the quick brown fox jumps over the lazy dog' })]);
    expect(searchIndexEntries(index, '"quick brown"').total).toBe(1);
    expect(searchIndexEntries(index, '"brown quick"').total).toBe(0);
    expect(tokenizeQuery('"quick brown" fox').phrases).toEqual(['quick brown']);
    expect(tokenizeQuery('"quick brown" fox').terms).toEqual(['fox']);
  });

  it('finds body-only matches and produces a context snippet', () => {
    const index = indexOf([entry({ title: 'Unrelated', excerpt: 'Nothing here', text: 'Alkuteema. Siin on väga pikk tekst ja keset seda seisab unikaalne märksõna sõnajalg lõpuosas.' })]);
    const result = searchIndexEntries(index, 'sõnajalg');
    expect(result.total).toBe(1);
    expect(result.results[0].snippet).toContain('sõnajalg');
    expect(result.results[0].snippet.length).toBeLessThan(200);
  });

  it('ranks title matches before body matches', () => {
    const index = indexOf([
      entry({ id: 'body', slug: 'body', title: 'Other', text: 'qortal mainitakse ainult kehas' }),
      entry({ id: 'title', slug: 'title', title: 'Qortal algab pealkirjas', text: 'midagi muud' })
    ]);
    const result = searchIndexEntries(index, 'qortal');
    expect(result.results.map((item: any) => item.entry.slug)).toEqual(['title', 'body']);
  });

  it('highlights original Estonian text without losing characters', () => {
    const parts = highlightTextParts('Põhja-Šotimaa žürii', ['pohja', 'zurii']);
    expect(parts.filter((part) => part.match).map((part) => part.text).join('|')).toBe('Põhja|žürii');
    expect(parts.map((part) => part.text).join('')).toBe('Põhja-Šotimaa žürii');
  });

  it('builds a safe snippet around the first match', () => {
    const snippet = makeSnippet('a'.repeat(300) + ' needle ' + 'b'.repeat(300), ['needle'], 20);
    expect(snippet).toContain('needle');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });
});

describe('CMS publishing regression: draft is not public', () => {
  it('keeps a draft out of published lists and a published post in them', () => {
    const draft = {
      id: 'draft-1', type: 'post', title: 'Draft Post', slug: 'draft-post', status: 'draft',
      excerpt: 'x', categories: [], tags: [], createdAt: '2026-11-01T00:00:00.000Z'
    };
    const asDraft = nativeEntryFromDraft(draft, { siteId: 'site', qdnName: 'name', contentIdentifier: 'id', contentHash: 'sha256:x' });
    expect(asDraft.entry.status).toBe('draft');
    const indexDraft = { ...emptyNativeIndex('site'), entries: [asDraft.entry] };
    expect(publishedPosts(indexDraft.entries as any[])).toHaveLength(0);

    const asPublished = nativeEntryFromDraft({ ...draft, status: 'published' }, { siteId: 'site', qdnName: 'name', contentIdentifier: 'id', contentHash: 'sha256:x' });
    expect(asPublished.entry.status).toBe('published');
    const indexPublished = { ...emptyNativeIndex('site'), entries: [asPublished.entry] };
    expect(publishedPosts(indexPublished.entries as any[])).toHaveLength(1);
  });

  it('merges a published native post into the imported catalog and leaves the imported post intact', async () => {
    const fixture = await loadFixture();
    const draft = {
      id: 'draft-2', type: 'post', title: 'New CMS Post', slug: 'new-cms-post', status: 'published',
      excerpt: 'Fresh', categories: [{ id: 'cms-category-news', name: 'News', slug: 'news' }],
      tags: [], createdAt: '2026-11-01T00:00:00.000Z'
    };
    const built = nativeEntryFromDraft(draft, { siteId: 'fixture', qdnName: 'name', contentIdentifier: 'id', contentHash: 'sha256:y' });
    const merged = mergeNativeCatalog(fixture.dataset, {
      ...emptyNativeIndex('fixture'), revision: 1, entries: [built.entry], categories: built.categories
    });
    expect(merged.posts.some((item: any) => item.slug === 'new-cms-post' && item.native)).toBe(true);
    expect(merged.posts.some((item: any) => item.slug === 'hello-qortal')).toBe(true);
    expect(merged.categories.some((term: any) => term.name === 'News')).toBe(true);
  });

  it('creates a search entry from the published draft body', () => {
    const searchEntry = createSearchEntryFromDraft({
      id: 'draft-3', type: 'post', title: 'Searchable', slug: 'searchable',
      excerpt: 'Short excerpt', html: '<p>Full <strong>body</strong> text with sõnajalg.</p>'
    });
    expect(searchEntry?.origin).toBe('cms');
    expect(searchEntry?.text).toContain('sõnajalg');
    expect(searchEntry?.excerpt).toBe('Short excerpt');
  });
});
