import {
  buildNativeContentPayload,
  emptyNativeIndex,
  mergeTermDefinitions,
  nativeContentIdentifier,
  nativeEntryFromDraft,
  readNativeIndex,
  upsertNativeEntry
} from './nativeCatalog.js';
import {
  buildSettingsDocument,
  detectSettingsConflict,
  mergeSettingsIntoConfig,
  readSettingsDocument,
  SITE_SETTINGS_IDENTIFIER
} from './settings.js';
import {
  emptyGalleryCatalog,
  GALLERY_CATALOG_IDENTIFIER,
  readGalleryCatalog,
  upsertGallery,
  validateGalleryDraft
} from './gallery.js';
import {
  fetchPublishedSettings,
  publishJsonResource,
  readRemoteJson,
  serialiseJsonDocument
} from './publish.js';
import { sha256Hex } from './qortal.js';
import {
  createSearchEntryFromDraft,
  emptySearchIndex,
  readSearchIndex,
  removeSearchEntry,
  SEARCH_INDEX_IDENTIFIER,
  upsertSearchEntry
} from './search.js';
import {
  createOverlayEntry,
  emptyOverlay,
  findOverlayEntry,
  markOverlayConflict,
  OVERLAY_IDENTIFIER,
  overlayContentIdentifier,
  readOverlay,
  removeOverlayEntry,
  upsertOverlayEntry
} from './overlay.js';
import { assertSlugChangeAllowed } from './slugField.js';
import { mergeAliases, slugify } from './slug.js';

export async function loadPublishedSettings(name) {
  const payload = await fetchPublishedSettings(name);
  if (!payload) return { ok: true, settings: null, errors: [] };
  return readSettingsDocument(payload);
}

export async function publishSettingsDraft({ identity, name, draft, baseRevision, storage, timestamp }) {
  const remotePayload = await fetchPublishedSettings(name);
  const remote = remotePayload ? readSettingsDocument(remotePayload) : { ok: true, settings: null };
  if (!remote.ok) return { ok: false, state: 'invalid-remote', message: 'Published settings are invalid and were not overwritten: ' + remote.errors.join(' ') };
  const remoteSettings = remote.ok ? remote.settings : null;
  const conflict = detectSettingsConflict(remoteSettings, baseRevision);
  if (conflict.conflict) return { ok: false, state: 'conflict', message: conflict.message };
  const document = await buildSettingsDocument({ draft, baseRevision, identity, now: timestamp || Date.now() });
  const result = await publishJsonResource({
    identity, name, identifier: SITE_SETTINGS_IDENTIFIER, document,
    title: 'CMS site settings revision ' + document.revision,
    description: 'Owner-published CMS settings for ' + name + '.',
    storage
  });
  return { ...result, document };
}

export async function loadNativeIndex(name) {
  const payload = await readRemoteJson('DOCUMENT', name, 'qms-cms-native-index');
  if (!payload) return { ok: true, index: emptyNativeIndex(), errors: [] };
  return readNativeIndex(payload);
}

