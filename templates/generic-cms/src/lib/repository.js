import {
  CatalogError,
  createErrorDataset,
  loadCmsDataset,
  normalizeContentPayload,
  normalizeManifest
} from './manifest.js';
import { createQdnResourceUrl, discoverHostedQdnResource, fetchQdnResource, safeDecodeQdnName } from './qortal.js';
import { rewriteMediaUrls } from './media.js';
import { mergeNativeCatalog, readNativeIndex, NATIVE_INDEX_IDENTIFIER } from './nativeCatalog.js';
import { readSearchIndex, SEARCH_INDEX_IDENTIFIER } from './search.js';
import { readGalleryCatalog, GALLERY_CATALOG_IDENTIFIER } from './gallery.js';
import { mergeOverlayCatalog, readOverlay, OVERLAY_IDENTIFIER } from './overlay.js';
import { resolveBySlug } from './slug.js';

const MANIFEST_TIMEOUT_MS = 7000;
const CACHE_SCHEMA = 'qms-cms-dataset-cache@2';

function normalizedName(value) {
  return safeDecodeQdnName(value).replace(/\s+/g, ' ').toLowerCase();
}

function cacheBinding({ source, name, service, identifier, manifestIdentifier, siteId }) {
  return {
    schema: 'qms-cms-cache-binding@1',
    source: String(source),
    name: normalizedName(name),
    service: String(service || 'APP').toUpperCase(),
    identifier: String(identifier || 'default'),
    manifestIdentifier: String(manifestIdentifier || ''),
    siteId: String(siteId || '')
  };
}

function cacheKey(binding) {
  return 'qms-cms-dataset:v2:' + [
    binding.source,
    binding.service,
    binding.name,
    binding.identifier,
    binding.manifestIdentifier,
    binding.siteId
  ].map(encodeURIComponent).join(':');
}

function bindingsMatch(actual, expected) {
  if (!actual || actual.schema !== 'qms-cms-cache-binding@1') return false;
  return actual.source === expected.source
    && actual.name === expected.name
    && actual.service === expected.service
    && actual.identifier === expected.identifier
    && actual.manifestIdentifier === expected.manifestIdentifier
    && actual.siteId === expected.siteId;
}

function readCache(key, expectedBinding) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schema !== CACHE_SCHEMA || !bindingsMatch(parsed.binding, expectedBinding)
      || !parsed.dataset || !Array.isArray(parsed.dataset.posts)
      || (expectedBinding.source !== 'fixture' && String(parsed.dataset.site?.id || '') !== expectedBinding.siteId)) return null;
    return { dataset: parsed.dataset, cachedAt: parsed.cachedAt || null };
  } catch {
    return null;
  }
}

function writeCache(key, binding, dataset) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify({
      schema: CACHE_SCHEMA,
      cachedAt: new Date().toISOString(),
      binding,
      dataset
    }));
  } catch {
    // Storage can be blocked or full in a Qortal UI context.
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new CatalogError('fixture-read-failed', 'Fixture request failed with HTTP ' + response.status + ': ' + url);
  return await response.json();
}

