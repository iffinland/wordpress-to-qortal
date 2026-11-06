/**
 * Local, resumable drafts. Drafts are convenience state only — they never grant
 * ownership and are never published without a fresh owner revalidation.
 */

export const DRAFT_STORAGE_SCHEMA = 'qms-cms-post-drafts@1';
export const DRAFT_STORAGE_VERSION = 1;

/** Explicit publication states; ambiguous outcomes are always distinct. */
export const PUBLICATION_STATES = Object.freeze([
  'draft',
  'modified-unpublished',
  'pending-approval',
  'pending-confirmation',
  'published',
  'partial',
  'failed',
  'ambiguous'
]);

/** Human labels used by the editor. A local draft is never "published". */
export const PUBLICATION_STATE_LABELS = Object.freeze({
  draft: 'Local draft — not published',
  'modified-unpublished': 'Modified — not published',
  'pending-approval': 'Awaiting your approval',
  'pending-confirmation': 'Pending Hub confirmation',
  published: 'Published and verified',
  partial: 'Published, search index pending',
  failed: 'Not published',
  ambiguous: 'Publication unconfirmed — not resent'
});

export function publicationStateForResult(result) {
  if (!result || typeof result !== 'object') return 'failed';
  if (result.ok) return 'published';
  if (result.searchPending) return 'partial';
  if (result.state === 'ambiguous' || result.state === 'in-flight') return 'ambiguous';
  return 'failed';
}

function keyFor(siteId) {
  return 'qms-cms-post-drafts:' + String(siteId || 'site');
}

export function readDrafts(storage, siteId) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(keyFor(siteId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schema !== DRAFT_STORAGE_SCHEMA || !Array.isArray(parsed.drafts)) return [];
    return parsed.drafts;
  } catch {
    return [];
  }
}

export function writeDrafts(storage, siteId, drafts) {
  if (!storage) return false;
  try {
    storage.setItem(keyFor(siteId), JSON.stringify({
      schema: DRAFT_STORAGE_SCHEMA,
      version: DRAFT_STORAGE_VERSION,
      siteId: String(siteId || 'site'),
      drafts: Array.isArray(drafts) ? drafts : []
    }));
    return true;
  } catch {
    return false;
  }
}

export function createDraft(overrides = {}, now = Date.now()) {
  const stamp = new Date(now).toISOString();
  return {
    id: overrides.id || 'draft-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    type: overrides.type === 'page' ? 'page' : 'post',
    title: overrides.title || '',
    slug: overrides.slug || '',
    html: overrides.html || '',
    excerpt: overrides.excerpt || '',
    categoriesText: overrides.categoriesText || '',
    tagsText: overrides.tagsText || '',
    author: overrides.author || '',
    status: overrides.status || 'draft',
    createdAt: overrides.createdAt || stamp,
    updatedAt: stamp,
    publishedAt: overrides.publishedAt || null,
    publicationState: 'draft',
    publicationMessage: '',
    baseRevision: Number(overrides.baseRevision) || 0,
    remoteId: overrides.remoteId || null,
    contentIdentifier: overrides.contentIdentifier || null,
    pendingHash: null,
    // Slug provenance: auto-generated, manual, or locked because published.
    slugTouched: overrides.slugTouched === true,
    slugLocked: overrides.slugLocked === true,
    slugChangeConfirmed: overrides.slugChangeConfirmed === true,
    originalSlug: overrides.originalSlug || '',
    slugAliases: Array.isArray(overrides.slugAliases) ? [...overrides.slugAliases] : [],
    // Editing model: CMS-authored content or a WordPress-imported overlay.
    sourceKind: overrides.sourceKind === 'wordpress-overlay' ? 'wordpress-overlay' : 'cms-native',
    sourceItemId: overrides.sourceItemId || null,
    sourceSlug: overrides.sourceSlug || '',
    sourceRef: overrides.sourceRef || null,
    baseSourceHash: overrides.baseSourceHash || null,
    baseSourceModifiedAt: overrides.baseSourceModifiedAt || null,
    savedSnapshot: overrides.savedSnapshot || null
  };
}

export function upsertDraft(drafts, draft, now = Date.now()) {
  const current = Array.isArray(drafts) ? drafts : [];
  const next = { ...draft, updatedAt: new Date(now).toISOString() };
  const index = current.findIndex((item) => item.id === next.id);
  if (index >= 0) {
    const copy = [...current];
    copy[index] = next;
    return copy;
  }
  return [next, ...current];
}

export function removeDraft(drafts, id) {
  return (Array.isArray(drafts) ? drafts : []).filter((draft) => draft.id !== id);
}

export function parseTerms(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry, index, list) => list.findIndex((other) => other.toLowerCase() === entry.toLowerCase()) === index)
    .slice(0, 20);
}