export async function publishNativePostDraft({ identity, name, siteId, draft, baseRevision, storage, author, timestamp }) {
  const remote = await loadNativeIndex(name);
  if (!remote.ok) return { ok: false, state: 'invalid-remote', message: remote.errors.join(' ') };
  const index = remote.index;
  const conflict = Number(index.revision) > Number(baseRevision || 0);
  if (conflict) {
    return { ok: false, state: 'conflict', message: 'CMS content moved from revision ' + baseRevision + ' to ' + index.revision + '. Reload before publishing.' };
  }
  const nextSlug = slugify(draft.slug || draft.title);
  const previousSlug = String(draft.originalSlug || '');
  const slugChanged = Boolean(previousSlug && previousSlug !== nextSlug);
  // A published slug may only change as an explicit advanced action. The old
  // content resource is never overwritten or deleted; the old URL becomes an alias.
  const slugGuard = assertSlugChangeAllowed({
    publishedSlug: previousSlug,
    nextSlug,
    confirmed: draft.slugChangeConfirmed === true
  });
  if (!slugGuard.ok) {
    return { ok: false, state: 'slug-change-requires-confirmation', message: slugGuard.message };
  }
  const slugAliases = mergeAliases(draft.slugAliases, previousSlug, nextSlug);
  const contentIdentifier = slugChanged
    ? nativeContentIdentifier(siteId, nextSlug)
    : (draft.contentIdentifier || nativeContentIdentifier(siteId, nextSlug));
  const now = Number(timestamp) || Date.now();
  const htmlBytes = new TextEncoder().encode(draft.html || '');
  const contentHash = 'sha256:' + await sha256Hex(htmlBytes);
  const payload = buildNativeContentPayload({ ...draft, author: author || draft.author }, { contentIdentifier, qdnName: name, contentHash, now });
  const contentResult = await publishJsonResource({
    identity, name, identifier: contentIdentifier, document: payload,
    title: draft.title,
    description: 'CMS-authored content for ' + name + '.',
    storage
  });
  if (!contentResult.ok) return { ...contentResult, stage: 'content' };
  const built = nativeEntryFromDraft({ ...draft, slug: nextSlug, slugAliases }, { siteId, qdnName: name, contentIdentifier, contentHash, now });
  const updated = upsertNativeEntry(index, built.entry, {
    baseRevision, siteId, identity, now,
    categories: built.categories, tags: built.tags
  });
  if (!updated.ok) return { ok: false, state: 'conflict', message: updated.message, stage: 'index', contentResult };
  const indexResult = await publishJsonResource({
    identity, name, identifier: 'qms-cms-native-index', document: updated.index,
    title: 'CMS content index revision ' + updated.index.revision,
    description: 'CMS-authored content supplement for ' + name + '. Imported QMS content is not modified.',
    storage
  });
  if (!indexResult.ok) return { ...indexResult, stage: 'index', contentResult, index: updated.index };

  // The full-text index is a separate versioned document. A post is not
  // reported as fully published if its search entry could not be written.
  const searchEntry = createSearchEntryFromDraft({
    ...draft,
    status: 'published',
    html: draft.html,
    excerpt: draft.excerpt,
    updatedAt: new Date(now).toISOString()
  });
  const remoteSearchRaw = await readRemoteJson('DOCUMENT', name, SEARCH_INDEX_IDENTIFIER);
  const remoteSearch = remoteSearchRaw ? readSearchIndex(remoteSearchRaw) : { ok: true, index: emptySearchIndex(siteId), errors: [] };
  if (!remoteSearch.ok) {
    return {
      ok: false,
      state: 'invalid-remote',
      stage: 'search',
      message: 'The published search index is invalid and was not overwritten. Rebuild it before publishing.',
      contentResult,
      indexResult,
      index: updated.index
    };
  }
  // Remove the previous slug from the CMS search document when an explicit
  // slug change happened; the imported search index is never modified.
  const searchBase = slugChanged
    ? removeSearchEntry(remoteSearch.index, { id: draft.id, type: draft.type, slug: previousSlug }, { now }).index
    : remoteSearch.index;
  const upserted = upsertSearchEntry(searchBase, { ...searchEntry, slug: nextSlug }, { now });
  if (!upserted.ok) {
    return { ok: false, state: 'invalid', stage: 'search', message: upserted.message, contentResult, indexResult, index: updated.index };
  }
  const searchResult = await publishJsonResource({
    identity, name, identifier: SEARCH_INDEX_IDENTIFIER, document: upserted.index,
    title: 'Search index revision ' + upserted.index.revision,
    description: 'Full-text search index for CMS-authored and imported content on ' + name + '.',
    storage
  });
  if (!searchResult.ok) {
    return {
      ...searchResult,
      stage: 'search',
      message: 'The post and catalog entry were verified, but the search index was not confirmed: ' + (searchResult.message || 'unknown error') + ' Republish after verification so search stays consistent.',
      contentResult,
      indexResult,
      index: updated.index,
      searchPending: true
    };
  }

  return {
    ok: true,
    state: 'remote-verified',
    contentResult,
    indexResult,
    searchResult,
    index: updated.index,
    contentIdentifier,
    contentHash,
    slugAliases,
    entry: built.entry
  };
}

