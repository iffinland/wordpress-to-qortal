import { describe, expect, it } from 'vitest';
import {
  finalizeSlug,
  findSlugAnomalies,
  isValidSlug,
  mergeAliases,
  prematureAutoSlugProblem,
  resolveBySlug,
  sanitizeSlugTyping,
  slugAvailability,
  slugProblem,
  slugify,
  slugSetFromItems,
  uniqueSlug
} from '../src/lib/slug.js';
import { createSlugState, reduceSlugState, assertSlugChangeAllowed } from '../src/lib/slugField.js';

describe('slug generation from the complete title', () => {
  it('generates the full slug, not the first keystroke', () => {
    expect(slugify('Teine test post')).toBe('teine-test-post');
  });

  it('updates on every keystroke when the title is typed character by character', () => {
    let state = createSlugState({ title: '', slug: '', touched: false, locked: false });
    const typed = 'Teine test post';
    const seen: string[] = [];
    for (let index = 1; index <= typed.length; index += 1) {
      state = reduceSlugState(state, { type: 'title', value: typed.slice(0, index) });
      seen.push(state.slug);
    }
    expect(seen[0]).toBe('t');
    expect(seen[seen.length - 1]).toBe('teine-test-post');
    expect(state.slug).toBe('teine-test-post');
    expect(state.touched).toBe(false);
  });

  it('handles a pasted full title in one change', () => {
    let state = createSlugState({ title: '', slug: '', touched: false, locked: false });
    state = reduceSlugState(state, { type: 'title', value: 'Teine test post' });
    expect(state.slug).toBe('teine-test-post');
  });

  it('normalizes Estonian and other Unicode letters instead of dropping them', () => {
    expect(slugify('Põhja-Tallinn õäöüšž')).toBe('pohja-tallinn-oaousz');
    expect(slugify('Šžõäöü')).toBe('szoaou');
    expect(slugify('Café déjà vu')).toBe('cafe-deja-vu');
    expect(slugify('Straße & Größe')).toBe('strasse-and-grosse');
    expect(slugify('Привет мир')).toBe('');
  });

  it('stops updating when the owner edits the slug manually', () => {
    let state = createSlugState({ title: 'Teine', slug: '', touched: false, locked: false });
    state = reduceSlugState(state, { type: 'title', value: 'Teine test' });
    expect(state.slug).toBe('teine-test');
    state = reduceSlugState(state, { type: 'slug', value: 'custom-slug' });
    expect(state.slug).toBe('custom-slug');
    expect(state.touched).toBe(true);
    state = reduceSlugState(state, { type: 'title', value: 'Teine test post' });
    expect(state.slug).toBe('custom-slug');
  });

  it('offers explicit regeneration', () => {
    let state = createSlugState({ title: 'Teine', slug: 'custom', touched: true, locked: false });
    state = reduceSlugState(state, { type: 'title', value: 'Teine test post' });
    expect(state.slug).toBe('custom');
    state = reduceSlugState(state, { type: 'regenerate' });
    expect(state.slug).toBe('teine-test-post');
    expect(state.touched).toBe(false);
  });

  it('never changes the slug of a published item from a title edit', () => {
    let state = createSlugState({ title: 'Teine test post', slug: 'teine-test-post', published: true });
    state = reduceSlugState(state, { type: 'title', value: 'Täiesti uus pealkiri' });
    expect(state.slug).toBe('teine-test-post');
    expect(state.locked).toBe(true);
  });

  it('requires explicit confirmation before a published slug may change', () => {
    expect(assertSlugChangeAllowed({ publishedSlug: 'old-slug', nextSlug: 'new-slug' }).ok).toBe(false);
    expect(assertSlugChangeAllowed({ publishedSlug: 'old-slug', nextSlug: 'new-slug', confirmed: true }).ok).toBe(true);
    expect(assertSlugChangeAllowed({ publishedSlug: 'old-slug', nextSlug: 'old-slug' }).ok).toBe(true);
  });
});

