/**
 * Local, resumable drafts. Drafts are convenience state only — they never grant
 * ownership and are never published without a fresh owner revalidation.
 *
 * Storage is scoped by deployment AND the verified owner address. There is no
 * unscoped read path: old unscoped data is counted for a delete-only notice and
 * is never returned as drafts.
 */

import { legacyKey, scopedKey } from './storageScope.js';

const DRAFT_BASE_KEY = 'qms-cms-post-drafts';

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
  if (result.searchPending || result.state === 'partial') return 'partial';
  if (result.state === 'ambiguous' || result.state === 'in-flight') return 'ambiguous';
  return 'failed';
}

function keyFor(scope) {
  return scopedKey(DRAFT_BASE_KEY, scope);
}

export function readDrafts(storage, scope) {
  const key = keyFor(scope);
  if (!storage || !key) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schema !== DRAFT_STORAGE_SCHEMA || !Array.isArray(parsed.drafts)) return [];
    return parsed.drafts;
  } catch {
    return [];
  }
}

export function writeDrafts(storage, scope, drafts) {
  const key = keyFor(scope);
  if (!storage || !key) return false;
  try {
    storage.setItem(key, JSON.stringify({
      schema: DRAFT_STORAGE_SCHEMA,
      version: DRAFT_STORAGE_VERSION,
      siteId: String((scope.binding && scope.binding.siteId) || ''),
      drafts: Array.isArray(drafts) ? drafts : []
    }));
    return true;
  } catch {
    return false;
  }
}

/** Old, unscoped key from versions before per-account storage. */
export function legacyDraftsKey(siteId) {
  return legacyKey(DRAFT_BASE_KEY, siteId);
}

/** Only the number of legacy drafts; their titles and content are never read. */
export function legacyDraftCount(storage, siteId) {
  if (!storage) return 0;
  try {
    const raw = storage.getItem(legacyDraftsKey(siteId));
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.drafts) ? parsed.drafts.length : 0;
  } catch {
    return 0;
  }
}

/** Delete-only action for the legacy bucket; scoped drafts are untouched. */
export function deleteLegacyDrafts(storage, siteId) {
  if (!storage) return false;
  try {
    storage.removeItem(legacyDraftsKey(siteId));
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
    // Featured image: explicit selection, preserved WordPress image, automatic
    // first body image, or an explicit no-image decision.
    featuredImage: overrides.featuredImage || null,
    featuredImageUrl: overrides.featuredImageUrl || '',
    featuredImageAlt: overrides.featuredImageAlt || '',
    featuredImageManual: overrides.featuredImageManual === true,
    featuredImageOrigin: overrides.featuredImageOrigin || null,
    featuredImageSuppressed: overrides.featuredImageSuppressed === true,
    featuredImagePending: overrides.featuredImagePending || null,
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

