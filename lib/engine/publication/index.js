import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, unzipSync } from 'fflate';
import { QmsError, ERROR_CODES } from '../errors.js';
import { base32 } from '../identity.js';
import { readIndexedItem } from '../source-index.js';
import { atomicWriteFile, atomicWriteJson } from '../storage/atomic.js';
import { assertPathInside } from '../storage/paths.js';
import { verifyAsset } from '../../media/store.js';
import {
  HANDOFF_SCHEMA,
  HANDOFF_VERSION,
  PUBLICATION_STATE_SCHEMA,
  PUBLISHABLE_SERVICES,
  assertHandoffManifest,
  assertNoSecretFields,
  publicationStateForReceiptStatus,
  sealDocument,
  sha256Bytes,
  summarizeHandoff,
  validateHandoffPackage
} from './handoff.js';
import {
  buildIndexPayloads,
  buildManifestResource,
  contentIdentity,
  jsonBytes,
  mediaIdentity,
  mediaRefFromResource,
  renderContentPayload
} from './payloads.js';
import { orderResources, planBatches, summarizeResults } from './order.js';
import { buildCmsSiteBundle, websiteSettings } from './site.js';
import { assertReceipt, reconcileReceiptResults } from './receipts.js';
import { verifyNameOwnership as verifyQortalNameOwnership, verifyResources } from './remote.js';

const ACTIONABLE = new Set(['new', 'modified', 'route_changed', 'reserved']);
const HANDOFF_ID = /^hof_[a-z0-9]{8,40}$/;
const PUBLICATION_BATCH_ID = /^pub_[a-z0-9]{8,40}$/;
const RECEIPT_ID = /^rcp_[a-z0-9]{8,40}$/;
const TERMINAL_GOOD = new Set(['remote_verified']);
const TERMINAL_BAD = new Set(['failed', 'declined', 'blocked']);

function fail(code, message, details) {
  throw new QmsError(code, message, { details });
}

function idFrom(prefix, key, length = 24) {
  return prefix + base32(createHash('sha256').update(String(key), 'utf8').digest(), length);
}

function assertSelection(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(ERROR_CODES.PUBLICATION_BLOCKED, 'An explicit non-empty resource selection is required.');
  }
  if (value.length > 10000) fail(ERROR_CODES.INVALID_ARGUMENT, 'Selection is too large.');
  return value.map((entry) => String(entry));
}

function assertHandoffId(value) {
  if (typeof value !== 'string' || !HANDOFF_ID.test(value)) {
    fail(ERROR_CODES.PUBLICATION_PLAN_NOT_FOUND, 'Unknown handoff id: ' + String(value));
  }
  return value;
}

function flattenDocumentMedia(document) {
  const urls = [];
  const visit = (entry) => {
    if (!entry) return;
    const url = entry.resolved_url ?? entry.url ?? null;
    if (url) urls.push(url);
  };
  visit(document.media?.featured);
  for (const entries of Object.values(document.media ?? {})) {
    if (!Array.isArray(entries)) continue;
    entries.forEach(visit);
  }
  return [...new Set(urls)];
}

function relativeProjectPath(paths, absolute) {
  return path.relative(paths.root, absolute).split(path.sep).join('/');
}

function aggregateStatus(resources) {
  const states = resources.map((resource) => resource.state);
  if (states.length === 0) return 'reserved';
  if (states.every((state) => state === 'remote_verified')) return 'remote_verified';
  if (states.every((state) => state === 'declined')) return 'declined';
  if (states.every((state) => state === 'blocked')) return 'blocked';
  if (states.some((state) => ['remote_verified', 'submitted', 'pending_confirmation', 'ambiguous', 'failed', 'partial'].includes(state))) {
    return states.every((state) => state === 'submitted' || state === 'pending_confirmation') ? 'pending_confirmation' : 'partial';
  }
  return 'handoff_ready';
}

function publicMetadata(metadata = {}) {
  const { assetPath, extraUrls, ...safe } = metadata;
  void assetPath;
  return safe;
}

function copyResourceRecord(resource) {
  return {
    id: resource.id,
    kind: resource.kind,
    service: resource.service,
    name: resource.name,
    identifier: resource.identifier,
    relativePath: resource.relativePath,
    contentType: resource.contentType,
    bytes: resource.bytes,
    sha256: resource.sha256,
    order: resource.order,
    dependsOn: [...(resource.dependsOn ?? [])],
    sourceKey: resource.sourceKey ?? null,
    metadata: publicMetadata(resource.metadata)
  };
}

export class PublicationService {
  constructor({ project, paths, store, clock, identity, planning, runs, events, repoRoot = null, fetchImpl = null, guard = null, sync = null, recovery = null, history = null }) {
    this.getProject = typeof project === 'function' ? project : () => project;
    this.paths = paths;
    this.store = store;
    this.clock = clock;
    this.identity = identity;
    this.planning = planning;
    this.runs = runs;
    this.events = events;
    this.repoRoot = repoRoot;
    this.fetchImpl = fetchImpl;
    this.guard = guard;
    this.sync = sync;
    this.recovery = recovery;
    this.audit = history;
  }

  _stageId(kind, key) {
    return 'stg_' + kind + '_' + idFrom('', key, 16);
  }

  /**
   * Emit a durable preparation progress event. Progress is advisory: a failed
   * event write must never fail the handoff itself. Denominators are real
   * counts, never fabricated percentages.
   */
  async _progress(phase, completed, total, message, code) {
    if (!this.events || typeof this.events.emit !== 'function') return;
    try {
      await this.events.emit({
        type: 'progress_updated',
        level: 'info',
        phase,
        code,
        message,
        progress: {
          completed: Number.isInteger(completed) ? Math.max(0, completed) : 0,
          total: Number.isInteger(total) ? Math.max(0, total) : 0
        },
        details: { service: 'publication.prepare' }
      });
    } catch {
      // Progress is best-effort and must never break publication preparation.
    }
  }

  get state() {
    return this.store.state.publication;
  }

  _assertState() {
    if (!this.state || this.state.schema !== PUBLICATION_STATE_SCHEMA) {
      fail(ERROR_CODES.PUBLICATION_BLOCKED, 'Publication state is not initialized.');
    }
    return this.state;
  }

  _requireRecord(handoffId) {
    const id = assertHandoffId(handoffId);
    const record = this._assertState().handoffs[id];
    if (!record) fail(ERROR_CODES.PUBLICATION_PLAN_NOT_FOUND, 'Unknown publication handoff: ' + id);
    return record;
  }

