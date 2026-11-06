import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishNativePostDraft, publishOverlayDraft } from '../src/lib/authoring.js';
import { publicationStateForResult } from '../src/lib/drafts.js';
import { ownerIdentity } from './support/fixtures';

afterEach(() => { vi.unstubAllGlobals(); });

function stub(responses: Record<string, any>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    for (const [needle, payload] of Object.entries(responses)) {
      if (String(url).includes(needle)) return { ok: true, status: 200, json: async () => payload };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }));
}

const nativeIndex = (revision: number) => ({
  schema: 'qms-cms-native-index@1',
  version: 1,
  revision,
  site_id: 'site-fixture',
  categories: [],
  tags: [],
  entries: []
});

const baseDraft = {
  id: 'draft-1',
  type: 'post',
  title: 'Teine test post',
  slug: 'teine-test-post',
  html: '<p>Body</p>',
  excerpt: 'Excerpt',
  categoriesText: '',
  tagsText: '',
  author: 'Owner',
  sourceKind: 'cms-native'
};

describe('publication safety states', () => {
  it('blocks a stale native index instead of overwriting a newer revision', async () => {
    stub({ 'qms-cms-native-index': nativeIndex(5) });
    const result = await publishNativePostDraft({
      identity: ownerIdentity,
      name: 'QortalDemo',
      siteId: 'site-fixture',
      draft: baseDraft,
      baseRevision: 0,
      storage: localStorage,
      author: 'Owner',
      timestamp: Date.now()
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe('conflict');
    expect(result.message).toMatch(/Reload before publishing/);
  });

  it('requires explicit confirmation before publishing a changed published slug', async () => {
    stub({});
    const result = await publishNativePostDraft({
      identity: ownerIdentity,
      name: 'QortalDemo',
      siteId: 'site-fixture',
      draft: { ...baseDraft, remoteId: 'cms-1', originalSlug: 'old-slug', slug: 'new-slug', slugChangeConfirmed: false },
      baseRevision: 0,
      storage: localStorage,
      author: 'Owner',
      timestamp: Date.now()
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe('slug-change-requires-confirmation');
  });

  it('blocks overlay publication while an upstream conflict is open', async () => {
    stub({
      'qms-cms-edit-overlay': {
        schema: 'qms-cms-edit-overlay@1',
        version: 1,
        revision: 1,
        entries: [{
          source_item_id: 'wp-42',
          source_type: 'post',
          source_slug: 'imported-title',
          slug: 'imported-title',
          conflict_state: 'open',
          base_source_hash: 'sha256:old'
        }]
      }
    });
    const result = await publishOverlayDraft({
      identity: ownerIdentity,
      name: 'QortalDemo',
      siteId: 'site-fixture',
      draft: {
        ...baseDraft,
        id: 'wp-42',
        sourceKind: 'wordpress-overlay',
        sourceItemId: 'wp-42',
        sourceSlug: 'imported-title',
        originalSlug: 'imported-title',
        slug: 'imported-title',
        baseSourceHash: 'sha256:old'
      },
      baseRevision: 1,
      storage: localStorage,
      author: 'Owner',
      timestamp: Date.now()
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe('source-conflict');
    expect(result.message).toMatch(/Keep my edits or Accept upstream/);
  });

  it('maps verified, pending and ambiguous outcomes to distinct UI states', () => {
    expect(publicationStateForResult({ ok: true })).toBe('published');
    expect(publicationStateForResult({ ok: false, searchPending: true })).toBe('partial');
    expect(publicationStateForResult({ ok: false, state: 'ambiguous' })).toBe('ambiguous');
    expect(publicationStateForResult({ ok: false, state: 'in-flight' })).toBe('ambiguous');
    expect(publicationStateForResult({ ok: false, state: 'failed' })).toBe('failed');
    expect(publicationStateForResult(null)).toBe('failed');
  });
});
