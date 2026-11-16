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
  publishBatch,
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
import { applyAssignment, readSections, SECTIONS_IDENTIFIER } from './sections.js';
import { assertSlugChangeAllowed } from './slugField.js';
import { mergeAliases, slugify } from './slug.js';
import { featuredMediaEntry, resolveFeaturedImage } from './featuredImage.js';


function describeBatch(batch) {
  const byStage = {};
  for (const entry of batch.results || []) byStage[entry.stage] = entry;
  const failed = (batch.results || []).find((entry) => !entry.ok);
  return { byStage, failed };
}

/** Map a batch outcome to the legacy per-stage result shape used by the editor. */
function batchOutcome(batch, extras) {
  const { byStage, failed } = describeBatch(batch);
  const stageResults = {
    contentResult: byStage.content,
    indexResult: byStage.index,
    overlayResult: byStage.overlay,
    searchResult: byStage.search,
    sectionsResult: byStage.sections,
    mediaResult: byStage.media,
    batchResults: batch.results || [],
    fallbackUsed: Boolean(batch.fallbackUsed)
  };
  if (batch.ok) return { ok: true, state: 'remote-verified', ...stageResults, ...extras };
  const stage = failed ? failed.stage : undefined;
  const detail = stage === 'search' || stage === 'sections'
    ? (stage === 'search' ? 'The post and catalog entry were verified, but the search index was not confirmed: ' : 'The post was verified, but the page assignments were not confirmed: ') + (batch.message || 'unknown error') + ' Republish after verification so the site stays consistent.'
    : batch.message;
  return {
    ok: false,
    state: batch.state,
    stage,
    message: detail,
    searchPending: batch.state === 'partial' && (stage === 'search' || stage === 'sections'),
    ...stageResults,
    ...extras
  };
}

/** Build the optional sections-document resource. Returns { error } or { resource, doc }. */
async function buildSectionsStage({ name, siteId, assignment, baseRevision, now }) {
  if (!assignment) return { resource: null };
  const remote = await loadSectionsDocument(name, siteId);
  if (!remote.ok) return { error: { ok: false, state: 'invalid-remote', stage: 'sections', message: 'The published sections document is invalid and was not overwritten: ' + remote.errors.join(' ') } };
  const updated = applyAssignment(remote.doc, assignment, { baseRevision: Math.max(Number(baseRevision) || 0, Number(remote.doc.revision) || 0), siteId, now });
  if (!updated.ok) return { error: { ok: false, state: 'conflict', stage: 'sections', message: updated.message } };
  return {
    doc: updated.doc,
    resource: {
      stage: 'sections', identifier: SECTIONS_IDENTIFIER, document: updated.doc,
      title: 'CMS sections revision ' + updated.doc.revision,
      description: 'Owner-published page assignments for ' + name + '.'
    }
  };
}

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
  const batch = await publishBatch({
    identity, name, storage,
    resources: [{
      stage: 'settings', identifier: SITE_SETTINGS_IDENTIFIER, document,
      title: 'CMS site settings revision ' + document.revision,
      description: 'Owner-published CMS settings for ' + name + '.'
    }]
  });
  const result = batch.results && batch.results[0] ? { ...batch.results[0], ok: batch.ok, state: batch.state, message: batch.message } : { ok: false, state: batch.state, message: batch.message };
  return { ...result, document };
}

export async function loadNativeIndex(name, siteId = '') {
  const payload = await readRemoteJson('DOCUMENT', name, 'qms-cms-native-index');
  if (!payload) return { ok: true, index: emptyNativeIndex(siteId), errors: [] };
  return readNativeIndex(payload);
}