  async _loadManifest(record) {
    const root = assertPathInside(this.paths.root, path.join(this.paths.root, record.relativePath), 'handoff directory');
    const manifestPath = path.join(root, 'handoff.json');
    let raw;
    try {
      raw = await readFile(manifestPath, 'utf8');
    } catch {
      fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, 'Handoff package is missing handoff.json.', { handoffId: record.handoffId });
    }
    let manifest;
    try {
      manifest = JSON.parse(raw);
    } catch {
      fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, 'Handoff package handoff.json is invalid.');
    }
    assertHandoffManifest(manifest);
    return { root, manifest };
  }

  async _mediaResourcesFor({ plan, selectedEntries, target }) {
    const selectedIds = new Set(selectedEntries.map((entry) => entry.id));
    const project = this.getProject();
    const mediaResources = [];
    const byHash = new Map();
    const byUrl = new Map();
    const missing = [];
    for (const record of plan.media ?? []) {
      if (!record.items?.some((id) => selectedIds.has(id))) continue;
      if (record.status === 'skipped_external') continue;
      if (record.status === 'missing' || record.status === 'blocked') {
        missing.push({ url: record.url, reason: record.status === 'missing' ? 'MEDIA_NOT_FOUND' : 'MEDIA_BLOCKED' });
        continue;
      }
      const receipt = this.store.state.media?.downloads?.[record.url] ?? null;
      if (!receipt || receipt.status !== 'verified' || !receipt.hash || !receipt.relativePath) {
        missing.push({ url: record.url, reason: 'MEDIA_NOT_VERIFIED' });
        continue;
      }
      const assetPath = assertPathInside(this.paths.mediaAssetsDir, path.join(this.paths.mediaAssetsDir, receipt.relativePath), 'media asset path');
      const verified = await verifyAsset({ filePath: assetPath, hash: receipt.hash, bytes: receipt.bytes });
      if (!verified.valid) {
        missing.push({ url: record.url, reason: 'MEDIA_ASSET_CORRUPT' });
        continue;
      }
      let resource = byHash.get(receipt.hash);
      if (!resource) {
        const triple = mediaIdentity({
          siteId: project.identity.siteId,
          namespace: this.identity.state.namespace,
          target,
          mimeType: receipt.mimeType ?? record.mimeType ?? 'application/octet-stream',
          hash: receipt.hash
        });
        if (!PUBLISHABLE_SERVICES.includes(triple.service)) {
          fail(ERROR_CODES.PUBLICATION_BLOCKED, 'Unsupported media service: ' + triple.service);
        }
        resource = {
          id: idFrom('res_', 'media|' + receipt.hash),
          kind: 'media',
          service: triple.service,
          name: target.qdnName,
          identifier: triple.identifier,
          relativePath: 'payload/media/' + receipt.hash.slice(7) + '.' + extension(receipt.mimeType),
          contentType: receipt.mimeType ?? record.mimeType ?? 'application/octet-stream',
          bytes: receipt.bytes,
          sha256: receipt.hash,
          order: 0,
          dependsOn: [],
          sourceKey: 'media:' + receipt.hash,
          metadata: {
            sourceUrl: record.url,
            mimeType: receipt.mimeType ?? record.mimeType ?? null,
            assetPath
          }
        };
        byHash.set(receipt.hash, resource);
        mediaResources.push(resource);
      } else if (!resource.metadata.extraUrls) {
        resource.metadata.extraUrls = [];
      }
      if (record.url !== resource.metadata.sourceUrl && !(resource.metadata.extraUrls ?? []).includes(record.url)) {
        resource.metadata.extraUrls = [...(resource.metadata.extraUrls ?? []), record.url];
      }
      byUrl.set(record.url, resource);
    }
    if (missing.length > 0) {
      fail(ERROR_CODES.PUBLICATION_NOT_READY, 'Selected content references media that is not locally verified.', {
        missing: missing.slice(0, 100)
      });
    }
    return { mediaResources, byUrl };
  }

  async _assertCatalogCurrent(record) {
    if (record.supersededAt) fail(ERROR_CODES.PUBLICATION_CONFLICT, 'This handoff has been superseded. Use the latest prepared handoff.', { catalogStale: true });
    if (!this.sync) return;
    const visible = await this.sync.catalog({ resources: true });
    const expected = new Map(visible.map((resource) => [resource.id, resource]));
    for (const resource of record.resources.filter((entry) => entry.kind === 'content')) {
      const mapping = this.store.state.identity?.mappings?.[resource.sourceKey];
      if (!mapping || ['withdrawn', 'skipped'].includes(mapping.status)
        || mapping.contentHash !== resource.metadata?.contentHash
        || mapping.slug !== resource.metadata?.slug
        || mapping.service !== resource.service || mapping.name !== resource.name || mapping.identifier !== resource.identifier
        || (resource.metadata?.routeHash && mapping.routeHash !== resource.metadata.routeHash)) {
        fail(ERROR_CODES.PUBLICATION_CONFLICT, 'This handoff contains content that is withdrawn or has a newer planned or published revision.', { catalogStale: true });
      }
      if (record.status === 'remote_verified' && expected.has(resource.id)
        && expected.get(resource.id).sha256 !== resource.sha256) {
        fail(ERROR_CODES.PUBLICATION_CONFLICT, 'This historical handoff would restore an older published revision.', { catalogStale: true });
      }
      expected.set(resource.id, resource);
    }
    const root = assertPathInside(this.paths.handoffsDir, path.join(this.paths.root, record.relativePath));
    const actual = [];
    for (const resource of record.resources.filter((entry) => entry.kind === 'index'
      && ['posts', 'pages'].includes(entry.metadata?.key))) {
      const bytes = await readFile(assertPathInside(root, path.join(root, resource.relativePath)));
      if (bytes.length !== resource.bytes || sha256Bytes(bytes) !== resource.sha256) {
        fail(ERROR_CODES.PUBLICATION_HASH_MISMATCH, 'Catalog payload differs from its handoff.');
      }
      actual.push(...JSON.parse(bytes).entries);
    }
    if (actual.length !== expected.size || actual.some((entry) => {
      const resource = expected.get(entry.id);
      return !resource || entry.contentHash !== resource.metadata?.contentHash
        || entry.slug !== resource.metadata?.slug || entry.qdn?.service !== resource.service
        || entry.qdn?.name !== resource.name || entry.qdn?.identifier !== resource.identifier;
    })) {
      fail(ERROR_CODES.PUBLICATION_CONFLICT,
        'This handoff predates the current verified catalog. Prepare a fresh handoff before publishing.', { catalogStale: true });
    }
  }

  async prepare({
    planId,
    selection,
    feePerResource = null,
    feeCurrency = 'QORT',
    createdAt = null
  } = {}) {
    const project = this.getProject();
    const loaded = await this.planning.get(planId);
    const plan = loaded.plan;
    if (plan.status !== 'ready') {
      fail(ERROR_CODES.PUBLICATION_NOT_READY, 'A blocked plan cannot be packaged for publication.', {
        planId,
        status: plan.status,
        errors: plan.errors
      });
    }
    if (plan.siteId !== project.identity.siteId) {
      fail(ERROR_CODES.IDENTITY_MISMATCH, 'Plan site identity does not match this project.');
    }
    const selectedKeys = new Set(assertSelection(selection));
    const actionable = (plan.entries ?? []).filter((entry) =>
      ACTIONABLE.has(entry.status) && entry.file && entry.qdn && entry.sourceKey
    );
    const selectedEntries = actionable.filter((entry) => selectedKeys.has(entry.sourceKey) || selectedKeys.has(entry.id));
    if (selectedEntries.length === 0) {
      fail(ERROR_CODES.PUBLICATION_BLOCKED, 'The selection does not include any actionable plan entry.');
    }
    if (selectedEntries.length > 5000) {
      fail(ERROR_CODES.PUBLICATION_BLOCKED, 'The selection is too large for one handoff.');
    }
    const target = { ...this.identity.state.target };
    if (!target.qdnName) fail(ERROR_CODES.TARGET_NAME_REQUIRED, 'A target Qortal name is required.');
    if (feeCurrency !== 'QORT') fail(ERROR_CODES.INVALID_ARGUMENT, 'Only QORT fee estimates are supported.');
    if (this.guard) {
      await this.guard({
        plan,
        planId: plan.planId,
        sourceKeys: selectedEntries.map((entry) => entry.sourceKey)
      });
    }

    // Explicit terminal rejections have no pending writes to reconcile. A new
    // preparation may supersede them locally; never abandon ambiguous writes.
    const rejected = Object.values(this._assertState().handoffs).filter((handoff) => !handoff.supersededAt
      && handoff.resources.some((resource) => ['failed', 'declined'].includes(resource.status))
      && handoff.resources.every((resource) => ['handoff_ready', 'failed', 'declined'].includes(resource.status)
        && !resource.txSignature && !resource.remoteVerifiedAt && !resource.lastVerification
        && !['submitted', 'pending_confirmation', 'remote_verified', 'ambiguous'].includes(resource.publisherReportedStatus)));
    if (rejected.length) await this.store.transaction((draft) => {
      for (const handoff of rejected) draft.publication.handoffs[handoff.handoffId].supersededAt = this.clock.nowIso();
    });

    // Idempotent preparation: an equivalent handoff for the same plan and
    // selection is reused instead of creating duplicate QDN identities.
    const selectionKeys = selectedEntries.map((entry) => entry.sourceKey).sort();
    const selectionSignature = selectionKeys.join('|');
    for (const existing of Object.values(this._assertState().handoffs)) {
      if (existing.planId !== planId || existing.supersededAt) continue;
      if (!['handoff_ready', 'submitted', 'pending_confirmation', 'remote_verified', 'partial', 'ambiguous'].includes(existing.status)) continue;
      const existingSignature = existing.selectionSignature
        ?? (existing.resources ?? [])
          .filter((resource) => resource.kind === 'content' && resource.sourceKey)
          .map((resource) => resource.sourceKey)
          .sort()
          .join('|');
      if (existingSignature !== selectionSignature) continue;
      try {
        await this._assertCatalogCurrent(existing);
      } catch (error) {
        if (!error.details?.catalogStale || existing.status !== 'handoff_ready') throw error;
        await this.store.transaction((draft) => {
          draft.publication.handoffs[existing.handoffId].supersededAt = this.clock.nowIso();
        });
        continue;
      }
      return {
        handoffId: existing.handoffId,
        publicationBatchId: existing.publicationBatchId,
        planId: existing.planId,
        status: existing.status,
        handoffPath: existing.relativePath,
        absolutePath: path.join(this.paths.root, existing.relativePath),
        resources: existing.resources,
        counts: existing.counts,
        estimate: existing.estimate,
        packageValidated: false,
        reused: true,
        message: 'An equivalent handoff already exists for this plan and selection. Nothing new was prepared and no QDN identity was duplicated.'
      };
    }
    // One publication at a time per immutable site. Preparing a later batch
    // before the earlier manifest is verified could freeze a replacing catalog.
    const outstanding = Object.values(this._assertState().handoffs).find((handoff) =>
      handoff.siteId === project.identity.siteId && !handoff.supersededAt && handoff.status !== 'remote_verified');
    if (outstanding) {
      fail(ERROR_CODES.PUBLICATION_BLOCKED,
        'Finish publishing and exact verification of the previous handoff before preparing the next batch for this site.',
        { handoffId: outstanding.handoffId, status: outstanding.status });
    }
    const prepareStage = this.recovery
      ? this._stageId('prepare', planId + '|' + selectionSignature)
      : null;
    if (this.recovery) {
      await this.recovery.stageCheckpoint({
        stageId: prepareStage,
        kind: 'publication.prepare',
        phase: 'prepare',
        step: 'prepare_start',
        resumable: true,
        resume: {
          service: 'publication',
          method: 'prepare',
          params: { planId, selection: selectionKeys }
        },
        details: { planId, selected: selectionKeys.length }
      });
    }

    const batchDir = assertPathInside(
      path.join(this.paths.artifactsDir, 'source', plan.source.adapter),
      path.join(this.paths.artifactsDir, 'source', plan.source.adapter, 'batches', plan.batchId),
      'source batch directory'
    );
    const previousContent = this.sync ? await this.sync.catalog({ resources: true }) : [];
    const previousMedia = previousContent.flatMap((resource) => resource.mediaResources ?? []);
    const preparedMedia = await this._mediaResourcesFor({ plan, selectedEntries, target });
    const byUrl = preparedMedia.byUrl;
    const mediaResources = preparedMedia.mediaResources.filter((resource) => !previousMedia.some((old) =>
      old.service === resource.service && old.name === resource.name && old.identifier === resource.identifier
      && old.sha256 === resource.sha256 && old.bytes === resource.bytes));
    await this._progress('prepared_media', mediaResources.length, mediaResources.length,
      'Verified ' + mediaResources.length + ' required media asset(s).', 'PUBLICATION_MEDIA_VERIFIED');
    const contentResources = [];
    for (const [index, entry] of selectedEntries.entries()) {
      let document;
      try {
        document = await readIndexedItem(batchDir, {
          id: entry.id,
          file: entry.file,
          sourceKey: entry.sourceKey,
          contentHash: entry.contentHash
        }, { baseUrl: project.source?.baseUrl ?? plan.source.site?.url ?? null });
      } catch (error) {
        fail(ERROR_CODES.PLAN_STALE, 'Source content changed after planning; refusing to package it.', {
          sourceKey: entry.sourceKey,
          cause: error.message
        });
      }
      const mapping = this.identity.mappingFor(entry.sourceKey);
      if (!mapping) {
        fail(ERROR_CODES.PUBLICATION_BLOCKED, 'Plan entry has no reserved identity mapping.', { sourceKey: entry.sourceKey });
      }
      const expected = contentIdentity({
        siteId: project.identity.siteId,
        namespace: this.identity.state.namespace,
        target,
        sourceKey: entry.sourceKey,
        contentType: entry.contentType
      });
      if (
        mapping.service !== expected.service ||
        mapping.name !== expected.name ||
        mapping.identifier !== expected.identifier ||
        entry.qdn?.identifier !== mapping.identifier
      ) {
        fail(ERROR_CODES.PUBLICATION_CONFLICT, 'Plan identity mapping no longer matches the site namespace.', {
          sourceKey: entry.sourceKey,
          expected,
          mapping: { service: mapping.service, name: mapping.name, identifier: mapping.identifier }
        });
      }
      const resource = {
        id: idFrom('res_', 'content|' + entry.sourceKey),
        kind: 'content',
        service: mapping.service,
        name: mapping.name,
        identifier: mapping.identifier,
        relativePath: 'payload/content/' + idFrom('', 'content-file|' + entry.sourceKey, 24) + '.json',
        contentType: 'application/json; charset=utf-8',
        bytes: 0,
        sha256: null,
        order: 0,
        dependsOn: [],
        sourceKey: entry.sourceKey,
        metadata: {
          title: entry.title ?? null,
          slug: entry.slug ?? null,
          contentType: entry.contentType,
          contentHash: entry.contentHash,
          routeHash: entry.routeHash ?? null,
          oldUrl: document.identity?.old_url ?? null,
          categories: document.terms?.categories ?? [],
          tags: document.terms?.tags ?? []
        }
      };
      const mediaUrlSet = flattenDocumentMedia(document);
      const mediaRefs = new Map();
      for (const url of mediaUrlSet) {
        const media = byUrl.get(url);
        if (media) {
          mediaRefs.set(url, mediaRefFromResource(media));
          if (mediaResources.some((candidate) => candidate.id === media.id)
            && !resource.dependsOn.includes(media.id)) resource.dependsOn.push(media.id);
        }
      }
      const bytes = renderContentPayload({
        document,
        mediaByUrl: mediaRefs,
        resource,
        publishedAt: createdAt ?? plan.createdAt
      });
      resource.bytes = bytes.length;
      resource.sha256 = sha256Bytes(bytes);
      resource.payload = bytes;
      contentResources.push(resource);
    }
    await this._progress('rendered_content', contentResources.length, selectedEntries.length,
      'Rendered ' + contentResources.length + ' content payload(s).', 'PUBLICATION_CONTENT_RENDERED');

    const now = createdAt ?? this.clock.nowIso();
    const catalogBySource = new Map(previousContent.map((resource) => [resource.sourceKey, resource]));
    for (const resource of contentResources) catalogBySource.set(resource.sourceKey, resource);
    const catalogContent = [...catalogBySource.values()].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
    const catalogMedia = [...new Map([...previousMedia, ...preparedMedia.mediaResources]
      .map((resource) => [resource.service + '|' + resource.name + '|' + resource.identifier, resource])).values()];
    const indexResources = buildIndexPayloads({
      siteId: project.identity.siteId,
      namespace: this.identity.state.namespace,
      prefix: target.resourcePrefix,
      target,
      contentResources: catalogContent,
      mediaResources: catalogMedia,
      generatedAt: now
    }).map((resource) => ({
      ...resource,
      name: target.qdnName,
      dependsOn: contentResources.map((entry) => entry.id),
      metadata: { key: resource.key, label: resource.label }
    }));
    const seedKey = JSON.stringify({
      project: project.id,
      site: project.identity.siteId,
      plan: plan.planId,
      selection: selectedEntries.map((entry) => entry.sourceKey).sort(),
      createdAt: now
    });
    const publicationBatchId = idFrom('pub_', 'batch|' + seedKey);
    const handoffId = idFrom('hof_', 'handoff|' + seedKey);
    const manifestResource = buildManifestResource({
      siteId: project.identity.siteId,
      namespace: this.identity.state.namespace,
      prefix: target.resourcePrefix,
      target,
      handoffId,
      generatedAt: now,
      contentResources: catalogContent,
      mediaResources: catalogMedia,
      indexResources
    });
    manifestResource.name = target.qdnName;
    manifestResource.dependsOn = indexResources.map((entry) => entry.id);
    manifestResource.metadata = { key: 'site-manifest' };
    let siteResource = null;
    let siteDeployment = null;
    if (websiteSettings(project).cms === 'generic-cms') {
      siteResource = await buildCmsSiteBundle({
        repoRoot: this.repoRoot,
        project,
        target,
        prefix: target.resourcePrefix,
        namespace: this.identity.state.namespace,
        manifestIdentifier: manifestResource.identifier,
        manifestResourceId: manifestResource.id,
        service: websiteSettings(project).service,
        generatedAt: now
      });
      siteResource.name = target.qdnName;
      // APP code/config is independent of the changing imported data catalog.
      // Older bundles differ only in generated_at; compare their actual members.
      const candidateFiles = unzipSync(siteResource.payload);
      const normalize = (files) => Object.fromEntries(Object.keys(files).sort().map((key) => {
        if (key !== 'qms-cms-config.json') return [key, sha256Bytes(files[key])];
        const config = JSON.parse(Buffer.from(files[key]).toString('utf8'));
        delete config.generated_at;
        return [key, jsonBytes(config).toString('utf8')];
      }));
      const candidateSignature = JSON.stringify(normalize(candidateFiles));
      const latestSiteHandoffs = Object.values(this._assertState().handoffs).reverse()
        .sort((a, b) => String(b.lastVerification?.at ?? '').localeCompare(String(a.lastVerification?.at ?? '')));
      for (const oldHandoff of latestSiteHandoffs) {
        if (oldHandoff.siteId !== project.identity.siteId) continue;
        const oldSite = oldHandoff.resources.find((resource) => resource.kind === 'site'
          && resource.status === 'remote_verified' && resource.service === siteResource.service
          && resource.name === siteResource.name && resource.identifier === siteResource.identifier);
        if (!oldSite) continue;
        const root = assertPathInside(this.paths.handoffsDir, path.join(this.paths.root, oldHandoff.relativePath));
        const bytes = await readFile(assertPathInside(root, path.join(root, oldSite.relativePath)));
        if (bytes.length !== oldSite.bytes || sha256Bytes(bytes) !== oldSite.sha256) {
          fail(ERROR_CODES.PUBLICATION_HASH_MISMATCH, 'Verified CMS bundle has changed locally.');
        }
        if (JSON.stringify(normalize(unzipSync(bytes))) === candidateSignature) {
          siteDeployment = { ...copyResourceRecord(oldSite), status: 'remote_verified', reused: true };
          siteResource = null;
        }
        // Only the latest exact revision of this triple describes what is
        // deployed. An older matching config must never suppress a real update.
        break;
      }
    }
    const all = orderResources([
      ...mediaResources,
      ...contentResources,
      ...indexResources,
      manifestResource,
      ...(siteResource ? [siteResource] : [])
    ]).map((resource, index) => ({ ...resource, order: index }));

    const resourceCount = all.length;
    const perResourceFee = feePerResource === null || feePerResource === undefined
      ? Number(plan.estimates?.feePerResource ?? 0)
      : Number(feePerResource);
    if (!Number.isFinite(perResourceFee) || perResourceFee < 0) {
      fail(ERROR_CODES.INVALID_ARGUMENT, 'feePerResource must be a non-negative number.');
    }
    const handoff = {
      schema: HANDOFF_SCHEMA,
      version: HANDOFF_VERSION,
      handoffId,
      publicationBatchId,
      planId: plan.planId,
      projectId: project.id,
      siteId: project.identity.siteId,
      siteNamespace: this.identity.state.namespace,
      createdAt: now,
      target,
      publisher: {
        minVersion: '0.6.1',
        bridge: 'qortalRequest',
        instructions: 'Open the Migration Publisher Q-App in Qortal Hub, select this handoff folder or its .zip package, review the resources and approve publication. Signing is performed by Qortal Hub.'
      },
      estimate: {
        resourceCount,
        feePerResource: perResourceFee,
        estimatedFee: Math.round(resourceCount * perResourceFee * 1e8) / 1e8,
        currency: 'QORT',
        label: 'Estimate only. Qortal Hub shows the current network fee before approval.',
        batches: Math.ceil(resourceCount / 20)
      },
      resources: all.map((resource) => ({
        id: resource.id,
        kind: resource.kind,
        service: resource.service,
        name: resource.name,
        identifier: resource.identifier,
        relativePath: resource.relativePath,
        contentType: resource.contentType,
        bytes: resource.bytes,
        sha256: resource.sha256,
        order: resource.order,
        dependsOn: resource.dependsOn ?? [],
        sourceKey: resource.sourceKey ?? null,
        metadata: publicMetadata(resource.metadata)
      }))
    };
    assertNoSecretFields(handoff);
    const sealed = sealDocument(handoff);
    assertHandoffManifest(sealed);

    const handoffDir = assertPathInside(this.paths.handoffsDir, path.join(this.paths.handoffsDir, handoffId), 'handoff directory');
    await mkdir(handoffDir, { recursive: true });
    let written = 0;
    for (const resource of all) {
      const targetPath = assertPathInside(handoffDir, path.join(handoffDir, resource.relativePath), 'payload path');
      const payload = resource.payload ?? (resource.kind === 'media'
        ? await readFile(resource.metadata.assetPath)
        : null);
      if (!payload) fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, 'No bytes available for ' + resource.id + '.');
      const actual = sha256Bytes(payload);
      if (payload.length !== resource.bytes || actual !== resource.sha256) {
        fail(ERROR_CODES.PUBLICATION_HASH_MISMATCH, 'Prepared payload hash mismatch for ' + resource.id + '.');
      }
      await atomicWriteFile(targetPath, payload, { mode: 0o600 });
      written += 1;
      if (written % 25 === 0 || written === all.length) {
        await this._progress('writing_payloads', written, all.length,
          'Wrote ' + written + ' of ' + all.length + ' handoff file(s).', 'PUBLICATION_PAYLOADS_WRITTEN');
      }
    }
    await atomicWriteJson(path.join(handoffDir, 'handoff.json'), sealed, { mode: 0o600 });
    await atomicWriteFile(
      path.join(handoffDir, 'README.txt'),
      [
        'Qortal Migration Studio publication handoff',
        '',
        'Open Qortal Hub, launch the Migration Publisher Q-App and select this whole folder.',
        'The Publisher validates handoff.json and every payload hash before asking for approval.',
        '',
        'Project: ' + project.id,
        'Site: ' + project.identity.siteId,
        'Handoff: ' + handoffId,
        'Plan: ' + plan.planId,
        'Target name: ' + target.qdnName,
        'Resources: ' + resourceCount,
        '',
        'This package contains no wallet seed, private key, password, cookie or API key.',
        ''
      ].join('\n'),
      { mode: 0o600 }
    );
    const validated = await validateHandoffPackage({ handoffDir, manifest: sealed });
    await this._progress('validated', validated.verified.length, sealed.resources.length,
      'Validated ' + validated.verified.length + ' handoff file hash(es).', 'PUBLICATION_PACKAGE_VALIDATED');
    const relativePath = relativeProjectPath(this.paths, handoffDir);
    const resourceRecords = all.map((resource) => ({
      ...copyResourceRecord(resource),
      state: 'handoff_ready',
      // The manifest describes the local preparation state. Renderers must be
      // able to read either status (publication state) or state (handoff
      // preparation state) without assuming one of them exists.
      status: 'handoff_ready',
      handoffId,
      publicationBatchId,
      updatedAt: now
    }));
    const record = {
      schema: 'qms-publication-plan@1',
      version: 1,
      handoffId,
      publicationBatchId,
      planId: plan.planId,
      projectId: project.id,
      siteId: project.identity.siteId,
      siteNamespace: this.identity.state.namespace,
      target,
      status: 'handoff_ready',
      createdAt: now,
      updatedAt: now,
      relativePath,
      selectionSignature,
      siteDeployment,
      manifestIntegrity: sealed.integrity,
      estimate: sealed.estimate,
      counts: summarizeHandoff(sealed).counts,
      resources: resourceRecords,
      evidence: {
        packageValidatedAt: this.clock.nowIso(),
        filesVerified: validated.verified.length
      }
    };
    await this.store.transaction((draft) => {
      const state = draft.publication;
      state.handoffs[handoffId] = record;
      state.plans[publicationBatchId] = {
        ...record,
        handoffId,
        handoffPath: relativePath
      };
      for (const resource of resourceRecords) {
        state.resources[resource.id] = {
          ...resource,
          status: 'handoff_ready',
          history: []
        };
        if (resource.kind === 'content' && resource.sourceKey) {
          const mapping = draft.identity?.mappings?.[resource.sourceKey];
          if (mapping) {
            mapping.localPreparation = 'prepared';
            mapping.handoffId = handoffId;
            mapping.handoffPreparedAt = now;
            mapping.updatedAt = now;
          }
        }
      }
      state.history.unshift({
        type: 'handoff_prepared',
        handoffId,
        publicationBatchId,
        planId: plan.planId,
        at: now,
        resourceCount,
        status: 'handoff_ready'
      });
      state.history = state.history.slice(0, 1000);
      state.revision += 1;
      state.counters.batch += 1;
      state.counters.handoff += 1;
    });

    if (this.recovery && prepareStage) {
      await this.recovery.stageComplete(prepareStage, { status: 'completed', details: { handoffId } });
    }
    if (this.audit) {
      await this.audit.record({
        type: 'publication_prepared',
        handoffId,
        status: 'handoff_ready',
        details: {
          planId: plan.planId,
          resources: resourceRecords.length,
          handoffPath: relativePath
        }
      }).catch(() => {});
    }
    return {
      handoffId,
      publicationBatchId,
      planId: plan.planId,
      status: 'handoff_ready',
      handoffPath: relativePath,
      absolutePath: handoffDir,
      resources: resourceRecords,
      counts: record.counts,
      estimate: sealed.estimate,
      packageValidated: true,
      reused: false,
      message: 'Portable handoff is ready. Open it in the Migration Publisher Q-App in Qortal Hub.'
    };
  }

  list({ limit = 100 } = {}) {
    return Object.values(this._assertState().handoffs)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, limit)
      .map((record) => ({
        handoffId: record.handoffId,
        publicationBatchId: record.publicationBatchId,
        planId: record.planId,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        target: record.target,
        estimate: record.estimate,
        counts: record.counts,
        resourceCount: record.resources.length,
        handoffPath: record.relativePath
      }));
  }

  /**
   * Export the exact handoff folder as a single portable ZIP. The Publisher
   * accepts this file directly, so an ordinary user never has to navigate into
   * an application data directory or select a folder tree manually.
   */
  async exportBundle(handoffId) {
    const record = this._requireRecord(handoffId);
    await this._assertCatalogCurrent(record);
    const loaded = await this._loadManifest(record);
    const validated = await validateHandoffPackage({ handoffDir: loaded.root, manifest: loaded.manifest });
    if (validated.verified.length !== loaded.manifest.resources.length) {
      fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, 'The handoff package is incomplete; refusing to export it.');
    }
    const entries = {};
    const mtime = new Date('1980-01-01T00:00:00.000Z');
    let total = 0;
    const walk = async (directory, prefix = '') => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        const relative = prefix ? prefix + '/' + entry.name : entry.name;
        if (entry.isSymbolicLink()) {
          fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, 'The handoff contains a symbolic link: ' + relative);
        }
        if (entry.isDirectory()) await walk(absolute, relative);
        else if (entry.isFile()) {
          const info = await stat(absolute);
          const bytes = await readFile(absolute);
          total += bytes.length;
          if (total > 2 * 1024 * 1024 * 1024) {
            fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, 'The handoff package is too large to export.');
          }
          if (info.size !== bytes.length) fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, 'Handoff changed while exporting: ' + relative);
          entries[relative] = [new Uint8Array(bytes), { level: 6, mtime }];
        }
      }
    };
    await walk(loaded.root);
    if (!entries['handoff.json']) fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, 'The exported package has no handoff.json.');
    const zip = Buffer.from(zipSync(entries, { level: 6, mtime }));
    const dir = path.join(this.paths.dataRoot, 'exports');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const target = path.join(dir, record.handoffId + '-publisher.zip');
    const temporary = target + '.tmp';
    await atomicWriteFile(temporary, zip, { mode: 0o600 });
    await rename(temporary, target);
    if (this.audit) {
      await this.audit.record({
        type: 'publication_bundle_exported',
        handoffId: record.handoffId,
        status: record.status,
        details: { bytes: zip.length, sha256: sha256Bytes(zip) }
      }).catch(() => {});
    }
    return {
      handoffId: record.handoffId,
      absolutePath: target,
      filename: path.basename(target),
      bytes: zip.length,
      sha256: sha256Bytes(zip),
      resources: loaded.manifest.resources.length
    };
  }

  async get(handoffId, { validate = true } = {}) {
    const record = this._requireRecord(handoffId);
    let packageValid = false;
    let validation = null;
    if (validate) {
      const loaded = await this._loadManifest(record);
      validation = await validateHandoffPackage({ handoffDir: loaded.root, manifest: loaded.manifest });
      packageValid = true;
    }
    return {
      handoff: record,
      resources: record.resources,
      siteDeployment: record.siteDeployment ?? null,
      absolutePath: path.join(this.paths.root, record.relativePath),
      packageValid,
      validation: validation ? { filesVerified: validation.verified.length, summary: validation.summary } : null
    };
  }

  history({ limit = 200 } = {}) {
    return this._assertState().history.slice(0, limit);
  }

  resourceStates({ handoffId = null } = {}) {
    const resources = Object.values(this._assertState().resources ?? {});
    return (handoffId ? resources.filter((resource) => resource.handoffId === handoffId) : resources)
      .sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)));
  }

  batches(handoffId) {
    const record = this._requireRecord(handoffId);
    return planBatches(record.resources);
  }

  /**
   * Check the exact registered display name against the owner address through
   * Core's read-only names API. This is deliberately separate from publication
   * verification: an ownership result that is not 'verified' is blocked.
   */
  async verifyOwnership({ handoffId = null, nodeUrl, ownerAddress }) {
    const record = handoffId ? this._requireRecord(handoffId) : null;
    const name = record?.target?.qdnName ?? this.getProject().target?.qdnName ?? null;
    if (!name) fail(ERROR_CODES.TARGET_NAME_REQUIRED, 'A target Qortal name is required.');
    return verifyQortalNameOwnership({
      fetchImpl: this.fetchImpl ?? globalThis.fetch,
      nodeUrl,
      name,
      ownerAddress
    });
  }

  async importReceipt({ handoffId, receipt }) {
    const record = this._requireRecord(handoffId);
    assertReceipt(receipt, { expect: record });
    const receiptStage = this.recovery
      ? this._stageId('receipt', handoffId + '|' + receipt.receiptId)
      : null;
    if (this.recovery) {
      await this.recovery.stageCheckpoint({
        stageId: receiptStage,
        kind: 'publication.import_receipt',
        phase: 'receipt',
        step: 'receipt_import_start',
        resumable: true,
        resume: {
          service: 'publication',
          method: 'importStoredReceipt',
          params: { handoffId, receiptId: receipt.receiptId }
        },
        details: { handoffId, receiptId: receipt.receiptId }
      });
    }
    const reconciled = reconcileReceiptResults(receipt, record.resources);
    const missingCount = reconciled.filter((result) => result.missing === true).length;
    const now = this.clock.nowIso();
    const receiptPath = assertPathInside(this.paths.receiptsDir, path.join(this.paths.receiptsDir, receipt.receiptId + '.json'), 'receipt path');
    await atomicWriteJson(receiptPath, receipt, { mode: 0o600 });
    if (this.recovery && receiptStage) {
      await this.recovery.stageCheckpoint({
        stageId: receiptStage,
        kind: 'publication.import_receipt',
        phase: 'receipt',
        step: 'receipt_written',
        resumable: true,
        resume: {
          service: 'publication',
          method: 'importStoredReceipt',
          params: { handoffId, receiptId: receipt.receiptId }
        },
        details: { handoffId, receiptId: receipt.receiptId, receiptRelativePath: path.relative(this.paths.root, receiptPath).split(path.sep).join('/') }
      });
    }
    const updated = [];
    await this.store.transaction((draft) => {
      const state = draft.publication;
      const handoff = state.handoffs[handoffId];
      if (!handoff) fail(ERROR_CODES.PUBLICATION_PLAN_NOT_FOUND, 'Handoff disappeared while importing a receipt.');
      for (const [index, result] of reconciled.entries()) {
        const resource = handoff.resources[index];
        const cached = state.resources[resource.id];
        const stored = { ...resource };
        stored.status = resource.status === 'remote_verified' ? 'remote_verified'
          : result.status === 'remote_verified' ? 'pending_confirmation' : result.status;
        stored.state = stored.status;
        stored.publisherReportedStatus = result.status;
        stored.reason = result.reason ?? null;
        stored.txSignature = result.txSignature ?? null;
        stored.receiptId = receipt.receiptId;
        stored.receiptImportedAt = now;
        stored.updatedAt = now;
        stored.evidence = {
          ...(stored.evidence ?? {}),
          receiptReportedAt: result.confirmedAt ?? result.submittedAt ?? null,
          receiptVerification: result.verification ?? null,
          independentVerificationRequired: true
        };
        if (!cached || cached.handoffId === handoffId) state.resources[resource.id] = stored;
        updated.push(stored);
      }
      handoff.resources = updated;
      handoff.status = updated.every((resource) => resource.status === 'remote_verified')
        ? 'remote_verified' : missingCount > 0 ? 'partial' : aggregateStatus(updated);
      handoff.lastReceiptId = receipt.receiptId;
      handoff.updatedAt = now;
      state.plans[handoff.publicationBatchId] = {
        ...(state.plans[handoff.publicationBatchId] ?? {}),
        status: handoff.status,
        lastReceiptId: receipt.receiptId,
        updatedAt: now
      };
      state.history.unshift({
        type: 'receipt_imported',
        handoffId,
        publicationBatchId: receipt.publicationBatchId,
        receiptId: receipt.receiptId,
        at: now,
        counts: receipt.counts,
        status: handoff.status
      });
      state.history = state.history.slice(0, 1000);
      state.revision += 1;
    });
    if (this.recovery && receiptStage) {
      await this.recovery.stageComplete(receiptStage, { status: 'completed', details: { receiptId: receipt.receiptId } });
    }
    if (this.audit) {
      await this.audit.record({
        type: 'publication_receipt_imported',
        handoffId,
        status: updated.every((resource) => resource.status === 'pending_confirmation') ? 'pending_confirmation' : aggregateStatus(updated),
        details: {
          receiptId: receipt.receiptId,
          counts: receipt.counts,
          missing: missingCount
        }
      }).catch(() => {});
    }
    return {
      handoffId,
      receiptId: receipt.receiptId,
      status: updated.every((resource) => resource.status === 'pending_confirmation') ? 'pending_confirmation' : aggregateStatus(updated),
      counts: receipt.counts,
      resources: updated,
      independentVerificationRequired: true,
      message: 'Receipt imported as Publisher-reported evidence. Nothing is marked published until exact QDN read-back succeeds.'
    };
  }

  /**
   * Re-import a receipt that is already stored on disk. This is the recovery
   * continuation for a crash between writing the receipt file and committing
   * its state transition.
   */
  async importStoredReceipt({ handoffId, receiptId } = {}) {
    if (typeof receiptId !== 'string' || !RECEIPT_ID.test(receiptId)) {
      fail(ERROR_CODES.INVALID_ARGUMENT, 'A valid receipt id is required.');
    }
    const record = this._requireRecord(handoffId);
    const receiptFile = assertPathInside(this.paths.receiptsDir, path.join(this.paths.receiptsDir, receiptId + '.json'), 'receipt path');
    let receipt;
    try {
      receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
    } catch (error) {
      fail(ERROR_CODES.PUBLICATION_RECEIPT_INVALID, 'The stored receipt could not be read for recovery.', {
        receiptId,
        cause: error.message
      });
    }
    void record;
    return this.importReceipt({ handoffId, receipt });
  }

  async verify({ handoffId, nodeUrl, attempts = 6, intervalMs = 1500, timeoutMs = 30000 } = {}) {
    const record = this._requireRecord(handoffId);
    const verifyStage = this.recovery ? this._stageId('verify', handoffId) : null;
    if (this.recovery) {
      await this.recovery.stageCheckpoint({
        stageId: verifyStage,
        kind: 'publication.verify',
        phase: 'verify',
        step: 'verify_start',
        resumable: true,
        resume: {
          service: 'publication',
          method: 'verify',
          params: { handoffId, nodeUrl, attempts, intervalMs }
        },
        details: { handoffId, resources: record.resources.length, nodeUrl }
      });
    }
    const resources = record.resources.map((resource) => ({
      id: resource.id,
      service: resource.service,
      name: resource.name,
      identifier: resource.identifier,
      bytes: resource.bytes,
      sha256: resource.sha256,
      metadata: resource.metadata ?? null
    }));
    const verification = await verifyResources({
      fetchImpl: this.fetchImpl ?? globalThis.fetch,
      nodeUrl,
      resources,
      attempts,
      intervalMs,
      timeoutMs
    });
    const now = this.clock.nowIso();
    const verified = [];
    const retainedMedia = this.sync
      ? (await this.sync.catalog({ resources: true })).flatMap((resource) => resource.mediaResources ?? []) : [];
    const exactMedia = record.resources.filter((resource) => resource.kind === 'media'
      && verification.results.some((result) => result.resourceId === resource.id && result.state === 'remote_verified'));
    const snapshots = new Map();
    for (const resource of record.resources) {
      if (resource.kind !== 'content' || !verification.results.some((result) => result.resourceId === resource.id
        && result.state === 'remote_verified')) continue;
      const root = assertPathInside(this.paths.handoffsDir, path.join(this.paths.root, record.relativePath));
      const payload = await readFile(assertPathInside(root, path.join(root, resource.relativePath)));
      if (payload.length !== resource.bytes || sha256Bytes(payload) !== resource.sha256) {
        fail(ERROR_CODES.PUBLICATION_HASH_MISMATCH, 'Verified content no longer matches its handoff.');
      }
      const media = JSON.parse(payload).media ?? [];
      const refs = Object.values(media).flatMap((entries) => Array.isArray(entries) ? entries : [entries])
        .map((entry) => entry?.qdn).filter(Boolean);
      const mediaResources = refs.map((ref) => [...exactMedia, ...retainedMedia].find((entry) =>
        entry.service === ref.service && entry.name === ref.name && entry.identifier === ref.identifier
        && entry.sha256 === ref.sha256 && entry.bytes === ref.bytes));
      if (mediaResources.some((entry) => !entry)) continue;
      snapshots.set(resource.sourceKey, { handoffId, resource: copyResourceRecord(resource), verifiedAt: now,
        mediaResources: mediaResources.map(copyResourceRecord) });
    }
    await this.store.transaction((draft) => {
      const state = draft.publication;
      const handoff = state.handoffs[handoffId];
      if (!handoff) fail(ERROR_CODES.PUBLICATION_PLAN_NOT_FOUND, 'Handoff disappeared during verification.');
      for (const result of verification.results) {
        const resource = handoff.resources.find((entry) => entry.id === result.resourceId);
        if (!resource) continue;
        const cached = state.resources[resource.id];
        const stored = { ...resource };
        const previous = stored.status;
        if (result.state === 'remote_verified') {
          stored.status = 'remote_verified';
          stored.state = 'remote_verified';
          stored.remoteVerifiedAt = now;
          stored.evidence = { ...(stored.evidence ?? {}), verification: result.evidence ?? null };
          if (resource.kind === 'content' && resource.sourceKey) {
            const mapping = draft.identity?.mappings?.[resource.sourceKey];
            if (mapping) {
              if (snapshots.has(resource.sourceKey) && mapping.service === resource.service
                && mapping.name === resource.name && mapping.identifier === resource.identifier) {
                mapping.verifiedPublication = snapshots.get(resource.sourceKey);
              }
              const matchesCurrent = mapping.contentHash === resource.metadata?.contentHash
                && (resource.metadata?.routeHash ? mapping.routeHash === resource.metadata.routeHash
                  : mapping.slug === resource.metadata?.slug);
              if (matchesCurrent) {
                mapping.publicationStatus = 'remote_verified';
                mapping.remoteVerifiedAt = now;
                mapping.localPreparation = 'prepared';
              }
              mapping.publishedAt = mapping.publishedAt ?? now;
              mapping.updatedAt = now;
            }
          }
        } else if (result.state === 'failed') {
          stored.status = 'failed';
          stored.state = 'failed';
          stored.reason = result.message;
        } else if (result.state === 'blocked') {
          stored.status = 'blocked';
          stored.state = 'blocked';
          stored.reason = result.message;
        } else if (result.state === 'ambiguous') {
          stored.status = 'ambiguous';
          stored.state = 'ambiguous';
          stored.reason = result.message;
        } else if (result.state === 'pending') {
          stored.status = 'pending_confirmation';
          stored.state = 'pending_confirmation';
          stored.reason = result.message;
        } else {
          stored.status = 'blocked';
          stored.state = 'blocked';
          stored.reason = result.message ?? 'Verification was inconclusive.';
        }
        stored.lastVerification = {
          state: result.state,
          code: result.code,
          message: result.message,
          at: now,
          evidence: result.evidence ?? null,
          transport: result.transport ?? null
        };
        stored.updatedAt = now;
        if (!cached || cached.handoffId === handoffId) state.resources[resource.id] = stored;
        resource.status = stored.status;
        resource.state = stored.state;
        if (result.state === 'remote_verified') resource.remoteVerifiedAt = now;
        resource.updatedAt = now;
        resource.lastVerification = stored.lastVerification;
        resource.evidence = stored.evidence;
        verified.push(stored);
        void previous;
      }
      handoff.status = aggregateStatus(handoff.resources);
      handoff.updatedAt = now;
      handoff.lastVerification = {
        at: now,
        nodeUrl: verification.nodeUrl,
        counts: verification.counts
      };
      if (state.plans[handoff.publicationBatchId]) {
        state.plans[handoff.publicationBatchId].status = handoff.status;
        state.plans[handoff.publicationBatchId].updatedAt = now;
      }
      state.history.unshift({
        type: 'verification_run',
        handoffId,
        at: now,
        nodeUrl: verification.nodeUrl,
        counts: verification.counts,
        status: handoff.status
      });
      state.history = state.history.slice(0, 1000);
      state.revision += 1;
    });
    if (this.sync) await this.sync.writeCatalog({ publishedOnly: true });
    const evidencePath = path.join(this.paths.receiptsDir, handoffId + '-verification.json');
    await atomicWriteJson(evidencePath, verification, { mode: 0o600 });
    if (this.recovery && verifyStage) {
      await this.recovery.stageComplete(verifyStage, {
        status: 'completed',
        details: { counts: verification.counts }
      });
    }
    if (this.audit) {
      for (const resource of verified) {
        await this.audit.record({
          type: 'publication_verified',
          handoffId,
          resourceId: resource.id,
          sourceKey: resource.sourceKey ?? null,
          status: resource.status,
          txSignature: resource.txSignature ?? null,
          contentHash: resource.sha256 ?? null,
          bytes: resource.bytes ?? null,
          details: {
            identifier: resource.identifier,
            independentVerification: resource.status === 'remote_verified',
            nodeUrl: verification.nodeUrl
          }
        }).catch(() => {});
      }
    }
    return {
      handoffId,
      status: aggregateStatus(verified),
      counts: verification.counts,
      results: verification.results,
      resources: verified,
      evidencePath: relativeProjectPath(this.paths, evidencePath),
      pendingOrUnverified: verification.results.filter((result) => TERMINAL_GOOD.has(result.state) === false && TERMINAL_BAD.has(result.state) === false).length
    };
  }
}



export {
  HANDOFF_SCHEMA,
  HANDOFF_VERSION,
  RECEIPT_SCHEMA,
  RECEIPT_VERSION,
  PUBLICATION_STATE_SCHEMA,
  MAX_BATCH_RESOURCES,
  DEFAULT_MAX_UNCONFIRMED,
  PUBLICATION_RESOURCE_STATES,
  PUBLISHABLE_SERVICES,
  KIND_PHASE,
  sha256Bytes,
  sealDocument,
  verifyDocumentIntegrity,
  assertHandoffManifest,
  validateHandoffPackage,
  summarizeHandoff,
  publicationStateForReceiptStatus
} from './handoff.js';
export { planBatches, orderResources, normalizePublishOutcome, summarizeResults } from './order.js';
export { createReceipt, assertReceipt, reconcileReceiptResults } from './receipts.js';
export { verifyResources, verifyResourceOnce, normalizeNodeUrl } from './remote.js';

function extension(mimeType) {
  const mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/mp4': 'm4a',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/ogg': 'ogv',
    'application/pdf': 'pdf'
  };
  return map[mime] ?? 'bin';
}
