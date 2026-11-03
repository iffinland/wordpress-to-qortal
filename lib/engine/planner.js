import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { QmsError, ERROR_CODES } from './errors.js';
import {
  addConflictRecord,
  base32,
  classifyCandidate,
  conflictIdFor,
  isPendingPublication,
  preparationStatusFor,
  reservePlanInState,
  routeProjectionFromIndex
} from './identity.js';
import { resolveRunConfig } from './config.js';
import { diskPreflight } from './disk.js';
import {
  readIndexedItem,
  readIndexEntries,
  resolveLatestSourceBatch
} from './source-index.js';
import { atomicWriteJson } from './storage/atomic.js';
import { assertPathInside } from './storage/paths.js';
import { MediaDownloader } from '../media/downloader.js';
import { stableStringify } from '../model/content.js';

export const PLAN_SCHEMA = 'qms-plan@1';
export const PLAN_RECORD_SCHEMA = 'qms-plan-record@1';
export const SUPPORTED_CONTENT_TYPES = Object.freeze(['post', 'page']);
const PLAN_ID_PATTERN = /^plan_[a-z0-9]{8,40}$/;

const ACTIONABLE = new Set(['new', 'modified', 'route_changed']);

function normalizeDate(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const time = Date.parse(String(value));
  if (!Number.isFinite(time)) {
    throw new QmsError(ERROR_CODES.CONFIG_INVALID, label + ' must be a valid ISO timestamp.', {
      details: { label, value }
    });
  }
  return new Date(time).toISOString();
}

function normalizeFilters(input = {}, planning = {}) {
  const contentTypes = Array.isArray(input.contentTypes) && input.contentTypes.length > 0
    ? [...new Set(input.contentTypes.map((value) => String(value).trim()).filter(Boolean))]
    : ['post', 'page'];
  const supported = contentTypes.filter((value) => SUPPORTED_CONTENT_TYPES.includes(value));
  const effective = planning.includePages === false ? supported.filter((value) => value !== 'page') : supported;
  const filters = {
    after: normalizeDate(input.after, 'filters.after'),
    before: normalizeDate(input.before, 'filters.before'),
    modifiedAfter: normalizeDate(input.modifiedAfter ?? input.modified_after, 'filters.modifiedAfter'),
    modifiedBefore: normalizeDate(input.modifiedBefore ?? input.modified_before, 'filters.modifiedBefore'),
    contentTypes: effective,
    statuses: Array.isArray(input.statuses) && input.statuses.length > 0
      ? [...new Set(input.statuses.map((value) => String(value).trim()).filter(Boolean))]
      : null,
    search: typeof input.search === 'string' && input.search.trim() !== '' ? input.search.trim() : null
  };
  if (filters.after && filters.before && Date.parse(filters.after) > Date.parse(filters.before)) {
    throw new QmsError(ERROR_CODES.CONFIG_INVALID, 'filters.after must not be later than filters.before.');
  }
  if (filters.modifiedAfter && filters.modifiedBefore && Date.parse(filters.modifiedAfter) > Date.parse(filters.modifiedBefore)) {
    throw new QmsError(ERROR_CODES.CONFIG_INVALID, 'filters.modifiedAfter must not be later than filters.modifiedBefore.');
  }
  return filters;
}

function compareEntries(left, right, order) {
  const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : null;
  const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : null;
  if (leftTime === null && rightTime === null) {
    return String(left.sourceKey).localeCompare(String(right.sourceKey));
  }
  if (leftTime === null) return 1;
  if (rightTime === null) return -1;
  if (leftTime !== rightTime) {
    return order === 'asc' ? leftTime - rightTime : rightTime - leftTime;
  }
  return String(left.sourceKey).localeCompare(String(right.sourceKey));
}