export async function loadGalleryCatalog(name) {
  const payload = await readRemoteJson('DOCUMENT', name, GALLERY_CATALOG_IDENTIFIER);
  if (!payload) return { ok: true, catalog: emptyGalleryCatalog(), errors: [] };
  return readGalleryCatalog(payload);
}

export async function publishGalleryDraft({ identity, name, siteId, gallery, newImageCount, baseRevision, storage, now }) {
  const remote = await loadGalleryCatalog(name);
  if (!remote.ok) return { ok: false, state: 'invalid-remote', message: 'Published galleries are invalid and were not overwritten: ' + remote.errors.join(' ') };
  const validation = validateGalleryDraft(gallery, { newImages: new Array(Number(newImageCount) || 0) });
  if (!validation.ok) return { ok: false, state: 'invalid', message: validation.errors.join(' ') };
  const updated = upsertGallery(remote.catalog, gallery, { baseRevision, siteId, identity, now: now || Date.now() });
  if (!updated.ok) return { ok: false, state: 'conflict', message: updated.message };
  const result = await publishJsonResource({
    identity, name, identifier: GALLERY_CATALOG_IDENTIFIER, document: updated.catalog,
    title: 'Gallery catalog revision ' + updated.catalog.revision,
    description: 'Owner-published gallery catalog for ' + name + '.',
    storage
  });
  return { ...result, catalog: updated.catalog };
}

export function applyPublishedSettings(config, settings, qdnName) {
  return mergeSettingsIntoConfig(config, settings, { qdnName });
}

export function mergeTermsForDraft(existing, values) {
  return mergeTermDefinitions(existing, values);
}

export async function loadOverlay(name) {
  const payload = await readRemoteJson('DOCUMENT', name, OVERLAY_IDENTIFIER);
  if (!payload) return { ok: true, overlay: emptyOverlay(), errors: [] };
  return readOverlay(payload);
}

/**
 * Publish an owner edit of imported WordPress content.
 *
 * Order: CMS content resource (qms-qdn-content@1) -> edit overlay document ->
 * shared search index. Imported resources are never written. An open upstream
 * conflict blocks publication until the owner explicitly resolves it.
 */