export function createCmsRepository(config, options = {}) {
  const query = options.query
    || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams());
  const requestedSource = String(options.source || query.get('source') || config.content.source || 'qdn');
  const devMode = Boolean(import.meta.env && import.meta.env.DEV);
  const source = requestedSource === 'fixture' && !devMode ? 'qdn' : requestedSource;
  // Visitor query parameters must never select a different QDN identity for
  // catalog reads; only the hosting context or published config may.
  const hosted = discoverHostedQdnResource({
    name: config.deployment?.name || config.site.ownerName || '',
    service: config.deployment?.service || 'APP',
    identifier: config.deployment?.identifier || 'default'
  });
  // `options.name` exists for local fixtures only. Live QDN reads always use
  // the actual APP/WEBSITE host, never an arbitrary caller or visitor value.
  const manifestName = String(source === 'fixture'
    ? (options.name || hosted.name || config.site.ownerName || '')
    : (hosted.name || config.deployment?.name || config.site.ownerName || ''));
  const fixtureManifestUrl = options.fixtureManifestUrl || query.get('manifest') || '/cms-fixture/qms-cms-manifest.json';
  const siteDefaults = {
    id: config.site.id,
    title: config.site.title,
    tagline: config.site.tagline,
    description: config.site.description,
    ownerName: config.site.ownerName,
    publicAuthor: config.site.publicAuthor
  };
  const staleAfterMs = Math.max(1, Number(config.content.staleAfterDays) || 30) * 24 * 60 * 60 * 1000;
  const cacheBindings = (source === 'fixture' ? ['fixture'] : [config.content.manifestIdentifier, config.content.legacyManifestIdentifier])
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .map((identifier) => cacheBinding({
      source,
      name: manifestName,
      service: hosted.service,
      identifier: hosted.identifier,
      manifestIdentifier: identifier,
      siteId: config.site.id
    }));
  let datasetPromise = null;
  let searchPromise = null;
  let searchCache = null;
  let dataset = null;
  let normalizedManifest = null;
  let manifestIdentifier = source === 'fixture' ? 'fixture' : config.content.manifestIdentifier;

  async function fixtureFetchRef(ref) {
    if (!normalizedManifest) throw new CatalogError('manifest-missing', 'The fixture manifest has not been loaded.');
    const entry = normalizedManifest.resources.byIdentifier[ref.identifier];
    const localPath = entry && entry.local_path;
    if (!localPath) {
      throw new CatalogError('fixture-ref-missing', 'The fixture manifest does not provide local_path for ' + ref.identifier + '.');
    }
    return fetchJson('/cms-fixture/' + String(localPath).replace(/^\/+/, ''));
  }

  async function qdnFetchRef(ref) {
    return fetchQdnResource(ref);
  }

  async function loadQdnManifest() {
    const identifiers = [config.content.manifestIdentifier, config.content.legacyManifestIdentifier]
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index);
    const failures = [];
    for (const identifier of identifiers) {
      try {
        const raw = await fetchQdnResource(
          { service: 'DOCUMENT', name: manifestName, identifier },
          MANIFEST_TIMEOUT_MS
        );
        return { raw, identifier };
      } catch (error) {
        failures.push(identifier + ': ' + (error && error.message ? error.message : String(error)));
      }
    }
    throw new CatalogError(
      'manifest-unavailable',
      'No CMS catalog manifest could be read for ' + (manifestName || 'this site') + '. Tried ' + failures.join('; ')
    );
  }

  async function load() {
    const cached = cacheBindings
      .map((binding) => readCache(cacheKey(binding), binding))
      .find(Boolean) || null;
    try {
      let raw;
      let identifier;
      if (source === 'fixture') {
        raw = await fetchJson(fixtureManifestUrl);
        identifier = 'fixture';
      } else {
        const loaded = await loadQdnManifest();
        raw = loaded.raw;
        identifier = loaded.identifier;
      }
      manifestIdentifier = identifier;
      normalizedManifest = normalizeManifest(raw, { siteDefaults, expectedName: source === 'fixture' ? '' : manifestName });
      if (source !== 'fixture' && String(normalizedManifest.site?.id || '') !== String(config.site.id || '')) {
        throw new CatalogError('manifest-site-id-mismatch', 'The QDN catalog site identity does not match this CMS configuration.');
      }
      dataset = await loadCmsDataset(raw, {
        manifest: normalizedManifest,
        fetchRef: source === 'fixture' ? fixtureFetchRef : qdnFetchRef,
        siteDefaults,
        now: Date.now(),
        staleAfterMs,
        cache: cached ? { ...cached.dataset, cachedAt: cached.cachedAt } : null
      });
      if (source !== 'fixture' && dataset.state !== 'error') {
        try {
          const nativeRaw = await fetchQdnResource(
            { service: 'DOCUMENT', name: manifestName, identifier: NATIVE_INDEX_IDENTIFIER },
            MANIFEST_TIMEOUT_MS
          );
          const native = readNativeIndex(nativeRaw);
          if (native.ok) dataset = mergeNativeCatalog(dataset, native.index);
          else {
            dataset = {
              ...dataset,
              notices: [...dataset.notices, { code: 'cms-native-index-invalid', level: 'warning', message: 'CMS-authored content could not be merged: ' + native.errors.join(' ') }]
            };
          }
        } catch {
          // No CMS supplement is normal for an imported-only site.
        }
        // Owner edits of imported content are a separate versioned overlay.
        // Imported resources are never modified; a sync rebuild cannot erase
        // these edits because they live in CMS-owned resources.
        try {
          const overlayRaw = await fetchQdnResource(
            { service: 'DOCUMENT', name: manifestName, identifier: OVERLAY_IDENTIFIER },
            MANIFEST_TIMEOUT_MS
          );
          const overlayRead = readOverlay(overlayRaw);
          if (overlayRead.ok) dataset = mergeOverlayCatalog(dataset, overlayRead.overlay);
          else {
            dataset = {
              ...dataset,
              notices: [...dataset.notices, { code: 'cms-edit-overlay-invalid', level: 'warning', message: 'Owner edits of imported content could not be merged: ' + overlayRead.errors.join(' ') }]
            };
          }
        } catch {
          // No overlay is normal before the first edit.
        }
      }
      if (dataset.state !== 'error') {
        const binding = cacheBinding({
          source,
          name: manifestName,
          service: hosted.service,
          identifier: hosted.identifier,
          manifestIdentifier: identifier,
          siteId: config.site.id
        });
        writeCache(cacheKey(binding), binding, dataset);
      }
      return dataset;
    } catch (error) {
      if (cached) {
        dataset = {
          ...cached.dataset,
          state: 'stale',
          fromCache: true,
          cachedAt: cached.cachedAt,
          loadedAt: new Date().toISOString(),
          notices: [
            ...(cached.dataset.notices || []),
            {
              code: 'catalog-cache-fallback',
              level: 'warning',
              message: 'Live QDN catalogs are unavailable. Showing the last successfully cached catalog.'
            }
          ]
        };
        return dataset;
      }
      dataset = createErrorDataset({
        site: config.site,
        source: 'error',
        message: error && error.message ? error.message : String(error)
      });
      return dataset;
    }
  }

  return {
    source,
    manifestName,
    get manifestIdentifier() {
      return manifestIdentifier;
    },
    async loadDataset(refresh = false) {
      if (refresh) datasetPromise = null;
      datasetPromise = datasetPromise || load();
      return datasetPromise;
    },
    async findPost(slug) {
      const current = await this.loadDataset();
      const found = resolveBySlug(current.posts.filter((item) => item.type === 'post'), slug);
      return found || null;
    },
    async findPage(slug) {
      const current = await this.loadDataset();
      const found = resolveBySlug(current.pages, slug);
      return found || null;
    },
    /**
     * Load the versioned search index without scanning content. The imported
     * catalog publishes one index through the manifest entrypoint; CMS-native
     * publishing maintains a separate document in the same QDN name. Native
     * entries win because they are the newest version of an edited post.
     */
    async loadSearchIndex(refresh = false) {
      if (refresh) { searchPromise = null; searchCache = null; }
      if (searchCache) return searchCache;
      if (searchPromise) return searchPromise;
      searchPromise = (async () => {
        const current = await this.loadDataset();
        const published = new Set(
          [...(current.posts || []), ...(current.pages || [])]
            .filter((item) => item.status === 'published')
            .map((item) => item.type + ':' + item.slug)
        );
        const entries = new Map();
        const notices = [];
        let importedState = 'missing';
        let nativeState = 'missing';
        let updatedAt = null;

        const importedRef = normalizedManifest && normalizedManifest.entrypoints
          ? normalizedManifest.entrypoints.search
          : null;
        if (importedRef) {
          try {
            const payload = await (source === 'fixture' ? fixtureFetchRef(importedRef) : qdnFetchRef(importedRef));
            const read = readSearchIndex(payload);
            if (read.ok) {
              importedState = 'ready';
              if (read.index.updated_at && (!updatedAt || read.index.updated_at > updatedAt)) updatedAt = read.index.updated_at;
              for (const entry of read.index.entries) entries.set(entry.type + ':' + entry.slug, entry);
            } else {
              importedState = 'invalid';
              notices.push('Imported search index is invalid: ' + read.errors.join(' '));
            }
          } catch (error) {
            importedState = 'unavailable';
            notices.push('Imported search index could not be read: ' + (error && error.message ? error.message : String(error)));
          }
        }

        if (source !== 'fixture') {
          try {
            const payload = await fetchQdnResource(
              { service: 'DOCUMENT', name: manifestName, identifier: SEARCH_INDEX_IDENTIFIER },
              MANIFEST_TIMEOUT_MS
            );
            const read = readSearchIndex(payload);
            if (read.ok) {
              nativeState = 'ready';
              if (read.index.updated_at && (!updatedAt || read.index.updated_at > updatedAt)) updatedAt = read.index.updated_at;
              for (const entry of read.index.entries) entries.set(entry.type + ':' + entry.slug, entry);
            } else {
              nativeState = 'invalid';
              notices.push('CMS search index is invalid: ' + read.errors.join(' '));
            }
          } catch {
            // A site that has never published a CMS post has no native index.
          }
        }

        const filtered = [...entries.values()]
          .filter((entry) => published.has(entry.type + ':' + entry.slug))
          .sort((left, right) => left.title.localeCompare(right.title));
        const state = filtered.length > 0 || importedState === 'ready' || nativeState === 'ready' ? 'ready' : 'missing';
        searchCache = {
          ok: state === 'ready',
          state,
          entries: filtered,
          importedState,
          nativeState,
          updatedAt,
          notices,
          siteId: current.site.id
        };
        return searchCache;
      })();
      try {
        return await searchPromise;
      } finally {
        searchPromise = null;
      }
    },
    async loadGalleries() {
      if (source === 'fixture') return { ok: true, catalog: { schema: 'qms-cms-gallery@1', version: 1, revision: 0, galleries: [] }, errors: [] };
      try {
        const raw = await fetchQdnResource(
          { service: 'DOCUMENT', name: manifestName, identifier: GALLERY_CATALOG_IDENTIFIER },
          MANIFEST_TIMEOUT_MS
        );
        return readGalleryCatalog(raw);
      } catch {
        return { ok: true, catalog: { schema: 'qms-cms-gallery@1', version: 1, revision: 0, galleries: [] }, errors: [] };
      }
    },
    async loadContent(item) {
      const current = await this.loadDataset();
      if (!item || !item.contentRef) {
        throw new CatalogError('content-ref-missing', 'The catalog does not provide a content resource for ' + ((item && item.slug) || 'this item') + '.');
      }
      const payload = await (source === 'fixture' ? fixtureFetchRef(item.contentRef) : qdnFetchRef(item.contentRef));
      const content = normalizeContentPayload(payload, item);
      const html = rewriteMediaUrls(content.html, {
        bySourceUrl: current.urls.bySourceUrl,
        media: content.media,
        createUrl: createQdnResourceUrl,
        defaultName: manifestName || current.site.ownerName
      });
      return { ...content, html };
    }
  };
}