export async function publishNativePostDraft({ identity, name, siteId, draft, baseRevision, storage, author, timestamp, extraResources = /** @type {any[]} */ ([]), sectionsAssignment = /** @type {any} */ (null), onProgress = /** @type {any} */ (undefined) }) {
  const remote = await loadNativeIndex(name, siteId);
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
  const featured = draft.featuredImageResolved || resolveFeaturedImage(draft, null, { name });
  const mediaDocument = {
    featured: featuredMediaEntry(featured, name),
    images: Array.isArray(draft.media) ? draft.media : [],
    audio: [],
    video: [],
    documents: [],
    embeds: [],
    attachments: []
  };
  const htmlBytes = new TextEncoder().encode(JSON.stringify({ html: draft.html || '', featured: featured.ref || featured.url || null }));
  const contentHash = 'sha256:' + await sha256Hex(htmlBytes);
  const payload = buildNativeContentPayload({ ...draft, author: author || draft.author, featuredImageResolved: featured, mediaDocument }, { contentIdentifier, qdnName: name, contentHash, now });
  const stages = [];
  if (Array.isArray(extraResources)) stages.push(...extraResources);
  stages.push({
    stage: 'content', identifier: contentIdentifier, document: payload,
    title: draft.title,
    description: 'CMS-authored content for ' + name + '.'
  });
  const built = nativeEntryFromDraft({ ...draft, slug: nextSlug, slugAliases, featuredImageResolved: featured }, { siteId, qdnName: name, contentIdentifier, contentHash, now });
  const updated = upsertNativeEntry(index, built.entry, {
    baseRevision, siteId, identity, now,
    categories: built.categories, tags: built.tags
  });
  if (!updated.ok) return { ok: false, state: 'conflict', message: updated.message, stage: 'index' };
  stages.push({
    stage: 'index', identifier: 'qms-cms-native-index', document: updated.index,
    title: 'CMS content index revision ' + updated.index.revision,
    description: 'CMS-authored content supplement for ' + name + '. Imported QMS content is not modified.'
  });

  // The full-text index is a separate versioned document, computed before the
  // single approval so nothing is published when it is invalid.
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
    return { ok: false, state: 'invalid-remote', stage: 'search', message: 'The published search index is invalid and was not overwritten. Rebuild it before publishing.' };
  }
  const searchBase = slugChanged
    ? removeSearchEntry(remoteSearch.index, { id: draft.id, type: draft.type, slug: previousSlug }, { now }).index
    : remoteSearch.index;
  const upserted = upsertSearchEntry(searchBase, { ...searchEntry, slug: nextSlug }, { now });
  if (!upserted.ok) return { ok: false, state: 'invalid', stage: 'search', message: upserted.message };
  stages.push({
    stage: 'search', identifier: SEARCH_INDEX_IDENTIFIER, document: upserted.index,
    title: 'Search index revision ' + upserted.index.revision,
    description: 'Full-text search index for CMS-authored and imported content on ' + name + '.'
  });
  const sectionsStage = await buildSectionsStage({
    name, siteId, now,
    assignment: sectionsAssignment ? { ...sectionsAssignment, postId: built.entry.id } : null,
    baseRevision: sectionsAssignment ? sectionsAssignment.baseRevision : 0
  });
  if (sectionsStage.error) return sectionsStage.error;
  if (sectionsStage.resource) stages.push(sectionsStage.resource);

  const batch = await publishBatch({ identity, name, resources: stages, storage, onProgress });
  return batchOutcome(batch, {
    index: updated.index,
    sections: sectionsStage.doc || null,
    contentIdentifier,
    contentHash,
    slugAliases,
    entry: built.entry
  });
}

export async function loadGalleryCatalog(name) {
  const payload = await readRemoteJson('DOCUMENT', name, GALLERY_CATALOG_IDENTIFIER);
  if (!payload) return { ok: true, catalog: emptyGalleryCatalog(), errors: [] };
  return readGalleryCatalog(payload);
}