export async function publishOverlayDraft(options) {
  const { identity, name, siteId, draft, baseRevision, storage, author, timestamp } = options;
  const remote = await loadOverlay(name);
  if (!remote.ok) return { ok: false, state: 'invalid-remote', message: 'The published edit overlay is invalid and was not overwritten: ' + remote.errors.join(' ') };
  const overlay = remote.overlay;
  if (Number(overlay.revision) > Number(baseRevision || 0)) {
    return { ok: false, state: 'conflict', message: 'Local edits moved from revision ' + baseRevision + ' to ' + overlay.revision + '. Reload before publishing.' };
  }
  const existing = findOverlayEntry(overlay, draft.sourceItemId);
  const nextSlug = slugify(draft.slug || draft.title);
  const previousSlug = String(draft.originalSlug || draft.sourceSlug || '');
  const slugGuard = assertSlugChangeAllowed({
    publishedSlug: previousSlug,
    nextSlug,
    confirmed: draft.slugChangeConfirmed === true
  });
  if (!slugGuard.ok) {
    return { ok: false, state: 'slug-change-requires-confirmation', message: slugGuard.message };
  }
  if (existing && existing.conflict_state === 'open' && draft.conflictResolved !== true) {
    return {
      ok: false,
      state: 'source-conflict',
      message: 'The WordPress source changed after this local edit. Review the conflict and choose Keep my edits or Accept upstream before publishing.'
    };
  }
  const now = Number(timestamp) || Date.now();
  const contentIdentifier = overlayContentIdentifier(siteId, draft.sourceItemId);
  const htmlBytes = new TextEncoder().encode(draft.html || '');
  const contentHash = 'sha256:' + await sha256Hex(htmlBytes);
  const payload = buildNativeContentPayload(
    { ...draft, slug: nextSlug, author: author || draft.author },
    { contentIdentifier, qdnName: name, contentHash, now }
  );
  // Provenance: same qms-qdn-content@1 schema, explicit WordPress source mapping.
  payload.source = {
    adapter: 'wordpress-overlay',
    key: String(draft.sourceItemId),
    source_adapter: 'wordpress',
    source_id: draft.sourceId == null ? null : draft.sourceId,
    source_slug: draft.sourceSlug || previousSlug,
    source_modified_at: draft.sourceModifiedAt || null,
    imported_content: draft.sourceRef || null
  };
  const contentResult = await publishJsonResource({
    identity, name, identifier: contentIdentifier, document: payload,
    title: draft.title,
    description: 'Owner edit of imported WordPress content for ' + name + '. The imported resource is unchanged.',
    storage
  });
  if (!contentResult.ok) return { ...contentResult, stage: 'content' };
  const entry = createOverlayEntry({
    item: {
      id: draft.sourceItemId,
      type: draft.type,
      slug: draft.sourceSlug || previousSlug,
      title: draft.sourceTitle || draft.title,
      categoryIds: draft.sourceCategoryIds || [],
      tagIds: draft.sourceTagIds || [],
      legacy: { sourceId: draft.sourceId, oldUrl: draft.sourceOldUrl },
      updatedAt: draft.sourceModifiedAt || null
    },
    content: { title: draft.title, html: draft.html || '', excerpt: draft.excerpt || '', modifiedAt: draft.sourceModifiedAt || null },
    draft: { ...draft, slug: nextSlug, slugAliases: mergeAliases(draft.slugAliases, previousSlug, nextSlug) },
    contentRef: { service: 'DOCUMENT', name, identifier: contentIdentifier },
    contentHash,
    baseSourceHash: draft.baseSourceHash || '',
    identity,
    now
  });
  const updated = upsertOverlayEntry(overlay, entry, { baseRevision, siteId, identity, now });
  if (!updated.ok) return { ok: false, state: 'conflict', message: updated.message, stage: 'overlay', contentResult };
  const overlayResult = await publishJsonResource({
    identity, name, identifier: OVERLAY_IDENTIFIER, document: updated.overlay,
    title: 'CMS edit overlay revision ' + updated.overlay.revision,
    description: 'Owner edits of imported WordPress content for ' + name + '. Imported resources are not modified.',
    storage
  });
  if (!overlayResult.ok) {
    return { ...overlayResult, stage: 'overlay', contentResult, overlay: updated.overlay };
  }
  const searchEntry = createSearchEntryFromDraft({ ...draft, status: 'published', html: draft.html, excerpt: draft.excerpt, slug: nextSlug });
  const remoteSearchRaw = await readRemoteJson('DOCUMENT', name, SEARCH_INDEX_IDENTIFIER);
  const remoteSearch = remoteSearchRaw ? readSearchIndex(remoteSearchRaw) : { ok: true, index: emptySearchIndex(siteId), errors: [] };
  if (!remoteSearch.ok) {
    return { ok: false, state: 'invalid-remote', stage: 'search', message: 'The published search index is invalid and was not overwritten.', contentResult, overlayResult, overlay: updated.overlay };
  }
  const searchBase = previousSlug && previousSlug !== nextSlug
    ? removeSearchEntry(remoteSearch.index, { id: draft.sourceItemId, type: draft.type, slug: previousSlug }, { now }).index
    : remoteSearch.index;
  const upserted = upsertSearchEntry(searchBase, { ...searchEntry, id: draft.sourceItemId, slug: nextSlug }, { now });
  if (!upserted.ok) {
    return { ok: false, state: 'invalid', stage: 'search', message: upserted.message, contentResult, overlayResult, overlay: updated.overlay };
  }
  const searchResult = await publishJsonResource({
    identity, name, identifier: SEARCH_INDEX_IDENTIFIER, document: upserted.index,
    title: 'Search index revision ' + upserted.index.revision,
    description: 'Full-text search index for CMS-authored, edited and imported content on ' + name + '.',
    storage
  });
  if (!searchResult.ok) {
    return {
      ...searchResult,
      stage: 'search',
      message: 'The edit was verified, but the search index was not confirmed: ' + (searchResult.message || 'unknown error'),
      contentResult, overlayResult, overlay: updated.overlay, searchPending: true
    };
  }
  return {
    ok: true,
    state: 'remote-verified',
    contentResult,
    overlayResult,
    searchResult,
    overlay: updated.overlay,
    contentIdentifier,
    contentHash,
    entry
  };
}