describe('slug validation and duplicate handling', () => {
  it('rejects empty and structurally invalid slugs', () => {
    expect(isValidSlug('')).toBe(false);
    expect(slugProblem('')).toMatch(/required/);
    expect(isValidSlug('has space')).toBe(false);
    expect(isValidSlug('UPPER')).toBe(false);
    expect(isValidSlug('-leading')).toBe(false);
    expect(isValidSlug('trailing-')).toBe(false);
    expect(isValidSlug('double--hyphen')).toBe(false);
    expect(isValidSlug('valid-slug-2')).toBe(true);
  });

  it('does not assume short slugs are invalid', () => {
    expect(isValidSlug('t')).toBe(true);
    expect(isValidSlug('q')).toBe(true);
  });

  it('sanitizes typing without mangling a hyphen in progress', () => {
    expect(sanitizeSlugTyping('My-')).toBe('my-');
    expect(sanitizeSlugTyping('My-Post')).toBe('my-post');
    expect(finalizeSlug('My-')).toBe('my');
  });

  it('adds deterministic suffixes for duplicates', () => {
    const taken = new Set(['teine-test-post', 'teine-test-post-2']);
    expect(uniqueSlug('teine-test-post', taken)).toBe('teine-test-post-3');
  });

  it('detects collisions across imported content, CMS entries and aliases', () => {
    const dataset = {
      posts: [
        { id: 'wp-1', type: 'post', slug: 'imported-post', slugAliases: ['old-imported-slug'] },
        { id: 'cms-1', type: 'post', slug: 'cms-post', slugAliases: [] }
      ],
      pages: [{ id: 'wp-2', type: 'page', slug: 'about', slugAliases: [] }]
    };
    expect(slugAvailability(dataset, 'imported-post').ok).toBe(false);
    expect(slugAvailability(dataset, 'old-imported-slug').ok).toBe(false);
    expect(slugAvailability(dataset, 'about').ok).toBe(false);
    expect(slugAvailability(dataset, 'imported-post', { exceptIds: ['wp-1'] }).ok).toBe(true);
    expect(slugAvailability(dataset, 'fresh-slug').ok).toBe(true);
  });

  it('resolves canonical slugs and preserved aliases', () => {
    const items = [{ id: 'a', slug: 'new-slug', slugAliases: ['old-slug'] }];
    expect(resolveBySlug(items, 'new-slug')?.id).toBe('a');
    expect(resolveBySlug(items, 'old-slug')?.id).toBe('a');
    expect(resolveBySlug(items, 'missing')).toBeNull();
  });

  it('merges aliases when a published slug changes', () => {
    expect(mergeAliases(['older'], 'old-slug', 'new-slug')).toEqual(['old-slug', 'older']);
    expect(mergeAliases(['old-slug'], 'old-slug', 'new-slug')).toEqual(['old-slug']);
  });
});

describe('repair detection for prematurely generated one-character slugs', () => {
  it('flags a one-character slug unrelated to the title but never renames it', () => {
    const findings = findSlugAnomalies({
      drafts: [
        { id: 'draft-1', title: 'Teine test post', slug: 't', sourceKind: 'cms-native' },
        { id: 'draft-2', title: 'Q', slug: 'q', sourceKind: 'cms-native' }
      ],
      published: [{ id: 'cms-1', title: 'Kolmas post', slug: 'k', native: true }]
    });
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ id: 'draft-1', slug: 't', expected: 'teine-test-post', published: false });
    expect(findings[1]).toMatchObject({ id: 'cms-1', published: true });
    expect(findings[1].safeAction).toMatch(/advanced slug change/i);
  });

  it('does not flag genuinely short titles', () => {
    expect(findSlugAnomalies({ drafts: [{ id: 'x', title: 'Q', slug: 'q' }] })).toEqual([]);
    expect(findSlugAnomalies({ drafts: [{ id: 'x', title: 'Teine', slug: 'teine-test' }] })).toEqual([]);
  });
});

describe('save and publish guard for truncated automatic slugs', () => {
  it('blocks the historical one-character latch for a longer untouched title', () => {
    const message = prematureAutoSlugProblem({ title: 'Teine test post', slug: 't', touched: false, locked: false });
    expect(message).toMatch(/only one character/);
    expect(message).toMatch(/first-keystroke/);
    expect(prematureAutoSlugProblem({ title: 'Teine postitus', slug: 't' })).toMatch(/only one character/);
  });

  it('allows a legitimate short title, a manual slug and a published locked slug', () => {
    expect(prematureAutoSlugProblem({ title: 'Q', slug: 'q', touched: false, locked: false })).toBe('');
    expect(prematureAutoSlugProblem({ title: 'Q!', slug: 'q', touched: false, locked: false })).toBe('');
    expect(prematureAutoSlugProblem({ title: 'Teine test post', slug: 't', touched: true, locked: false })).toBe('');
    expect(prematureAutoSlugProblem({ title: 'Teine test post', slug: 't', touched: true, locked: true })).toBe('');
  });

  it('does not block a complete automatic slug', () => {
    expect(prematureAutoSlugProblem({ title: 'Teine test post', slug: 'teine-test-post', touched: false, locked: false })).toBe('');
  });
});

describe('slug set helpers', () => {
  it('excludes the item being edited but includes its aliases', () => {
    const set = slugSetFromItems([
      { id: 'a', slug: 'a-slug', slugAliases: ['a-old'] },
      { id: 'b', slug: 'b-slug', slugAliases: [] }
    ], { exceptIds: ['a'] } as any);
    expect(set.has('a-slug')).toBe(false);
    expect(set.has('b-slug')).toBe(true);
  });
});