function matchesFilters(entry, filters) {
  if (!filters.contentTypes.includes(entry.contentType)) return false;
  if (filters.statuses && !filters.statuses.includes(entry.publicationStatus)) return false;
  if (filters.search) {
    const haystack = (entry.title ?? '') + ' ' + (entry.slug ?? '') + ' ' + (entry.sourceKey ?? '');
    if (!haystack.toLowerCase().includes(filters.search.toLowerCase())) return false;
  }
  if (filters.after) {
    if (!entry.publishedAt || Date.parse(entry.publishedAt) < Date.parse(filters.after)) return false;
  }
  if (filters.before) {
    if (!entry.publishedAt || Date.parse(entry.publishedAt) > Date.parse(filters.before)) return false;
  }
  if (filters.modifiedAfter) {
    if (!entry.sourceModifiedAt || Date.parse(entry.sourceModifiedAt) < Date.parse(filters.modifiedAfter)) return false;
  }
  if (filters.modifiedBefore) {
    if (!entry.sourceModifiedAt || Date.parse(entry.sourceModifiedAt) > Date.parse(filters.modifiedBefore)) return false;
  }
  return true;
}

function collectMedia(document, issues) {
  const media = [];
  const push = (entry, role) => {
    if (!entry) return;
    const url = entry.resolved_url ?? entry.url ?? null;
    if (!url) {
      issues.push({
        code: 'MEDIA_WITHOUT_URL',
        message: 'A media reference has no usable URL.',
        sourceKey: document.source.key,
        itemId: document.id,
        role,
        details: { key: entry.key ?? null, sourceId: entry.source_id ?? null }
      });
      return;
    }
    media.push({
      url,
      role,
      key: entry.key ?? null,
      sourceId: entry.source_id ?? null,
      mimeType: entry.mime_type ?? null,
      external: Boolean(entry.external),
      alt: entry.alt ?? null
    });
  };
  push(document.media?.featured, 'featured');
  for (const role of ['images', 'audio', 'video', 'documents', 'attachments']) {
    for (const entry of document.media?.[role] ?? []) {
      push(entry, role);
    }
  }
  return media;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function emptyStats() {
  return {
    scanned: 0,
    new: 0,
    modified: 0,
    unchanged: 0,
    route_changed: 0,
    conflict: 0,
    error: 0,
    unsupported: 0,
    reserved: 0,
    withdrawn: 0,
    selected: 0
  };
}

function planFileFor(paths, planId) {
  if (!PLAN_ID_PATTERN.test(planId)) {
    throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'Invalid plan id: ' + String(planId), {
      details: { planId }
    });
  }
  const directory = assertPathInside(paths.plansDir, path.join(paths.plansDir, planId), 'plan directory');
  return { directory, file: path.join(directory, 'plan.json') };
}

export class PlanningService {
  constructor({ project, paths, store, clock, runs, events, identity, diskProbe = null, fetchImpl = null }) {
    this.getProject = typeof project === 'function' ? project : () => project;
    this.paths = paths;
    this.store = store;
    this.clock = clock;
    this.runs = runs;
    this.events = events;
    this.identity = identity;
    this.diskProbe = diskProbe;
    this.fetchImpl = fetchImpl;
  }

  _config(overrides = {}) {
    return resolveRunConfig(this.getProject(), overrides);
  }