/**
 * Resolve an upstream/local conflict without touching imported resources.
 * keep-local rebases the stored source fingerprint; accept-upstream removes the
 * local overlay entry so the imported content is shown again.
 */
export async function resolveOverlayConflict(options) {
  const { identity, name, siteId, sourceItemId, resolution, baseRevision, storage, now } = options;
  const remote = await loadOverlay(name);
  if (!remote.ok) return { ok: false, state: 'invalid-remote', message: remote.errors.join(' ') };
  const overlay = remote.overlay;
  if (Number(overlay.revision) > Number(baseRevision || 0)) {
    return { ok: false, state: 'conflict', message: 'Local edits changed on another device. Reload before resolving.' };
  }
  const removedEntry = findOverlayEntry(overlay, sourceItemId);
  let next;
  if (resolution === 'accept-upstream') {
    next = removeOverlayEntry(overlay, sourceItemId, { baseRevision, siteId, now });
  } else if (resolution === 'keep-local') {
    const marked = markOverlayConflict(overlay, sourceItemId, {
      conflict: false,
      baseSourceHash: options.currentSourceHash,
      baseSourceModifiedAt: options.currentSourceModifiedAt,
      now
    });
    const entry = findOverlayEntry(marked, sourceItemId);
    if (!entry) return { ok: false, state: 'invalid', message: 'The local edit no longer exists. Reload.' };
    next = upsertOverlayEntry(marked, entry, { baseRevision, siteId, identity, now });
  } else {
    return { ok: false, state: 'invalid', message: 'Unknown conflict resolution.' };
  }
  if (!next.ok) return { ok: false, state: 'conflict', message: next.message };
  const result = await publishJsonResource({
    identity, name, identifier: OVERLAY_IDENTIFIER, document: next.overlay,
    title: 'CMS edit overlay revision ' + next.overlay.revision,
    description: 'Owner edits of imported WordPress content for ' + name + '.',
    storage
  });
  if (!result.ok) return { ...result, overlay: next.overlay };

  // Accepting upstream also removes the stale local search entry. Otherwise
  // the CMS search document would keep showing the removed local title because
  // the CMS entry wins over the imported entry for the same item.
  if (resolution === 'accept-upstream') {
    const remoteSearchRaw = await readRemoteJson('DOCUMENT', name, SEARCH_INDEX_IDENTIFIER);
    const remoteSearch = remoteSearchRaw ? readSearchIndex(remoteSearchRaw) : { ok: true, index: emptySearchIndex(siteId), errors: [] };
    if (!remoteSearch.ok) {
      return {
        ...result,
        overlay: next.overlay,
        searchPending: true,
        message: 'The local edit was removed, but the CMS search index is invalid and was not changed. Rebuild or republish search.'
      };
    }
    const cleaned = removeSearchEntry(remoteSearch.index, { id: sourceItemId }, { now });
    const searchResult = await publishJsonResource({
      identity, name, identifier: SEARCH_INDEX_IDENTIFIER, document: cleaned.index,
      title: 'Search index revision ' + cleaned.index.revision,
      description: 'Search index cleanup after accepting upstream content on ' + name + '.',
      storage
    });
    if (!searchResult.ok) {
      return {
        ...result,
        overlay: next.overlay,
        searchResult,
        searchPending: true,
        message: 'The local edit was removed, but the search-index cleanup was not confirmed: ' + (searchResult.message || 'unknown error')
      };
    }
    return { ...result, overlay: next.overlay, searchResult, removedEntry };
  }
  return { ...result, overlay: next.overlay, removedEntry };
}

export { serialiseJsonDocument };