export async function publishGalleryDraft({ identity, name, siteId, gallery, newImageCount, baseRevision, storage, now, extraResources = /** @type {any[]} */ ([]) }) {
  const remote = await loadGalleryCatalog(name);
  if (!remote.ok) return { ok: false, state: 'invalid-remote', message: 'Published galleries are invalid and were not overwritten: ' + remote.errors.join(' ') };
  const validation = validateGalleryDraft(gallery, { newImages: new Array(Number(newImageCount) || 0) });
  if (!validation.ok) return { ok: false, state: 'invalid', message: validation.errors.join(' ') };
  const updated = upsertGallery(remote.catalog, gallery, { baseRevision, siteId, identity, now: now || Date.now() });
  if (!updated.ok) return { ok: false, state: 'conflict', message: updated.message };
  const batch = await publishBatch({
    identity, name, storage,
    resources: [
      ...(Array.isArray(extraResources) ? extraResources : []),
      {
        stage: 'catalog', identifier: GALLERY_CATALOG_IDENTIFIER, document: updated.catalog,
        title: 'Gallery catalog revision ' + updated.catalog.revision,
        description: 'Owner-published gallery catalog for ' + name + '.'
      }
    ]
  });
  const mediaFailed = (batch.results || []).filter((entry) => entry.stage !== 'catalog' && !entry.ok);
  return { ok: batch.ok, state: batch.state, message: batch.message, results: batch.results, fallbackUsed: Boolean(batch.fallbackUsed), failedImages: mediaFailed.map((entry) => entry.identifier), catalog: updated.catalog };
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
  const featured = draft.featuredImageResolved || resolveFeaturedImage(draft, null, { name });
  const mediaDocument = {
    featured: featuredMediaEntry(featured, name),
    images: Array.isArray(draft.media) ? draft.media : [],
    audio: [],
    video: [],
    documents: [],
    embeds: [],
    attachments: []
  };
  const htmlBytes = new TextEncoder().encode(JSON.stringify({ html: draft.html || '', featured: featured.ref || featured.url || null }));
  const contentHash = 'sha256:' + await sha256Hex(htmlBytes);
  const payload = buildNativeContentPayload(
    { ...draft, slug: nextSlug, author: author || draft.author, featuredImageResolved: featured, mediaDocument },
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
  const stages = [];
  if (Array.isArray(options.extraResources)) stages.push(...options.extraResources);
  stages.push({
    stage: 'content', identifier: contentIdentifier, document: payload,
    title: draft.title,
    description: 'Owner edit of imported WordPress content for ' + name + '. The imported resource is unchanged.'
  });
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
    featuredImage: featured,
    baseSourceHash: draft.baseSourceHash || '',
    identity,
    now
  });
  const updated = upsertOverlayEntry(overlay, entry, { baseRevision, siteId, identity, now });
  if (!updated.ok) return { ok: false, state: 'conflict', message: updated.message, stage: 'overlay' };
  stages.push({
    stage: 'overlay', identifier: OVERLAY_IDENTIFIER, document: updated.overlay,
    title: 'CMS edit overlay revision ' + updated.overlay.revision,
    description: 'Owner edits of imported WordPress content for ' + name + '. Imported resources are not modified.'
  });
  const searchEntry = createSearchEntryFromDraft({ ...draft, status: 'published', html: draft.html, excerpt: draft.excerpt, slug: nextSlug });
  const remoteSearchRaw = await readRemoteJson('DOCUMENT', name, SEARCH_INDEX_IDENTIFIER);
  const remoteSearch = remoteSearchRaw ? readSearchIndex(remoteSearchRaw) : { ok: true, index: emptySearchIndex(siteId), errors: [] };
  if (!remoteSearch.ok) {
    return { ok: false, state: 'invalid-remote', stage: 'search', message: 'The published search index is invalid and was not overwritten.' };
  }
  const searchBase = previousSlug && previousSlug !== nextSlug
    ? removeSearchEntry(remoteSearch.index, { id: draft.sourceItemId, type: draft.type, slug: previousSlug }, { now }).index
    : remoteSearch.index;
  const upserted = upsertSearchEntry(searchBase, { ...searchEntry, id: draft.sourceItemId, slug: nextSlug }, { now });
  if (!upserted.ok) return { ok: false, state: 'invalid', stage: 'search', message: upserted.message };
  stages.push({
    stage: 'search', identifier: SEARCH_INDEX_IDENTIFIER, document: upserted.index,
    title: 'Search index revision ' + upserted.index.revision,
    description: 'Full-text search index for CMS-authored, edited and imported content on ' + name + '.'
  });
  const sectionsAssignment = options.sectionsAssignment;
  const sectionsStage = await buildSectionsStage({
    name, siteId, now,
    assignment: sectionsAssignment ? { ...sectionsAssignment, postId: String(draft.sourceItemId) } : null,
    baseRevision: sectionsAssignment ? sectionsAssignment.baseRevision : 0
  });
  if (sectionsStage.error) return sectionsStage.error;
  if (sectionsStage.resource) stages.push(sectionsStage.resource);

  const batch = await publishBatch({ identity, name, resources: stages, storage, onProgress: options.onProgress });
  return batchOutcome(batch, {
    overlay: updated.overlay,
    sections: sectionsStage.doc || null,
    contentIdentifier,
    contentHash,
    entry
  });
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

export async function loadSectionsDocument(name, siteId = 'site') {
  try {
    const payload = await readRemoteJson('DOCUMENT', name, SECTIONS_IDENTIFIER);
    return readSections(payload, siteId);
  } catch (error) {
    return { ok: false, errors: [error && error.message ? error.message : String(error)], doc: readSections(null, siteId).doc };
  }
}