  async create({
    batchSize = undefined,
    filters = {},
    planning = {},
    disk = {},
    media = {},
    estimateMedia = true,
    persist = true,
    signal = null
  } = {}) {
    const overrides = {
      planning: {
        ...(batchSize !== undefined ? { batchSize } : {}),
        ...planning
      },
      disk,
      media
    };
    // Configuration errors are rejected before a run is created.
    const config = this._config(overrides);
    const filtersNormalized = normalizeFilters(filters, config.planning);
    const target = this.identity.requireTarget();
    const project = this.getProject();

    const context = await this.runs.start({
      kind: 'plan.create',
      phase: 'index',
      meta: {
        batchId: null,
        batchSize: config.planning.batchSize,
        filters: filtersNormalized,
        estimateMedia: estimateMedia !== false
      }
    });
    const onAbort = () => context.controller.abort('cancelled');
    if (signal) {
      if (signal.aborted) context.controller.abort('cancelled');
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    const warnings = [];
    const errors = [];
    const mediaIssues = [];
    const stats = emptyStats();
    try {
      await context.phase('index');
      const latest = await resolveLatestSourceBatch(this.paths, project.source?.adapter ?? 'wordpress');
      if (latest.truncated) {
        warnings.push({
          code: 'SOURCE_BATCH_TRUNCATED',
          message: 'The latest discovery batch is explicitly truncated; planning treats it as incomplete and does not infer deletions.',
          details: { batchId: latest.batchId }
        });
        await context.warn('SOURCE_BATCH_TRUNCATED', warnings.at(-1).message, { batchId: latest.batchId });
      }
      const { entries: indexed, truncated: scanTruncated } = await readIndexEntries(latest.indexJsonl, {
        maxEntries: config.planning.maxScanItems
      });
      if (scanTruncated) {
        warnings.push({
          code: 'SOURCE_INDEX_SCAN_TRUNCATED',
          message: 'Planning scanned only the configured maximum number of metadata entries.',
          details: { maxScanItems: config.planning.maxScanItems }
        });
        await context.warn('SOURCE_INDEX_SCAN_TRUNCATED', warnings.at(-1).message, {
          maxScanItems: config.planning.maxScanItems
        });
      }
      await context.progress({
        phase: 'index',
        completed: 1,
        total: 1,
        code: 'PLAN_INDEX_LOADED',
        message: 'Source index metadata loaded.',
        details: { batchId: latest.batchId, indexed: indexed.length }
      });

      await context.phase('classify');
      const candidates = [];
      const issueEntries = [];
      const conflictRecords = [];
      const pendingEntries = [];
      const identityState = this.identity.state;
      let unsupportedItemCount = 0;
      for (const entry of indexed) {
        context.throwIfCancelled();
        if (!SUPPORTED_CONTENT_TYPES.includes(entry.contentType)) {
          stats.scanned += 1;
          stats.unsupported += 1;
          unsupportedItemCount += 1;
          if (issueEntries.length < 500) {
            issueEntries.push({
              id: entry.id,
              file: entry.file,
              sourceKey: entry.sourceKey,
              contentType: entry.contentType,
              title: entry.title ?? null,
              slug: entry.slug ?? null,
              status: 'unsupported',
              reason: 'UNSUPPORTED_CONTENT_TYPE'
            });
          }
          continue;
        }
        if (!matchesFilters(entry, filtersNormalized)) continue;
        stats.scanned += 1;
        const mapping = identityState.mappings[entry.sourceKey] ?? null;
        const classification = classifyCandidate({
          entry,
          mapping,
          identity: identityState,
          target
        });
        stats[classification.status] = (stats[classification.status] ?? 0) + 1;
        if (classification.status === 'reserved') {
          pendingEntries.push({
            sourceKey: entry.sourceKey,
            contentType: entry.contentType,
            title: entry.title ?? null,
            publicationStatus: classification.publicationStatus ?? 'reserved',
            localPreparation: classification.localPreparation ?? preparationStatusFor(mapping)
          });
        }
        if (classification.status === 'conflict') {
          const conflictRecord = {
            id: conflictIdFor(
              classification.conflict.kind,
              classification.conflict.sourceKey,
              classification.conflict.triple
            ),
            sourceKey: entry.sourceKey,
            contentType: entry.contentType,
            title: entry.title ?? null,
            kind: classification.conflict.kind,
            message: classification.conflict.message,
            details: classification.conflict
          };
          if (conflictRecords.length < 200) conflictRecords.push(conflictRecord);
          if (issueEntries.length < 500) issueEntries.push({
            id: entry.id,
            file: entry.file,
            sourceKey: entry.sourceKey,
            contentType: entry.contentType,
            title: entry.title ?? null,
            slug: entry.slug ?? null,
            status: 'conflict',
            conflictId: conflictRecord.id,
            conflict: classification.conflict,
            contentHash: entry.contentHash,
            routeHash: entry.routeHash ?? routeProjectionFromIndex(entry)
          });
          continue;
        }
        const actionable = (ACTIONABLE.has(classification.status) &&
          (classification.status !== 'route_changed' || config.planning.includeRouteChanges !== false)) ||
          (classification.status === 'reserved' && config.planning.includeReserved === true);
        if (!actionable) continue;
        candidates.push({ entry, mapping, classification });
      }
      candidates.sort((left, right) => compareEntries(left.entry, right.entry, config.planning.order));
      if (unsupportedItemCount > 0) {
        warnings.push({
          code: 'UNSUPPORTED_CONTENT_TYPE',
          message: 'Some indexed content types are not supported by the content planner.',
          details: { count: unsupportedItemCount }
        });
        await context.warn('UNSUPPORTED_CONTENT_TYPE', warnings.at(-1).message, { count: unsupportedItemCount });
      }
      if (conflictRecords.length > 0) {
        warnings.push({
          code: 'PLAN_CONFLICTS_PRESENT',
          message: 'Identity conflicts require an explicit resolution before these items can be published.',
          details: { count: stats.conflict }
        });
        await context.warn('PLAN_CONFLICTS_PRESENT', warnings.at(-1).message, { count: stats.conflict });
      }
      await context.progress({
        phase: 'classify',
        completed: stats.scanned,
        total: stats.scanned,
        code: 'PLAN_CLASSIFIED',
        message: 'Candidate items classified.',
        details: { stats }
      });

      await context.phase('select');
      const selected = [];
      const mediaByUrl = new Map();
      for (const candidate of candidates) {
        if (selected.length >= config.planning.batchSize) break;
        context.throwIfCancelled();
        let document;
        try {
          document = await readIndexedItem(latest.batchDir, candidate.entry, {
            baseUrl: project.source?.baseUrl ?? latest.site?.url ?? null
          });
        } catch (error) {
          const qms = error instanceof QmsError ? error : new QmsError(ERROR_CODES.PLAN_STALE, String(error));
          stats.error += 1;
          stats[candidate.classification.status] = Math.max(0, (stats[candidate.classification.status] ?? 0) - 1);
          issueEntries.push({
            id: candidate.entry.id,
            sourceKey: candidate.entry.sourceKey,
            contentType: candidate.entry.contentType,
            title: candidate.entry.title ?? null,
            slug: candidate.entry.slug ?? null,
            status: 'error',
            error: { code: qms.code, message: qms.message, details: qms.details }
          });
          await context.warn(qms.code, qms.message, { sourceKey: candidate.entry.sourceKey });
          continue;
        }
        if (!SUPPORTED_CONTENT_TYPES.includes(document.content_type)) {
          stats.unsupported += 1;
          stats[candidate.classification.status] = Math.max(0, (stats[candidate.classification.status] ?? 0) - 1);
          if (issueEntries.length >= 500) continue;
          issueEntries.push({
            id: candidate.entry.id,
            sourceKey: candidate.entry.sourceKey,
            contentType: document.content_type,
            title: candidate.entry.title ?? null,
            slug: candidate.entry.slug ?? null,
            status: 'unsupported',
            reason: 'UNSUPPORTED_CONTENT_TYPE'
          });
          await context.warn('UNSUPPORTED_CONTENT_TYPE', 'Item content type is not supported by the content planner.', {
            sourceKey: candidate.entry.sourceKey,
            contentType: document.content_type
          });
          continue;
        }
        const itemMedia = candidate.classification.status === 'route_changed'
          ? []
          : collectMedia(document, mediaIssues);
        for (const media of itemMedia) {
          const key = media.url;
          const existing = mediaByUrl.get(key) ?? {
            url: media.url,
            mimeType: media.mimeType,
            external: media.external,
            roles: [],
            items: [],
            sourceKeys: []
          };
          if (!existing.roles.includes(media.role)) existing.roles.push(media.role);
          if (!existing.items.includes(document.id)) existing.items.push(document.id);
          if (!existing.sourceKeys.includes(document.source.key)) existing.sourceKeys.push(document.source.key);
          existing.mimeType = existing.mimeType ?? media.mimeType;
          existing.external = existing.external || media.external;
          mediaByUrl.set(key, existing);
        }
        selected.push({
          id: entryId(candidate.entry),
          file: candidate.entry.file,
          sourceKey: candidate.entry.sourceKey,
          contentType: candidate.entry.contentType,
          title: document.title ?? candidate.entry.title ?? null,
          slug: document.identity?.slug ?? candidate.entry.slug ?? null,
          status: candidate.classification.status,
          contentChanged: candidate.classification.status === 'modified',
          routeChanged: candidate.classification.status === 'route_changed',
          publicationStatus: candidate.classification.publicationStatus ?? mappingPublicationStatus(candidate.mapping),
          localPreparation: candidate.classification.localPreparation ?? mappingPreparationStatus(candidate.mapping),
          pendingPublication: isPendingPublication(candidate.mapping),
          contentHash: candidate.entry.contentHash,
          routeHash: candidate.entry.routeHash ?? routeProjectionFromIndex(candidate.entry),
          sourceModifiedAt: candidate.entry.sourceModifiedAt ?? null,
          publishedAt: candidate.entry.publishedAt ?? null,
          qdn: candidate.classification.triple,
          mimeType: candidate.entry.mimeType ?? null,
          mediaCount: itemMedia.length,
          unsupported: (document.unsupported ?? []).map((entry) => entry.code ?? 'UNSUPPORTED'),
          warnings: (document.warnings ?? []).map((entry) => entry.code ?? 'WARNING')
        });
        stats.selected += 1;
      }
      await context.progress({
        phase: 'select',
        completed: stats.selected,
        total: config.planning.batchSize,
        code: 'PLAN_SELECTED',
        message: 'Batch items selected deterministically.',
        details: { selected: stats.selected, batchSize: config.planning.batchSize }
      });

      await context.phase('media_estimate');
      const mediaList = [...mediaByUrl.values()].sort((left, right) => left.url.localeCompare(right.url));
      const downloader = new MediaDownloader({
        fetchImpl: this.fetchImpl ?? globalThis.fetch,
        clock: this.clock,
        diskProbe: this.diskProbe,
        diskLimits: config.disk,
        mediaSettings: config.media,
        baseUrl: project.source?.baseUrl ?? latest.site?.url ?? null,
        assetsDir: this.paths.mediaAssetsDir,
        tmpDir: this.paths.mediaTmpDir,
        signal: context.signal
      });
      const estimates = estimateMedia === false
        ? mediaList.map((entry) => ({ status: 'unknown', url: entry.url, reason: 'estimation-disabled' }))
        : await mapLimit(mediaList, Math.min(4, config.media.concurrency), async (entry) => {
            context.throwIfCancelled();
            return downloader.estimate(entry.url);
          });
      if (context.signal.aborted) context.throwIfCancelled();
      let knownBytes = 0;
      let unknownCount = 0;
      let missingCount = 0;
      let blockedCount = 0;
      let skippedExternal = 0;
      const mediaRecords = mediaList.map((entry, index) => {
        const estimate = estimates[index] ?? { status: 'unknown', reason: 'missing-estimate' };
        const record = {
          url: entry.url,
          mimeType: entry.mimeType,
          external: entry.external || Boolean(estimate.external),
          roles: entry.roles,
          items: entry.items,
          sourceKeys: entry.sourceKeys,
          status: estimate.status,
          bytes: estimate.bytes ?? null,
          contentType: estimate.contentType ?? null,
          finalUrl: estimate.finalUrl ?? null,
          reason: estimate.reason ?? null,
          code: estimate.code ?? null,
          message: estimate.message ?? null
        };
        if (estimate.status === 'known') knownBytes += estimate.bytes ?? 0;
        else if (estimate.status === 'unknown') unknownCount += 1;
        else if (estimate.status === 'missing') missingCount += 1;
        else if (estimate.status === 'skipped_external') skippedExternal += 1;
        else if (estimate.status === 'blocked') blockedCount += 1;
        return record;
      });
      if (missingCount > 0) {
        warnings.push({
          code: 'PLAN_MEDIA_MISSING',
          message: 'Some media resources are missing or inaccessible; they are reported explicitly.',
          details: { count: missingCount }
        });
        await context.warn('PLAN_MEDIA_MISSING', warnings.at(-1).message, { count: missingCount });
      }
      if (unknownCount > 0) {
        warnings.push({
          code: 'MEDIA_SIZE_UNKNOWN',
          message: 'Some media content-length values are unknown; the configured policy decides whether the plan may proceed.',
          details: { count: unknownCount, policy: config.disk.unknownSizePolicy }
        });
        await context.warn('MEDIA_SIZE_UNKNOWN', warnings.at(-1).message, {
          count: unknownCount,
          policy: config.disk.unknownSizePolicy
        });
      }
      if (skippedExternal > 0) {
        warnings.push({
          code: 'EXTERNAL_MEDIA_LINKED_ONLY',
          message: 'External media is preserved as links unless external downloads are explicitly enabled.',
          details: { count: skippedExternal }
        });
        await context.warn('EXTERNAL_MEDIA_LINKED_ONLY', warnings.at(-1).message, { count: skippedExternal });
      }
      if (blockedCount > 0) {
        warnings.push({
          code: 'MEDIA_URL_BLOCKED',
          message: 'Some media URLs were rejected by the secure URL policy.',
          details: { count: blockedCount }
        });
        await context.warn('MEDIA_URL_BLOCKED', warnings.at(-1).message, { count: blockedCount });
      }

      await context.phase('disk_preflight');
      const metadataBytes = selected.reduce((total, entry) => {
        const original = indexed.find((candidate) => candidate.id === entry.id);
        return total + (original?.bytes ?? 0);
      }, 0) + 64 * 1024;
      const diskReport = await diskPreflight({
        probe: this.diskProbe,
        workspacePath: this.paths.root,
        limits: config.disk,
        knownBytes,
        unknownCount,
        metadataBytes
      });
      let blocked = !diskReport.fits;
      if (blocked) {
        errors.push({
          code: diskReport.reason ?? ERROR_CODES.DISK_SPACE_INSUFFICIENT,
          message: diskReport.message ?? 'Disk preflight refused the plan.',
          details: diskReport
        });
        await context.warn(diskReport.reason ?? ERROR_CODES.DISK_SPACE_INSUFFICIENT, errors.at(-1).message, {
          availableBytes: diskReport.availableBytes,
          requiredBytes: diskReport.requiredBytes
        });
      }
      const downloadable = mediaRecords.filter((entry) => !['skipped_external', 'blocked', 'missing'].includes(entry.status));
      const oversized = downloadable.find((entry) => entry.status === 'known' && entry.bytes > config.disk.maxFileBytes);
      if (oversized) {
        blocked = true;
        errors.push({
          code: ERROR_CODES.MEDIA_FILE_TOO_LARGE,
          message: 'A planned media file exceeds the configured per-file byte cap.',
          details: { url: oversized.url, bytes: oversized.bytes, maxFileBytes: config.disk.maxFileBytes }
        });
        await context.warn(ERROR_CODES.MEDIA_FILE_TOO_LARGE, errors.at(-1).message, {
          url: oversized.url,
          bytes: oversized.bytes,
          maxFileBytes: config.disk.maxFileBytes
        });
      }
      if (downloadable.length > config.disk.maxFilesPerRun) {
        blocked = true;
        errors.push({
          code: ERROR_CODES.DISK_LIMIT_EXCEEDED,
          message: 'The plan exceeds the configured maximum number of files per run.',
          details: { mediaCount: downloadable.length, maxFilesPerRun: config.disk.maxFilesPerRun }
        });
        await context.warn(ERROR_CODES.DISK_LIMIT_EXCEEDED, errors.at(-1).message, {
          mediaCount: downloadable.length,
          maxFilesPerRun: config.disk.maxFilesPerRun
        });
      }
      const plannedRunBytes = knownBytes + (unknownCount * (config.disk.unknownSizePolicy === 'cap' ? config.disk.maxFileBytes : config.disk.unknownSizePolicy === 'estimate' ? config.disk.unknownSizeBytes : 0));
      if (config.disk.maxBytesPerRun > 0 && plannedRunBytes > config.disk.maxBytesPerRun) {
        blocked = true;
        errors.push({
          code: ERROR_CODES.DISK_LIMIT_EXCEEDED,
          message: 'The plan exceeds the configured maximum bytes per run.',
          details: { plannedRunBytes, maxBytesPerRun: config.disk.maxBytesPerRun }
        });
        await context.warn(ERROR_CODES.DISK_LIMIT_EXCEEDED, errors.at(-1).message, {
          plannedRunBytes,
          maxBytesPerRun: config.disk.maxBytesPerRun
        });
      }

      await context.phase('persist');
      const conflictKeys = conflictRecords.map((conflict) => conflict.sourceKey).sort();
      const mappingRevision = identityState.revision;
      const planConfig = {
        batchSize: config.planning.batchSize,
        includeRouteChanges: config.planning.includeRouteChanges,
        includePages: config.planning.includePages,
        includeReserved: config.planning.includeReserved,
        order: config.planning.order,
        feePerResource: config.planning.feePerResource,
        feeCurrency: config.planning.feeCurrency,
        estimateMedia: estimateMedia !== false,
        disk: config.disk,
        media: config.media
      };
      const planId = 'plan_' + base32(createHash('sha256').update(stableStringify({
        projectId: project.id,
        siteId: project.identity.siteId,
        batchId: latest.batchId,
        sourceContentRoot: latest.counts?.contentRoot ?? null,
        mappingRevision,
        config: planConfig,
        filters: filtersNormalized,
        selected: selected.map((entry) => entry.sourceKey),
        conflicts: conflictKeys
      }), 'utf8').digest(), 24);
      const planFile = planFileFor(this.paths, planId);
      const mediaSummary = {
        count: mediaList.length,
        knownCount: mediaRecords.filter((entry) => entry.status === 'known').length,
        knownBytes,
        unknownCount,
        missingCount,
        blockedCount,
        skippedExternal,
        externalCount: mediaRecords.filter((entry) => entry.external).length
      };
      const mediaResourceCount = mediaRecords.filter((entry) =>
        !['skipped_external', 'missing', 'blocked'].includes(entry.status)).length;
      const contentResourceCount = selected.length;
      const totalResources = contentResourceCount + mediaResourceCount;
      const feeEstimates = {
        contentResources: contentResourceCount,
        mediaResources: mediaResourceCount,
        totalResources,
        feePerResource: config.planning.feePerResource,
        estimatedFee: Math.round(totalResources * config.planning.feePerResource * 1e8) / 1e8,
        feeCurrency: config.planning.feeCurrency,
        note: 'Estimate only; Phase 5 must quote the current network fee before approval.'
      };
      const plan = {
        schema: PLAN_SCHEMA,
        version: 1,
        planId,
        projectId: project.id,
        siteId: project.identity.siteId,
        namespace: this.identity.state.namespace,
        target,
        status: blocked ? 'blocked' : 'ready',
        batchId: latest.batchId,
        runId: context.runId,
        source: {
          adapter: latest.adapterId,
          site: latest.site,
          contentRoot: latest.counts?.contentRoot ?? null,
          truncated: latest.truncated
        },
        filters: filtersNormalized,
        config: planConfig,
        selection: {
          batchSize: config.planning.batchSize,
          scanned: stats.scanned,
          selected: selected.length,
          indexTruncated: scanTruncated
        },
        stats,
        entries: [...selected, ...issueEntries],
        media: mediaRecords,
        mediaIssues,
        mediaSummary,
        pendingPublication: {
          count: pendingEntries.length,
          prepared: pendingEntries.filter((entry) => entry.localPreparation === 'prepared').length,
          reserved: pendingEntries.filter((entry) => entry.localPreparation !== 'prepared').length,
          entries: pendingEntries.slice(0, 5000),
          note: 'Reserved locally; never counted as published. Phase 5 publishes these after remote verification.'
        },
        estimates: feeEstimates,
        disk: diskReport,
        conflicts: conflictRecords,
        warnings,
        errors,
        createdAt: this.clock.nowIso()
      };

      if (persist) {
        await mkdir(planFile.directory, { recursive: true });
        await atomicWriteJson(planFile.file, plan);
        const record = {
          schema: PLAN_RECORD_SCHEMA,
          version: 1,
          planId,
          projectId: project.id,
          siteId: plan.siteId,
          status: plan.status,
          batchId: latest.batchId,
          runId: context.runId,
          file: path.relative(this.paths.root, planFile.file).split(path.sep).join('/'),
          batchSize: config.planning.batchSize,
          mappingRevision,
          stats,
          media: mediaSummary,
          pendingPublicationCount: pendingEntries.length,
          estimates: feeEstimates,
          disk: {
            fits: diskReport.fits,
            availableBytes: diskReport.availableBytes,
            projectedBytes: diskReport.projectedBytes,
            reserveBytes: diskReport.reserveBytes,
            reason: diskReport.reason
          },
          conflictCount: conflictRecords.length,
          selectedCount: selected.length,
          createdAt: plan.createdAt,
          completedAt: this.clock.nowIso()
        };
        const selectedForReservation = selected.map((entry) => ({
          sourceKey: entry.sourceKey,
          contentType: entry.contentType,
          sourceType: entry.contentType,
          contentHash: entry.contentHash,
          routeHash: entry.routeHash,
          slug: entry.slug,
          mimeType: entry.mimeType ?? null
        }));
        let reservationConflicts = [];
        await this.store.transaction((draft) => {
          draft.plans[planId] = record;
          for (const conflict of conflictRecords) {
            addConflictRecord(draft.identity, {
              planId,
              conflict: conflict.details,
              now: this.clock.nowIso()
            });
          }
          if (!blocked) {
            const result = reservePlanInState(draft.identity, {
              entries: selectedForReservation,
              planId,
              now: this.clock.nowIso()
            });
            reservationConflicts = result.conflicts;
          }
        });
        if (reservationConflicts.length > 0) {
          plan.reservationConflicts = reservationConflicts;
        }
      }

      const completion = await context.complete({
        status: plan.status,
        planId,
        planFile: path.relative(this.paths.root, planFile.file).split(path.sep).join('/'),
        batchId: latest.batchId,
        selectedCount: selected.length,
        stats,
        media: mediaSummary,
        estimates: feeEstimates,
        disk: {
          fits: diskReport.fits,
          availableBytes: diskReport.availableBytes,
          projectedBytes: diskReport.projectedBytes,
          reserveBytes: diskReport.reserveBytes
        },
        warnings: warnings.length,
        errors: errors.length
      });
      return {
        runId: context.runId,
        status: plan.status === 'blocked' ? 'blocked' : 'completed',
        planId,
        plan,
        planFile: planFile.file,
        record: persist ? this.store.state.plans[planId] : null,
        stats,
        media: mediaSummary,
        disk: diskReport,
        warnings,
        errors,
        events: completion.events
      };
    } catch (error) {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (error?.code === ERROR_CODES.OPERATION_CANCELLED || context.signal.aborted) {
        const cancellation = await context.cancel();
        return { runId: context.runId, status: 'cancelled', warnings, errors, events: cancellation?.events ?? [] };
      }
      const qms = error instanceof QmsError
        ? error
        : new QmsError(ERROR_CODES.PLAN_BLOCKED, error instanceof Error ? error.message : String(error), { cause: error });
      const failure = await context.fail(qms);
      return {
        runId: context.runId,
        status: 'failed',
        error: qms.toJSON(),
        warnings,
        errors,
        events: failure?.events ?? []
      };
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  async get(planId) {
    if (!PLAN_ID_PATTERN.test(String(planId))) {
      throw new QmsError(ERROR_CODES.PLAN_NOT_FOUND, 'Unknown plan: ' + String(planId), {
        details: { planId }
      });
    }
    const record = this.store.state.plans?.[planId];
    if (!record) {
      throw new QmsError(ERROR_CODES.PLAN_NOT_FOUND, 'Unknown plan: ' + String(planId), {
        details: { planId }
      });
    }
    return this.readPlanFile(record);
  }

  async readPlanFile(record) {
    const filePath = assertPathInside(this.paths.root, path.join(this.paths.root, record.file), 'plan file');
    let plan;
    try {
      plan = JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      throw new QmsError(ERROR_CODES.PLAN_STALE, 'Plan file is missing or unreadable.', {
        cause: error,
        details: { planId: record.planId, file: record.file }
      });
    }
    if (plan.schema !== PLAN_SCHEMA || plan.planId !== record.planId || plan.projectId !== this.getProject().id) {
      throw new QmsError(ERROR_CODES.PLAN_STALE, 'Plan file does not match its persisted record.', {
        details: { planId: record.planId, file: record.file }
      });
    }
    return { plan, record, planFile: filePath };
  }

  list({ limit = 100 } = {}) {
    return Object.values(this.store.state.plans ?? {})
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, limit);
  }
}

function mappingPublicationStatus(mapping) {
  return mapping?.publicationStatus ?? (mapping?.status === 'published' ? 'published' : 'reserved');
}

function mappingPreparationStatus(mapping) {
  return mapping?.localPreparation ?? 'reserved';
}

function entryId(entry) {
  return entry.id;
}
