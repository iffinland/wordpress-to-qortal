import { describe, expect, it } from 'vitest';
import { applyAssignment, assignmentFor, emptySections, homePostsFilter, postsForSection, readSections } from '../src/lib/sections.js';
import { parseHashRoute, pageHref } from '../src/lib/routes.js';

const posts = [
  { id: 'a', type: 'post', status: 'published', slug: 'a' },
  { id: 'b', type: 'post', status: 'published', slug: 'b' },
  { id: 'c', type: 'post', status: 'draft', slug: 'c' }
];

describe('qms-cms-sections@1 backward compatibility', () => {
  it('treats a missing document as empty and harmless', () => {
    const r = readSections(null);
    expect(r.ok).toBe(true);
    expect(homePostsFilter(posts, r.doc)).toHaveLength(3);
    expect(postsForSection(posts, r.doc, 'files')).toEqual([]);
  });
  it('treats an invalid document as a warning with a usable empty doc', () => {
    for (const bad of ['x', { schema: 'other' }, { schema: 'qms-cms-sections@1', sections: 'no' }, { schema: 'qms-cms-sections@1', version: 9, sections: [] }]) {
      const r = readSections(bad);
      expect(r.ok).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.doc.sections).toEqual([]);
    }
  });
  it('old route and old index data still work', () => {
    expect(parseHashRoute('#/pages/files')).toEqual({ kind: 'page', slug: 'files' });
    expect(parseHashRoute('#/pages/files?page=2')).toEqual({ kind: 'page', slug: 'files', page: 2 });
    expect(pageHref('files')).toBe('#/pages/files');
  });
});

describe('sections assignment', () => {
  it('assigns, hides from home, reorders and detects conflicts', () => {
    const one = applyAssignment(emptySections(), { postId: 'a', slugs: ['files'], hideFromHome: true }, { baseRevision: 0 });
    expect(one.ok).toBe(true);
    const two = applyAssignment(one.doc, { postId: 'b', slugs: ['files'], hideFromHome: false }, { baseRevision: 1 });
    expect(postsForSection(posts, two.doc, 'files').map((p: any) => p.id)).toEqual(['b', 'a']);
    expect(homePostsFilter(posts, two.doc).map((p: any) => p.id)).toEqual(['b', 'c']);
    expect(assignmentFor(two.doc, 'a')).toEqual({ slugs: ['files'], hideFromHome: true });
    expect(applyAssignment(two.doc, { postId: 'a', slugs: [], hideFromHome: false }, { baseRevision: 0 }).conflict).toBe(true);
    const cleared = applyAssignment(two.doc, { postId: 'a', slugs: [], hideFromHome: false }, { baseRevision: 2 });
    expect(postsForSection(posts, cleared.doc, 'files').map((p: any) => p.id)).toEqual(['b']);
  });
});
