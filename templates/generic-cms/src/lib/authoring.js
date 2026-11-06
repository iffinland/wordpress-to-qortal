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
  SEARCH_INDEX_IDENTIFIER,
  upsertSearchEntry
} from './search.js';

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
  const contentIdentifier = draft.contentIdentifier || nativeContentIdentifier(siteId, draft.slug);
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
  const built = nativeEntryFromDraft(draft, { siteId, qdnName: name, contentIdentifier, contentHash, now });
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
  const upserted = upsertSearchEntry(remoteSearch.index, searchEntry, { now });
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

export { serialiseJsonDocument };
