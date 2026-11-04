import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { QmsError, ERROR_CODES, isQmsError } from './errors.js';
import { atomicWriteJson, readJsonIfExists, sha256Hex } from './storage/atomic.js';
import { assertPathInside } from './storage/paths.js';
import { assertSafeSegment } from './source-batch.js';
import { readIndexEntries, resolveLatestSourceBatch } from './source-index.js';
import {
  classifyCandidate,
  deriveQdnIdentity,
  preparationStatusFor,
  publicationStatusFor,
  routeProjectionFromIndex,
  tripleKey
} from './identity.js';

export const SYNC_STATE_SCHEMA = 'qms-sync-state@1';
export const SYNC_SCAN_SCHEMA = 'qms-sync-scan@1';
export const SYNC_REPORT_SCHEMA = 'qms-sync-report@1';
export const SYNC_CHECKPOINT_SCHEMA = 'qms-sync-checkpoint@1';
export const SYNC_CONFLICT_SCHEMA = 'qms-sync-conflict@1';
export const SYNC_WITHDRAWAL_SCHEMA = 'qms-withdrawal-record@1';
export const SYNC_TOMBSTONE_SCHEMA = 'qms-tombstone@1';
export const SYNC_CATALOG_SCHEMA = 'qms-sync-catalog@1';
export const SYNC_ADOPTION_SCHEMA = 'qms-sync-adoption-report@1';
export const SYNC_POLICY_SCHEMA = 'qms-sync-policy@1';

export const DEFAULT_OVERLAP_HOURS = 48;
export const DEFAULT_FULL_RECONCILE_DAYS = 7;
export const MAX_DELTA_ENTRIES = 2000;
export const SYNC_MODES = Object.freeze(['auto', 'incremental', 'full']);
export const WITHDRAWAL_POLICIES = Object.freeze(['hide', 'review', 'keep', 'tombstone']);
export const NON_PUBLIC_STATUSES = Object.freeze([
  'draft', 'pending', 'private', 'future', 'trash', 'auto-draft', 'inherit', 'unknown'
]);
const PUBLISHABLE_TYPES = Object.freeze(['post', 'page']);
const BLOCKING_CONFLICT_KINDS = Object.freeze([
  'SOURCE_CHANGED_SINCE_SCAN',
  'QDN_EXTERNAL_CHANGE',
  'LOCAL_DRAFT_DIFFERS',
  'WITHDRAWAL_CONFLICT'
]);

function newScanId() {
  return 'scn_' + randomBytes(12).toString('hex');
}

function conflictKey(kind, sourceKey, evidenceHash) {
  return 'scf_' + createHash('sha256')
    .update(kind + '|' + sourceKey + '|' + String(evidenceHash ?? ''), 'utf8')
    .digest('hex')
    .slice(0, 24);
}

function withdrawalKey(sourceKey) {
  return 'wdr_' + createHash('sha256').update(String(sourceKey), 'utf8').digest('hex').slice(0, 24);
}

function nowSafe(clock) {
  return clock.nowIso();
}

function toMillis(value) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function isoMinusHours(iso, hours) {
  const base = toMillis(iso);
  if (base === null) return null;
  return new Date(base - hours * 60 * 60 * 1000).toISOString();
}

function isNonPublicStatus(status) {
  return typeof status === 'string' && NON_PUBLIC_STATUSES.includes(status);
}

function compactEntry(entry, extra = {}) {
  return {
    sourceKey: entry.sourceKey,
    contentType: entry.contentType,
    title: entry.title ?? null,
    slug: entry.slug ?? null,
    contentHash: entry.contentHash,
    routeHash: entry.routeHash ?? null,
    sourceModifiedAt: entry.sourceModifiedAt ?? null,
    publishedAt: entry.publishedAt ?? null,
    publicationStatus: entry.publicationStatus ?? null,
    ...extra
  };
}

function pushCapped(list, value) {
  if (list.length < MAX_DELTA_ENTRIES) {
    list.push(value);
    return true;
  }
  return false;
}

function mapDeltaArrays(scan) {
  const delta = scan.delta ?? {};
  const arrays = {};
  for (const key of ['new', 'modified', 'unchanged', 'unpublished', 'withdrawn', 'conflicts', 'notScanned']) {
    arrays[key] = Array.isArray(delta[key]) ? delta[key] : [];
  }
  return arrays;
}

function emptyCounts() {
  return {
    scanned: 0,
    new: 0,
    modified: 0,
    unchanged: 0,
    unpublished: 0,
    withdrawn: 0,
    conflicts: 0,
    notScanned: 0,
    ignored: 0,
    unsupported: 0,
    failed: 0
  };
}

function emptyDelta() {
  return { new: [], modified: [], unchanged: [], unpublished: [], withdrawn: [], conflicts: [], notScanned: [] };
}

export function syncPaths(projectPaths) {
  const root = path.join(projectPaths.artifactsDir, 'sync');
  return {
    root,
    scanDir(scanId) {
      return path.join(root, assertSafeSegment(scanId, 'scan id'));
    },
    reportFile(scanId) {
      return path.join(this.scanDir(scanId), 'report.json');
    },
    checkpointFile(scanId) {
      return path.join(this.scanDir(scanId), 'checkpoint.json');
    },
    catalogFile(scanId) {
      return path.join(this.scanDir(scanId), 'catalog.json');
    },
    tombstonesDir(scanId) {
      return path.join(this.scanDir(scanId), 'tombstones');
    }
  };
}

function assertScanId(value) {
  return assertSafeSegment(value, 'sync scan id');
}

function linkAbort(context, signal) {
  if (!signal) return () => {};
  const abort = () => context.controller.abort('cancelled');
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
}

/**
 * Phase 7 incremental synchronization.
 *
 * The service never treats an incomplete discovery batch or a partial
 * classification pass as a successful "no changes" result. Every scan has an
 * explicit status and watermarks advance only after a complete scan.
 */
export class SyncService {
  constructor({ project, paths, store, clock, runs, events, identity, planning, publication = null, source = null }) {
    this.getProject = typeof project === 'function' ? project : () => project;
    this.paths = paths;
    this.store = store;
    this.clock = clock;
    this.runs = runs;
    this.events = events;
    this.identity = identity;
    this.planning = planning;
    this.publication = publication;
    this.source = source;
    this.syncPaths = syncPaths(paths);
  }

  get state() {
    return this.store.state.sync;
  }

  _config(overrides = {}) {
    const project = this.getProject();
    const settings = project.settings?.sync ?? {};
    return {
      overlapHours: Number.isFinite(overrides.overlapHours)
        ? Math.max(0, Math.min(720, overrides.overlapHours))
        : Number.isFinite(settings.overlapHours) ? Math.max(0, Math.min(720, settings.overlapHours)) : DEFAULT_OVERLAP_HOURS,
      fullReconcileDays: Number.isFinite(overrides.fullReconcileDays)
        ? Math.max(1, Math.min(365, overrides.fullReconcileDays))
        : Number.isFinite(settings.fullReconcileDays) ? Math.max(1, Math.min(365, settings.fullReconcileDays)) : DEFAULT_FULL_RECONCILE_DAYS,
      autoApplyWithdrawals: overrides.autoApplyWithdrawals !== undefined
        ? overrides.autoApplyWithdrawals === true
        : settings.autoApplyWithdrawals !== false,
      withdrawalPolicy: WITHDRAWAL_POLICIES.includes(overrides.withdrawalPolicy)
        ? overrides.withdrawalPolicy
        : WITHDRAWAL_POLICIES.includes(settings.withdrawalPolicy) ? settings.withdrawalPolicy : 'hide'
    };
  }

  async _ensureState() {
    if (this.state && this.state.schema === SYNC_STATE_SCHEMA) return this.state;
    await this.store.transaction((draft) => {
      if (!draft.sync || draft.sync.schema !== SYNC_STATE_SCHEMA) {
        draft.sync = {
          schema: SYNC_STATE_SCHEMA,
          revision: 1,
          watermarks: {},
          scans: {},
          items: {},
          conflicts: {},
          withdrawals: {},
          adoptions: [],
          counters: { scan: 0, conflict: 0, withdrawal: 0 }
        };
      }
    });
    return this.state;
  }

  _scan(id) {
    const scanId = assertScanId(id);
    const scan = this.state?.scans?.[scanId];
    if (!scan) {
      throw new QmsError(ERROR_CODES.SYNC_SCAN_NOT_FOUND, 'Unknown synchronization scan: ' + scanId, {
        details: { scanId }
      });
    }
    return scan;
  }

  /** Mark scans left running by a crash as interrupted, never successful. */
  async recover() {
    await this._ensureState();
    const candidates = Object.values(this.state.scans ?? {})
      .filter((scan) => ['running', 'scanning', 'classifying'].includes(scan.status));
    if (candidates.length === 0) {
      return { interrupted: 0 };
    }
    const now = nowSafe(this.clock);
    let interrupted = 0;
    await this.store.transaction((draft) => {
      for (const scan of Object.values(draft.sync.scans)) {
        if (['running', 'scanning', 'classifying'].includes(scan.status)) {
          scan.status = 'interrupted';
          scan.updatedAt = now;
          scan.failure = scan.failure ?? {
            code: 'SYNC_SCAN_INTERRUPTED',
            message: 'The previous scan did not finish. Its evidence is preserved but it is not a successful sync.',
            details: { previousStatus: scan.status }
          };
          scan.planningAllowed = false;
          scan.recoverable = Boolean(scan.batchId);
          interrupted += 1;
        }
      }
    });
    return { interrupted };
  }

  async status() {
    await this._ensureState();
    await this.recover();
    const mappings = Object.values(this.store.state.identity?.mappings ?? {});
    const scans = Object.values(this.state.scans).sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)));
    const conflicts = Object.values(this.state.conflicts);
    const adoptionRequired = mappings.length > 0 && this.state.adoptions.length === 0 && Object.keys(this.state.watermarks).length === 0;
    return {
      schema: SYNC_STATE_SCHEMA,
      revision: this.state.revision,
      adapterId: this.getProject().source?.adapter ?? null,
      watermarks: { ...this.state.watermarks },
      latestScan: scans[0] ? this.summarizeScan(scans[0]) : null,
      counts: {
        mappings: mappings.length,
        active: mappings.filter((mapping) => mapping.status !== 'withdrawn').length,
        withdrawn: mappings.filter((mapping) => mapping.status === 'withdrawn').length,
        conflicts: conflicts.filter((conflict) => conflict.status !== 'resolved').length,
        identityConflicts: Object.values(this.store.state.identity?.conflicts ?? {}).filter((conflict) => !conflict.resolvedAt).length,
        withdrawals: Object.keys(this.state.withdrawals).length
      },
      adoptionRequired,
      adoptionCount: this.state.adoptions.length,
      scans: scans.slice(0, 20).map((scan) => this.summarizeScan(scan)),
      hasCompletedFullScan: Object.values(this.state.watermarks).some((mark) => Boolean(mark.fullCompletedAt)),
      preferences: this._config()
    };
  }

  summarizeScan(scan) {
    const delta = mapDeltaArrays(scan);
    return {
      schema: SYNC_SCAN_SCHEMA,
      scanId: scan.id,
      runId: scan.runId,
      adapterId: scan.adapterId,
      mode: scan.mode,
      status: scan.status,
      complete: scan.complete === true,
      planningAllowed: scan.planningAllowed === true,
      recoverable: scan.recoverable === true,
      truncated: scan.truncated === true,
      startedAt: scan.startedAt,
      completedAt: scan.completedAt ?? null,
      updatedAt: scan.updatedAt ?? null,
      batchId: scan.batchId ?? null,
      counts: scan.counts ?? emptyCounts(),
      deltaCounts: Object.fromEntries(Object.entries(delta).map(([key, value]) => [key, value.length])),
      delta: {
        new: delta.new,
        modified: delta.modified,
        withdrawn: delta.withdrawn,
        conflicts: delta.conflicts,
        unpublished: delta.unpublished
      },
      failure: scan.failure ?? null,
      warnings: scan.warnings ?? [],
      reportPath: scan.reportPath ?? null,
      catalogPath: scan.catalogPath ?? null,
      planId: scan.planId ?? null,
      query: scan.query ?? {},
      withdrawals: scan.withdrawals ?? null,
      checkpoint: scan.checkpoint ?? null
    };
  }

  async history({ limit = 50 } = {}) {
    await this._ensureState();
    return Object.values(this.state.scans)
      .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)))
      .slice(0, Math.max(1, Math.min(500, limit)))
      .map((scan) => this.summarizeScan(scan));
  }

  async get(scanId) {
    await this._ensureState();
    return this.summarizeScan(this._scan(scanId));
  }

  _resolveMode(requested, adapterId, config) {
    const mode = SYNC_MODES.includes(requested) ? requested : 'auto';
    if (mode !== 'auto') return mode;
    const mark = this.state.watermarks[adapterId];
    if (!mark?.lastCompletedAt) return 'full';
    const fullAt = toMillis(mark.fullCompletedAt);
    if (fullAt === null) return 'full';
    const nowMs = toMillis(this.clock.nowIso());
    const ageDays = nowMs === null ? Infinity : (nowMs - fullAt) / (24 * 60 * 60 * 1000);
    return ageDays >= config.fullReconcileDays ? 'full' : 'incremental';
  }

  async _writeCheckpoint(scan, checkpoint) {
    const file = this.syncPaths.checkpointFile(scan.id);
    await mkdir(path.dirname(file), { recursive: true });
    await atomicWriteJson(file, {
      schema: SYNC_CHECKPOINT_SCHEMA,
      version: 1,
      scanId: scan.id,
      ...checkpoint,
      updatedAt: nowSafe(this.clock)
    });
    return file;
  }

  async _readCheckpoint(scanId) {
    const file = this.syncPaths.checkpointFile(assertScanId(scanId));
    const checkpoint = await readJsonIfExists(file);
    if (!checkpoint || checkpoint.schema !== SYNC_CHECKPOINT_SCHEMA) return null;
    return checkpoint;
  }

  /**
   * Run a source scan and classify it against persisted identity mappings.
   * Returns an explicit failed/incomplete status instead of an empty delta.
   */
  async check({
    mode = 'auto',
    auth = null,
    source = {},
    query = {},
    contentTypes = null,
    perPage = 100,
    maxItems = null,
    overlapHours = undefined,
    fullReconcileDays = undefined,
    autoApplyWithdrawals = undefined,
    withdrawalPolicy = undefined,
    classifyBatchSize = null,
    signal = null
  } = {}) {
    await this._ensureState();
    await this.recover();
    const project = this.getProject();
    const adapterId = project.source?.adapter ?? 'wordpress';
    if (!this.source) {
      throw new QmsError(ERROR_CODES.SYNC_SCAN_FAILED, 'No source adapter registry is available for synchronization.');
    }
    const config = this._config({ overlapHours, fullReconcileDays, autoApplyWithdrawals, withdrawalPolicy });
    const resolvedMode = this._resolveMode(mode, adapterId, config);
    const scanId = newScanId();
    const startedAt = nowSafe(this.clock);
    const watermarkBefore = this.state.watermarks[adapterId] ?? null;
    const queryIn = { ...(query ?? {}) };
    if (resolvedMode === 'incremental') {
      const modifiedAfter = isoMinusHours(startedAt, config.overlapHours);
      if (modifiedAfter) queryIn.modified_after = modifiedAfter;
    }
    const context = await this.runs.start({
      kind: 'sync.check',
      phase: 'scan',
      meta: {
        scanId,
        mode: resolvedMode,
        adapterId,
        overlapHours: config.overlapHours,
        query: queryIn
      }
    });
    const unlink = linkAbort(context, signal);
    await this.store.transaction((draft) => {
      draft.sync.counters.scan = (draft.sync.counters.scan ?? 0) + 1;
      draft.sync.scans[scanId] = {
        schema: SYNC_SCAN_SCHEMA,
        version: 1,
        id: scanId,
        runId: context.runId,
        adapterId,
        mode: resolvedMode,
        status: 'scanning',
        complete: false,
        planningAllowed: false,
        recoverable: false,
        truncated: false,
        startedAt,
        updatedAt: startedAt,
        completedAt: null,
        watermarkBefore,
        query: queryIn,
        batchId: null,
        batchDir: null,
        classifyBatchSize: Number.isInteger(classifyBatchSize) && classifyBatchSize > 0 ? classifyBatchSize : null,
        counts: emptyCounts(),
        delta: emptyDelta(),
        conflicts: [],
        failure: null,
        warnings: []
      };
      draft.sync.revision += 1;
    });
    const scan = this._scan(scanId);
    await this._writeCheckpoint(scan, { phase: 'scanning', processed: 0 });

    try {
      await context.phase('scan');
      const discovery = await this.source.discover({
        adapterId,
        auth,
        source,
        query: queryIn,
        contentTypes: contentTypes ?? null,
        perPage,
        maxItems,
        signal: context.signal
      });
      if (discovery.status !== 'completed') {
        const code = discovery.status === 'cancelled' ? 'SYNC_SCAN_CANCELLED' : 'SYNC_SCAN_FAILED';
        const message = discovery.status === 'cancelled'
          ? 'The source scan was cancelled. No changes were classified.'
          : 'The source scan failed. This is not a successful sync and cannot be reported as no changes.';
        await this._finishScanFailure(scanId, {
          status: discovery.status === 'cancelled' ? 'cancelled' : 'failed',
          code,
          message,
          error: discovery.error ?? null
        });
        if (discovery.status === 'cancelled') await context.cancel(message);
        else await context.fail(new QmsError(ERROR_CODES.SYNC_SCAN_FAILED, message, { details: discovery.error ?? {} }));
        return {
          runId: context.runId,
          scanId,
          status: discovery.status === 'cancelled' ? 'cancelled' : 'failed',
          complete: false,
          planningAllowed: false,
          noChanges: false,
          counts: null,
          error: { code, message, details: discovery.error ?? {} },
          message
        };
      }
      const summary = discovery.summary ?? {};
      const report = discovery.report ?? {};
      const truncated = summary.truncated === true || report.truncated === true;
      await this.store.transaction((draft) => {
        const current = draft.sync.scans[scanId];
        current.status = 'classifying';
        current.batchId = discovery.batchId;
        current.batchDir = path.relative(this.paths.root, discovery.paths.batchDir);
        current.truncated = truncated;
        current.updatedAt = nowSafe(this.clock);
        current.warnings = (report.warnings ?? []).map((warning) => ({
          code: warning.code ?? 'SOURCE_WARNING',
          message: warning.message ?? 'Source warning',
          details: warning.details ?? {}
        }));
      });
      await this._writeCheckpoint(this._scan(scanId), { phase: 'classifying', processed: 0 });
      const result = await this._classify({
        scanId,
        context,
        config,
        classifyBatchSize: scan.classifyBatchSize,
        scanComplete: !truncated
      });
      if (result.status === 'interrupted') {
        await context.complete({ scanId, status: 'interrupted', ...result.counts });
        return { runId: context.runId, ...result, noChanges: false };
      }
      if (result.status !== 'completed' && result.status !== 'incomplete') {
        await context.fail(new QmsError(ERROR_CODES.SYNC_SCAN_FAILED, 'Synchronization classification did not complete.', {
          details: { status: result.status }
        }));
        return { runId: context.runId, ...result, noChanges: false };
      }
      const completed = await context.complete({
        scanId,
        status: result.status,
        counts: result.counts,
        batchId: discovery.batchId
      });
      return { runId: context.runId, events: completed.events, ...result, noChanges: false };
    } catch (error) {
      const cancelled = context.signal.aborted;
      const mapped = isQmsError(error) ? error : new QmsError(ERROR_CODES.SYNC_SCAN_FAILED, error?.message ?? 'Scan failed.', {
        cause: error
      });
      await this._finishScanFailure(scanId, {
        status: cancelled ? 'cancelled' : 'failed',
        code: mapped.code,
        message: mapped.message,
        error: mapped.toJSON()
      });
      if (cancelled) {
        await context.cancel(mapped.message);
        return {
          runId: context.runId,
          scanId,
          status: 'cancelled',
          complete: false,
          planningAllowed: false,
          noChanges: false,
          counts: null,
          error: mapped.toJSON(),
          message: mapped.message
        };
      }
      await context.fail(mapped);
      return {
        runId: context.runId,
        scanId,
        status: 'failed',
        complete: false,
        planningAllowed: false,
        noChanges: false,
        counts: null,
        error: mapped.toJSON(),
        message: mapped.message
      };
    } finally {
      unlink();
    }
  }

  async _finishScanFailure(scanId, { status, code, message, error }) {
    const now = nowSafe(this.clock);
    await this.store.transaction((draft) => {
      const scan = draft.sync.scans[scanId];
      if (!scan) return;
      scan.status = status;
      scan.complete = false;
      scan.planningAllowed = false;
      scan.completedAt = now;
      scan.updatedAt = now;
      scan.counts = { ...emptyCounts(), failed: 1 };
      scan.failure = { code, message, details: error ?? {} };
      draft.sync.revision += 1;
    });
    try {
      await this._writeCheckpoint(this._scan(scanId), { phase: 'failed', processed: 0, code, message });
    } catch {
      // A failed scan must remain failed even if the checkpoint cannot be written.
    }
  }

  async _classify({ scanId, context, config, classifyBatchSize = null, scanComplete = true }) {
    const scan = this._scan(scanId);
    const project = this.getProject();
    const adapterId = scan.adapterId;
    const latest = await resolveLatestSourceBatch(this.paths, adapterId);
    if (latest.batchId !== scan.batchId) {
      throw new QmsError(ERROR_CODES.SYNC_SCAN_STALE, 'The source batch changed after the scan started.', {
        details: { scanBatchId: scan.batchId, latestBatchId: latest.batchId }
      });
    }
    const { entries, truncated: indexScanTruncated } = await readIndexEntries(latest.indexJsonl, { maxEntries: 250_000 });
    if (indexScanTruncated) {
      throw new QmsError(ERROR_CODES.SYNC_SCAN_INCOMPLETE, 'The source index is too large to classify safely in one pass.', {
        details: { scanId }
      });
    }
    const checkpoint = await this._readCheckpoint(scanId);
    const resuming = checkpoint && checkpoint.phase === 'classifying' && Number.isInteger(checkpoint.processed);
    let processed = resuming ? Math.min(checkpoint.processed, entries.length) : 0;
    const counts = resuming && checkpoint.counts ? { ...emptyCounts(), ...checkpoint.counts } : emptyCounts();
    const delta = resuming && checkpoint.delta ? { ...emptyDelta(), ...checkpoint.delta } : emptyDelta();
    const evidence = resuming && Array.isArray(checkpoint.evidence) ? checkpoint.evidence : [];
    const conflictSeeds = resuming && Array.isArray(checkpoint.conflictSeeds) ? checkpoint.conflictSeeds : [];
    const identityState = this.store.state.identity;
    if (!identityState) {
      throw new QmsError(ERROR_CODES.IDENTITY_MISMATCH, 'Identity state is not initialized.');
    }
    const target = this.identity.requireTarget();
    const seen = new Set(evidence.map((entry) => entry.sourceKey));
    const batchLimit = Number.isInteger(classifyBatchSize) && classifyBatchSize > 0 ? classifyBatchSize : null;
    let processedThisPass = 0;
    let deltaTruncated = false;

    for (let index = processed; index < entries.length; index += 1) {
      context.throwIfCancelled();
      const entry = entries[index];
      processedThisPass += 1;
      if (batchLimit && processedThisPass > batchLimit) {
        break;
      }
      processed = index + 1;
      if (!PUBLISHABLE_TYPES.includes(entry.contentType)) {
        counts.ignored += 1;
        if (entry.contentType && !['category', 'tag', 'media'].includes(entry.contentType)) counts.unsupported += 1;
        continue;
      }
      counts.scanned += 1;
      seen.add(entry.sourceKey);
      const compact = compactEntry(entry);
      evidence.push(compact);
      const mapping = identityState.mappings[entry.sourceKey] ?? null;
      if (usesNonPublicStatus(entry) && mapping) {
        const record = {
          ...compact,
          classification: 'unpublished',
          reason: 'SOURCE_STATUS_' + String(entry.publicationStatus).toUpperCase(),
          mapping: mappingSnapshot(mapping)
        };
        counts.unpublished += 1;
        counts.withdrawn += 1;
        if (!pushCapped(delta.unpublished, record)) deltaTruncated = true;
        if (!pushCapped(delta.withdrawn, {
          ...record,
          classification: 'withdrawn',
          reason: 'SOURCE_STATUS_' + String(entry.publicationStatus).toUpperCase()
        })) deltaTruncated = true;
        conflictSeeds.push({
          kind: 'WITHDRAWAL_CONFLICT',
          sourceKey: entry.sourceKey,
          evidence: {
            source: record,
            local: { mapping: mappingSnapshot(mapping) },
            qdn: publicationEvidence(mapping)
          }
        });
        continue;
      }
      const classification = classifyCandidate({
        entry,
        mapping,
        identity: identityState,
        target
      });
      if (classification.status === 'new') {
        counts.new += 1;
        if (!pushCapped(delta.new, {
          ...compact,
          classification: 'new',
          qdn: classification.triple
        })) deltaTruncated = true;
        continue;
      }
      if (classification.status === 'modified' || classification.status === 'route_changed') {
        counts.modified += 1;
        if (!pushCapped(delta.modified, {
          ...compact,
          classification: classification.status,
          reason: classification.contentChanged ? 'SOURCE_CONTENT_CHANGED' : 'SOURCE_ROUTE_CHANGED',
          previousHash: mapping?.contentHash ?? null,
          previousRouteHash: mapping?.routeHash ?? null,
          qdn: classification.triple
        })) deltaTruncated = true;
        continue;
      }
      if (classification.status === 'unchanged') {
        counts.unchanged += 1;
        if (!pushCapped(delta.unchanged, {
          ...compact,
          classification: 'unchanged',
          qdn: classification.triple
        })) deltaTruncated = true;
        continue;
      }
      if (classification.status === 'reserved') {
        counts.unpublished += 1;
        if (!pushCapped(delta.unpublished, {
          ...compact,
          classification: 'unpublished',
          reason: 'LOCAL_NOT_PUBLISHED',
          publicationStatus: classification.publicationStatus ?? publicationStatusFor(mapping),
          localPreparation: classification.localPreparation ?? preparationStatusFor(mapping),
          qdn: classification.triple
        })) deltaTruncated = true;
        continue;
      }
      if (classification.status === 'conflict') {
        counts.conflicts += 1;
        const conflict = {
          ...compact,
          classification: 'conflict',
          kind: classification.conflict.kind,
          message: classification.conflict.message,
          details: classification.conflict
        };
        if (!pushCapped(delta.conflicts, conflict)) deltaTruncated = true;
        conflictSeeds.push({
          kind: classification.conflict.kind,
          sourceKey: entry.sourceKey,
          evidence: {
            source: compact,
            local: { mapping: mappingSnapshot(mapping ?? null) },
            qdn: publicationEvidence(mapping ?? null)
          },
          identityConflict: classification.conflict
        });
        continue;
      }
    }

    // Absence is evidence only after a complete full scan AND a complete
    // classification pass. A checkpointed partial pass must never infer
    // deletions or advance withdrawal state.
    if (!batchLimit || processed >= entries.length) {
    for (const mapping of Object.values(identityState.mappings ?? {})) {
      if (seen.has(mapping.sourceKey)) continue;
      if (!PUBLISHABLE_TYPES.includes(mapping.contentType)) continue;
      if (mapping.status === 'withdrawn') {
        counts.withdrawn += 1;
        continue;
      }
      if (scan.mode === 'full' && scanComplete) {
        const record = {
          sourceKey: mapping.sourceKey,
          contentType: mapping.contentType,
          title: null,
          slug: mapping.slug ?? null,
          contentHash: mapping.contentHash,
          classification: 'withdrawn',
          reason: 'MISSING_FROM_COMPLETE_SOURCE_SCAN',
          mapping: mappingSnapshot(mapping),
          qdn: publicationEvidence(mapping)
        };
        counts.withdrawn += 1;
        if (!pushCapped(delta.withdrawn, record)) deltaTruncated = true;
        conflictSeeds.push({
          kind: 'WITHDRAWAL_CONFLICT',
          sourceKey: mapping.sourceKey,
          evidence: {
            source: { sourceKey: mapping.sourceKey, present: false, status: null },
            local: { mapping: mappingSnapshot(mapping) },
            qdn: publicationEvidence(mapping)
          }
        });
      } else {
        const item = this.state.items?.[mapping.sourceKey] ?? null;
        const previouslyVerified = Boolean(item?.lastSeenAt) || Boolean(mapping.publishedAt) || Boolean(mapping.remoteVerifiedAt);
        if (scan.mode === 'incremental' && previouslyVerified) {
          // The source query is filtered by modified_after, so an item absent
          // from a successful incremental scan was not modified since the
          // watermark. Deletions are only inferred by full reconciliation.
          counts.unchanged += 1;
          if (!pushCapped(delta.unchanged, {
            sourceKey: mapping.sourceKey,
            contentType: mapping.contentType,
            classification: 'unchanged',
            reason: 'NOT_MODIFIED_SINCE_WATERMARK',
            contentHash: mapping.contentHash
          })) deltaTruncated = true;
        } else {
          counts.notScanned += 1;
          if (!pushCapped(delta.notScanned, {
            sourceKey: mapping.sourceKey,
            contentType: mapping.contentType,
            classification: 'not_scanned',
            reason: scan.mode === 'incremental' ? 'NOT_RETURNED_BY_INCREMENTAL_SCAN' : 'SCAN_INCOMPLETE',
            contentHash: mapping.contentHash
          })) deltaTruncated = true;
        }
      }
    }
    }

    const status = !scanComplete ? 'incomplete' : 'completed';
    const now = nowSafe(this.clock);
    const checkpointPayload = {
      phase: 'classifying',
      processed,
      entriesTotal: entries.length,
      counts,
      delta,
      evidence,
      conflictSeeds,
      truncatedDelta: deltaTruncated,
      scanComplete
    };
    const checkpointFile = await this._writeCheckpoint(scan, checkpointPayload);
    if (batchLimit && processed < entries.length) {
      await this.store.transaction((draft) => {
        const current = draft.sync.scans[scanId];
        current.status = 'interrupted';
        current.updatedAt = now;
        current.complete = false;
        current.planningAllowed = false;
        current.recoverable = true;
        current.counts = counts;
        current.delta = delta;
        current.checkpoint = {
          phase: 'classifying',
          processed,
          entriesTotal: entries.length,
          file: path.relative(this.paths.root, checkpointFile),
          updatedAt: now
        };
        current.conflicts = conflictSeeds.map((seed) => this._conflictIdForSeed(seed, scanId));
        draft.sync.revision += 1;
      });
      return {
        scanId,
        status: 'interrupted',
        complete: false,
        recoverable: true,
        planningAllowed: false,
        counts,
        message: 'Classification paused at a crash-safe checkpoint. Resume to continue; this is not a completed sync.'
      };
    }

    // Persist per-item evidence and scan classification before applying
    // withdrawals or advancing a watermark.
    const conflictIds = [];
    await this.store.transaction((draft) => {
      const current = draft.sync.scans[scanId];
      current.status = status;
      current.complete = scanComplete;
      current.planningAllowed = scanComplete;
      current.completedAt = now;
      current.updatedAt = now;
      current.counts = counts;
      current.delta = delta;
      current.warnings = [
        ...(current.warnings ?? []),
        ...(scanComplete ? [] : [{
          code: 'SYNC_SCAN_INCOMPLETE',
          message: 'The source scan was truncated or partial; deletions and watermarks were not inferred.',
          details: { batchId: scan.batchId }
        }]),
        ...(deltaTruncated ? [{
          code: 'SYNC_DELTA_TRUNCATED',
          message: 'Only the first ' + MAX_DELTA_ENTRIES + ' entries per class are kept in state; the full report stays on disk.',
          details: {}
        }] : [])
      ];
      current.checkpoint = {
        phase: 'classified',
        processed,
        entriesTotal: entries.length,
        file: path.relative(this.paths.root, checkpointFile),
        updatedAt: now
      };
      for (const entry of evidence) {
        draft.sync.items[entry.sourceKey] = {
          schema: 'qms-sync-item@1',
          sourceKey: entry.sourceKey,
          contentType: entry.contentType,
          contentHash: entry.contentHash,
          sourceModifiedAt: entry.sourceModifiedAt ?? null,
          publicationStatus: entry.publicationStatus ?? null,
          lastSeenAt: now,
          lastScanId: scanId,
          lastMode: scan.mode,
          lastFullScanId: scan.mode === 'full' && scanComplete ? scanId : (draft.sync.items[entry.sourceKey]?.lastFullScanId ?? null)
        };
      }
      draft.sync.revision += 1;
    });

    // Conflicts are persisted with source/local/QDN evidence. Repeated scans
    // reuse the deterministic id instead of producing duplicates.
    for (const seed of conflictSeeds) {
      const conflict = await this._upsertConflict({ seed, scanId, now });
      if (conflict) conflictIds.push(conflict.id);
    }

    let withdrawals = { applied: [], appliedCount: 0, pending: delta.withdrawn.length, networkDeleted: false, qdnDataPreserved: true };
    if (scanComplete && config.autoApplyWithdrawals && delta.withdrawn.length > 0) {
      if (config.withdrawalPolicy === 'hide' || config.withdrawalPolicy === 'tombstone') {
        withdrawals = await this._applyWithdrawals({
          scanId,
          sourceKeys: delta.withdrawn.map((entry) => entry.sourceKey),
          policy: config.withdrawalPolicy,
          automatic: true,
          note: 'Default local withdrawal policy applied after a complete scan.'
        });
      } else {
        withdrawals = { applied: [], appliedCount: 0, pending: delta.withdrawn.length, networkDeleted: false, qdnDataPreserved: true, policy: config.withdrawalPolicy };
      }
    }

    // Only a complete scan advances the watermark. Incomplete scans keep the
    // previous watermark so the next run re-covers the same overlap window.
    if (scanComplete) {
      await this.store.transaction((draft) => {
        const previous = draft.sync.watermarks[adapterId] ?? {};
        draft.sync.watermarks[adapterId] = {
          schema: 'qms-sync-watermark@1',
          adapterId,
          scanId,
          mode: scan.mode,
          batchId: scan.batchId,
          sourceModifiedThrough: scan.startedAt,
          overlapHours: config.overlapHours,
          lastCompletedAt: now,
          fullCompletedAt: scan.mode === 'full'
            ? now
            : (previous.fullCompletedAt ?? null),
          itemCount: counts.scanned,
          contentRoot: latest.counts?.contentRoot ?? null,
          query: scan.query ?? {},
          updatedAt: now
        };
        draft.sync.revision += 1;
      });
    }

    let reportPath = null;
    try {
      const reportFile = this.syncPaths.reportFile(scanId);
      await mkdir(path.dirname(reportFile), { recursive: true });
      await atomicWriteJson(reportFile, {
        schema: SYNC_REPORT_SCHEMA,
        version: 1,
        scanId,
        projectId: this.getProject().id,
        siteId: identityState.siteId,
        adapterId,
        mode: scan.mode,
        status,
        complete: scanComplete,
        startedAt: scan.startedAt,
        completedAt: now,
        batchId: scan.batchId,
        batchDir: scan.batchDir,
        watermarkBefore: scan.watermarkBefore,
        counts,
        delta,
        evidence,
        conflicts: conflictIds,
        withdrawals,
        warnings: scan.warnings ?? [],
        truncatedDelta: deltaTruncated,
        networkDeleted: false
      });
      reportPath = path.relative(this.paths.root, reportFile);
      await this.store.transaction((draft) => {
        draft.sync.scans[scanId].reportPath = reportPath;
        draft.sync.scans[scanId].conflicts = conflictIds;
        draft.sync.scans[scanId].withdrawals = withdrawals;
        draft.sync.revision += 1;
      });
    } catch (error) {
      await this.store.transaction((draft) => {
        const current = draft.sync.scans[scanId];
        current.warnings = [...(current.warnings ?? []), {
          code: 'SYNC_REPORT_WRITE_FAILED',
          message: 'The scan completed but its full report could not be written.',
          details: { cause: error.message }
        }];
        draft.sync.revision += 1;
      });
    }

    let catalogPath = null;
    if (scanComplete) {
      try {
        const catalog = await this.writeCatalog({ scanId });
        catalogPath = catalog.relativePath;
      } catch (error) {
        await this.store.transaction((draft) => {
          draft.sync.scans[scanId].warnings = [...(draft.sync.scans[scanId].warnings ?? []), {
            code: 'SYNC_CATALOG_WRITE_FAILED',
            message: 'The visible catalog was not rewritten.',
            details: { cause: error.message }
          }];
          draft.sync.revision += 1;
        });
      }
    }

    return {
      scanId,
      status,
      complete: scanComplete,
      planningAllowed: scanComplete,
      recoverable: false,
      counts,
      delta,
      withdrawals,
      conflicts: conflictIds,
      reportPath,
      catalogPath,
      query: scan.query ?? {},
      warnings: this.store.state.sync.scans[scanId]?.warnings ?? [],
      message: scanComplete
        ? 'Scan completed. Review the delta before preparing a publication plan.'
        : 'Scan incomplete. Deletions and watermarks were not inferred and no publication plan may be prepared from it.',
      networkDeleted: false
    };
  }

  _conflictIdForSeed(seed, scanId) {
    const evidenceHash = createHash('sha256')
      .update(JSON.stringify({ evidence: seed.evidence, scanId: null }), 'utf8')
      .digest('hex');
    return conflictKey(seed.kind, seed.sourceKey, evidenceHash);
  }

  async _upsertConflict({ seed, scanId, now }) {
    const identity = this.store.state.identity;
    if (seed.identityConflict) {
      // Identity conflicts keep their existing durable representation in the
      // identity state. Mirror the evidence in sync state for the GUI without
      // changing the identity collision semantics.
    }
    const id = this._conflictIdForSeed(seed, scanId);
    let record = null;
    await this.store.transaction((draft) => {
      if (!draft.sync.conflicts[id]) {
        draft.sync.counters.conflict = (draft.sync.counters.conflict ?? 0) + 1;
        draft.sync.conflicts[id] = {
          schema: SYNC_CONFLICT_SCHEMA,
          version: 1,
          id,
          kind: seed.kind,
          sourceKey: seed.sourceKey,
          scanId,
          status: 'open',
          severity: 'blocking',
          createdAt: now,
          resolvedAt: null,
          resolution: null,
          resolutionNote: null,
          automatic: false,
          evidence: seed.evidence,
          history: [{
            at: now,
            action: 'detected',
            scanId,
            note: 'Conflict detected by synchronization scan.'
          }]
        };
        draft.sync.revision += 1;
      } else {
        const existing = draft.sync.conflicts[id];
        if (!existing.history.some((entry) => entry.action === 'rediscovered' && entry.scanId === scanId)) {
          existing.history.push({ at: now, action: 'rediscovered', scanId });
          existing.scanId = scanId;
          draft.sync.revision += 1;
        }
      }
      record = draft.sync.conflicts[id];
    });
    return record;
  }

  async _applyWithdrawals({ scanId, sourceKeys = null, policy = 'hide', automatic = false, note = null }) {
    const scan = this._scan(scanId);
    if (scan.status !== 'completed' || scan.complete !== true) {
      throw new QmsError(ERROR_CODES.SYNC_SCAN_INCOMPLETE, 'Withdrawals may be applied only from a complete source scan.', {
        details: { scanId, status: scan.status, complete: scan.complete }
      });
    }
    const candidates = mapDeltaArrays(scan).withdrawn;
    const allowed = sourceKeys ? new Set(sourceKeys) : null;
    const pending = allowed
      ? candidates.filter((entry) => allowed.has(entry.sourceKey))
      : candidates;
    if (allowed) {
      const missing = [...allowed].filter((key) => !candidates.some((entry) => entry.sourceKey === key));
      if (missing.length > 0) {
        throw new QmsError(ERROR_CODES.SYNC_WITHDRAWAL_NOT_FOUND, 'No pending withdrawal was detected for the requested source keys.', {
          details: { scanId, missing }
        });
      }
    }
    const now = nowSafe(this.clock);
    const applied = [];
    await this.store.transaction((draft) => {
      for (const entry of pending) {
        const mapping = draft.identity.mappings[entry.sourceKey];
        if (!mapping || mapping.status === 'withdrawn') continue;
        const withdrawalId = withdrawalKey(entry.sourceKey);
        const snapshot = mappingSnapshot(mapping);
        mapping.status = 'withdrawn';
        mapping.withdrawnAt = now;
        mapping.withdrawalId = withdrawalId;
        mapping.updatedAt = now;
        draft.sync.counters.withdrawal = (draft.sync.counters.withdrawal ?? 0) + 1;
        draft.sync.withdrawals[withdrawalId] = {
          schema: SYNC_WITHDRAWAL_SCHEMA,
          version: 1,
          id: withdrawalId,
          sourceKey: entry.sourceKey,
          scanId,
          reason: entry.reason ?? 'SOURCE_WITHDRAWN',
          detectedAt: now,
          policy,
          automatic,
          note,
          mapping: snapshot,
          qdn: publicationEvidence(mapping),
          networkDeleted: false,
          qdnDataPreserved: true,
          history: [{
            at: now,
            action: 'withdraw_local',
            policy,
            automatic,
            note,
            networkDeleted: false
          }],
          tombstone: null
        };
        let existingConflict = Object.values(draft.sync.conflicts).find((conflict) =>
          conflict.kind === 'WITHDRAWAL_CONFLICT' &&
          conflict.sourceKey === entry.sourceKey &&
          conflict.scanId === scanId
        );
        const conflictId = existingConflict?.id
          ?? conflictKey('WITHDRAWAL_CONFLICT', entry.sourceKey, entry.contentHash ?? '');
        if (!existingConflict) {
          draft.sync.conflicts[conflictId] = {
            schema: SYNC_CONFLICT_SCHEMA,
            version: 1,
            id: conflictId,
            kind: 'WITHDRAWAL_CONFLICT',
            sourceKey: entry.sourceKey,
            scanId,
            status: automatic ? 'resolved' : 'open',
            severity: 'blocking',
            createdAt: now,
            resolvedAt: automatic ? now : null,
            resolution: automatic ? 'withdraw_local' : null,
            resolutionNote: note,
            automatic,
            evidence: {
              source: { sourceKey: entry.sourceKey, present: false, reason: entry.reason ?? null },
              local: { mapping: snapshot },
              qdn: publicationEvidence(mapping)
            },
            history: [{
              at: now,
              action: automatic ? 'auto_withdraw_local' : 'detected',
              note: automatic
                ? 'Default local withdrawal applied. Published QDN data was not deleted or modified.'
                : 'Withdrawal detected; operator decision required.'
            }]
          };
          existingConflict = draft.sync.conflicts[conflictId];
        } else if (existingConflict.status !== 'resolved') {
          existingConflict.status = 'resolved';
          existingConflict.resolvedAt = now;
          existingConflict.resolution = 'withdraw_local';
          existingConflict.resolutionNote = note;
          existingConflict.automatic = automatic;
          existingConflict.history.push({
            at: now,
            action: automatic ? 'auto_withdraw_local' : 'resolve',
            resolution: 'withdraw_local',
            note: automatic
              ? 'Default local withdrawal applied. Published QDN data was not deleted or modified.'
              : note
          });
        }
        applied.push({
          withdrawalId,
          sourceKey: entry.sourceKey,
          policy,
          networkDeleted: false,
          qdnDataPreserved: true
        });
      }
      draft.sync.revision += 1;
    });
    return {
      applied,
      appliedCount: applied.length,
      pending: Math.max(0, pending.length - applied.length),
      policy,
      networkDeleted: false,
      qdnDataPreserved: true,
      message: applied.length > 0
        ? 'Local withdrawal recorded. Previously published QDN resources were NOT deleted.'
        : 'No active mappings were withdrawn.'
    };
  }

  async withdraw({ scanId, sourceKeys = null, policy = 'hide', note = null, automatic = false } = {}) {
    await this._ensureState();
    if (!WITHDRAWAL_POLICIES.includes(policy)) {
      throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'Unknown withdrawal policy: ' + String(policy));
    }
    if (policy === 'review') {
      return { applied: [], appliedCount: 0, pending: this._scan(scanId).delta?.withdrawn?.length ?? 0, policy, networkDeleted: false, qdnDataPreserved: true };
    }
    if (policy === 'keep') {
      return {
        applied: [],
        pending: 0,
        policy,
        networkDeleted: false,
        qdnDataPreserved: true,
        message: 'Source content was kept published locally; no local withdrawal was recorded.'
      };
    }
    return this._applyWithdrawals({ scanId, sourceKeys, policy, automatic, note });
  }

  async prepareTombstones({ scanId, sourceKeys = null, note = null } = {}) {
    await this._ensureState();
    const scan = this._scan(scanId);
    if (scan.status !== 'completed' || scan.complete !== true) {
      throw new QmsError(ERROR_CODES.SYNC_SCAN_INCOMPLETE, 'Tombstones may be prepared only from a complete scan.');
    }
    const mappings = Object.values(this.store.state.identity.mappings ?? {})
      .filter((mapping) => mapping.status === 'withdrawn')
      .filter((mapping) => !sourceKeys || sourceKeys.includes(mapping.sourceKey));
    if (mappings.length === 0) {
      throw new QmsError(ERROR_CODES.SYNC_WITHDRAWAL_NOT_FOUND, 'No withdrawn mappings are available for tombstone preparation.');
    }
    const dir = this.syncPaths.tombstonesDir(scanId);
    await mkdir(dir, { recursive: true });
    const now = nowSafe(this.clock);
    const prepared = [];
    for (const mapping of mappings) {
      const withdrawalId = mapping.withdrawalId ?? withdrawalKey(mapping.sourceKey);
      const fileName = createHash('sha256').update(mapping.sourceKey).digest('hex').slice(0, 24) + '.json';
      const file = path.join(dir, fileName);
      const document = {
        schema: SYNC_TOMBSTONE_SCHEMA,
        version: 1,
        sourceKey: mapping.sourceKey,
        contentType: mapping.contentType,
        qdn: {
          service: mapping.service,
          name: mapping.name,
          identifier: mapping.identifier
        },
        contentHash: mapping.contentHash,
        withdrawnAt: mapping.withdrawnAt ?? now,
        preparedAt: now,
        note: note ?? 'Local tombstone prepared for an explicit future publication decision.',
        networkDeleted: false,
        notice: 'This tombstone is a local preparation only. It does not delete or modify any published QDN resource.'
      };
      await atomicWriteJson(file, document);
      const raw = await readFile(file);
      const bytes = raw.byteLength;
      const digest = 'sha256:' + sha256Hex(raw);
      const relativePath = path.relative(this.paths.root, file);
      await this.store.transaction((draft) => {
        const record = draft.sync.withdrawals[withdrawalId];
        if (record) {
          record.tombstone = {
            schema: SYNC_TOMBSTONE_SCHEMA,
            preparedAt: now,
            relativePath,
            sha256: digest,
            bytes,
            published: false,
            networkDeleted: false
          };
        }
        draft.sync.revision += 1;
      });
      prepared.push({
        sourceKey: mapping.sourceKey,
        withdrawalId,
        relativePath,
        sha256: digest,
        bytes,
        published: false,
        networkDeleted: false
      });
    }
    return {
      scanId,
      prepared,
      preparedCount: prepared.length,
      published: false,
      networkDeleted: false,
      message: 'Tombstones are prepared locally only. Publishing them is a separate explicit Hub action and never deletes QDN data.'
    };
  }

  async preparePlan({
    scanId,
    selection = null,
    batchSize = 1000,
    planning = {},
    disk = {},
    media = {},
    estimateMedia = true
  } = {}) {
    await this._ensureState();
    const scan = this._scan(scanId);
    if (scan.status !== 'completed' || scan.complete !== true || scan.planningAllowed !== true) {
      throw new QmsError(ERROR_CODES.SYNC_SCAN_INCOMPLETE, 'No publication plan can be prepared from an incomplete or failed scan.', {
        details: { scanId, status: scan.status, complete: scan.complete, planningAllowed: scan.planningAllowed }
      });
    }
    const project = this.getProject();
    const latest = await resolveLatestSourceBatch(this.paths, scan.adapterId);
    if (latest.batchId !== scan.batchId) {
      throw new QmsError(ERROR_CODES.SYNC_SCAN_STALE, 'A newer source scan replaced this delta plan input; run the scan again.', {
        details: { scanId, scanBatchId: scan.batchId, latestBatchId: latest.batchId }
      });
    }
    const delta = mapDeltaArrays(scan);
    const defaultKeys = [...delta.new, ...delta.modified].map((entry) => entry.sourceKey);
    const sourceKeys = Array.isArray(selection) && selection.length > 0
      ? [...new Set(selection.map((value) => String(value)))]
      : [...new Set(defaultKeys)];
    if (sourceKeys.length === 0) {
      return {
        scanId,
        status: 'completed',
        planId: null,
        noChanges: true,
        message: 'The completed scan found no new or modified content to publish.'
      };
    }
    await this.assertPublicationSafe({ sourceKeys });
    const result = await this.planning.create({
      batchSize,
      estimateMedia,
      filters: {
        contentTypes: ['post', 'page'],
        sourceKeys
      },
      planning,
      disk,
      media
    });
    if (result.planId) {
      await this.store.transaction((draft) => {
        draft.sync.scans[scanId].planId = result.planId;
        draft.sync.scans[scanId].plannedAt = nowSafe(this.clock);
        draft.sync.revision += 1;
      });
    }
    return { scanId, ...result };
  }

  async conflicts({ includeResolved = false, limit = 500 } = {}) {
    await this._ensureState();
    return Object.values(this.state.conflicts)
      .filter((conflict) => includeResolved || conflict.status !== 'resolved')
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, Math.max(1, Math.min(2000, limit)));
  }

  async resolveConflict({ conflictId, resolution, note = null } = {}) {
    await this._ensureState();
    const allowed = {
      SOURCE_CHANGED_SINCE_SCAN: ['replan', 'skip'],
      QDN_EXTERNAL_CHANGE: ['take_source', 'keep_qdn', 'skip'],
      WITHDRAWAL_CONFLICT: ['withdraw_local', 'keep_published', 'tombstone'],
      LOCAL_DRAFT_DIFFERS: ['keep_draft', 'take_source', 'skip'],
      IDENTITY_COLLISION: ['skip', 'alternate', 'abort'],
      IDENTITY_MAPPING_CONFLICT: ['skip', 'alternate', 'abort'],
      IDENTITY_MIGRATION_REQUIRED: ['abort', 'alternate']
    };
    const now = nowSafe(this.clock);
    let result = null;
    await this.store.transaction((draft) => {
      const conflict = draft.sync.conflicts[conflictId];
      if (!conflict) {
        throw new QmsError(ERROR_CODES.SYNC_CONFLICT_NOT_FOUND, 'Unknown synchronization conflict: ' + String(conflictId), {
          details: { conflictId }
        });
      }
      const resolutions = allowed[conflict.kind] ?? ['skip'];
      if (!resolutions.includes(resolution)) {
        throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'Resolution ' + resolution + ' is not valid for ' + conflict.kind + '.', {
          details: { conflictId, kind: conflict.kind, allowed: resolutions }
        });
      }
      if (conflict.status === 'resolved') {
        if (conflict.resolution === resolution) {
          result = conflict;
          return;
        }
        if (conflict.kind !== 'QDN_EXTERNAL_CHANGE') {
          throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'This conflict is already resolved with a different decision.', {
            details: { conflictId, currentResolution: conflict.resolution, requested: resolution }
          });
        }
        conflict.history.push({ at: now, action: 're_resolve', from: conflict.resolution, to: resolution, note });
      } else {
        conflict.history.push({ at: now, action: 'resolve', resolution, note, automatic: false });
      }
      conflict.status = 'resolved';
      conflict.resolvedAt = now;
      conflict.resolution = resolution;
      conflict.resolutionNote = note;
      conflict.automatic = false;
      if (conflict.kind === 'QDN_EXTERNAL_CHANGE' && resolution === 'take_source') {
        conflict.authorization = { overwriteQdn: true, grantedAt: now, conflictId };
      }
      if (conflict.kind === 'WITHDRAWAL_CONFLICT' && resolution === 'withdraw_local') {
        const mapping = draft.identity.mappings[conflict.sourceKey];
        if (mapping && mapping.status !== 'withdrawn') {
          const withdrawalId = withdrawalKey(conflict.sourceKey);
          mapping.status = 'withdrawn';
          mapping.withdrawnAt = now;
          mapping.withdrawalId = withdrawalId;
          mapping.updatedAt = now;
          draft.sync.withdrawals[withdrawalId] = {
            schema: SYNC_WITHDRAWAL_SCHEMA,
            version: 1,
            id: withdrawalId,
            sourceKey: conflict.sourceKey,
            scanId: conflict.scanId,
            reason: 'OPERATOR_WITHDRAWAL_CONFLICT_RESOLUTION',
            detectedAt: now,
            policy: 'hide',
            automatic: false,
            note,
            mapping: mappingSnapshot(mapping),
            qdn: conflict.evidence?.qdn ?? publicationEvidence(mapping),
            networkDeleted: false,
            qdnDataPreserved: true,
            history: [{ at: now, action: 'withdraw_local', note, automatic: false, networkDeleted: false }],
            tombstone: null
          };
        }
      }
      result = conflict;
      draft.sync.revision += 1;
    });
    if (resolution === 'tombstone' && result?.kind === 'WITHDRAWAL_CONFLICT') {
      const prepared = await this.prepareTombstones({ scanId: result.scanId, sourceKeys: [result.sourceKey], note });
      result = { ...result, tombstones: prepared.prepared };
    }
    return result;
  }

  /**
   * Accept QDN evidence from a read-only verification source. This never
   * fetches or publishes; callers provide exact observed hashes.
   */
  async recordQdnEvidence({
    sourceKey,
    sha256 = null,
    bytes = null,
    service = null,
    name = null,
    identifier = null,
    observedAt = null,
    source = 'operator'
  } = {}) {
    await this._ensureState();
    if (typeof sourceKey !== 'string' || sourceKey === '') {
      throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'sourceKey is required.');
    }
    const mapping = this.store.state.identity.mappings?.[sourceKey];
    if (!mapping) {
      throw new QmsError(ERROR_CODES.SYNC_CONFLICT_NOT_FOUND, 'No mapping exists for ' + sourceKey + '.');
    }
    const observedHash = typeof sha256 === 'string' ? sha256 : null;
    const tripleChanged = (service && service !== mapping.service) ||
      (name && name !== mapping.name) ||
      (identifier && identifier !== mapping.identifier);
    const hashChanged = observedHash !== null && observedHash !== mapping.contentHash;
    if (!tripleChanged && !hashChanged) {
      return { changed: false, sourceKey, mapping: mappingSnapshot(mapping) };
    }
    const now = nowSafe(this.clock);
    const id = conflictKey('QDN_EXTERNAL_CHANGE', sourceKey, observedHash ?? (service ?? '') + (identifier ?? ''));
    let conflict = null;
    await this.store.transaction((draft) => {
      if (!draft.sync.conflicts[id]) {
        draft.sync.counters.conflict = (draft.sync.counters.conflict ?? 0) + 1;
        draft.sync.conflicts[id] = {
          schema: SYNC_CONFLICT_SCHEMA,
          version: 1,
          id,
          kind: 'QDN_EXTERNAL_CHANGE',
          sourceKey,
          scanId: null,
          status: 'open',
          severity: 'blocking',
          createdAt: now,
          resolvedAt: null,
          resolution: null,
          resolutionNote: null,
          automatic: false,
          evidence: {
            source: { sourceKey, observedAt: observedAt ?? now, source },
            local: { mapping: mappingSnapshot(mapping) },
            qdn: {
              service: service ?? mapping.service,
              name: name ?? mapping.name,
              identifier: identifier ?? mapping.identifier,
              sha256: observedHash,
              bytes,
              observedAt: observedAt ?? now,
              source
            }
          },
          history: [{ at: now, action: 'qdn_evidence_recorded', source, note: 'Externally observed QDN content differs from the local mapping.' }]
        };
        draft.sync.revision += 1;
      }
      conflict = draft.sync.conflicts[id];
    });
    return { changed: true, conflict };
  }

  async assertPublicationSafe({ plan = null, planId = null, sourceKeys = [] } = {}) {
    await this._ensureState();
    const keys = Array.isArray(sourceKeys) ? sourceKeys : [];
    if (plan?.batchId) {
      const latest = await resolveLatestSourceBatch(this.paths, plan.source?.adapter ?? this.getProject().source?.adapter ?? 'wordpress');
      if (latest.batchId !== plan.batchId) {
        throw new QmsError(ERROR_CODES.SYNC_SCAN_STALE, 'The plan references a source batch that is no longer the latest scan.', {
          details: { planId: plan.planId ?? planId, planBatchId: plan.batchId, latestBatchId: latest.batchId }
        });
      }
    }
    const blocking = [];
    for (const key of keys) {
      const mapping = this.store.state.identity.mappings?.[key];
      if (!mapping) continue;
      if (mapping.status === 'withdrawn') {
        blocking.push({ sourceKey: key, kind: 'WITHDRAWN_MAPPING', message: 'The mapping is locally withdrawn and cannot be published without re-adding the source.' });
      }
      const conflicts = Object.values(this.state.conflicts).filter((conflict) => conflict.sourceKey === key);
      const latestByKind = new Map();
      for (const conflict of conflicts) {
        const existing = latestByKind.get(conflict.kind);
        if (!existing || String(conflict.createdAt) > String(existing.createdAt)) latestByKind.set(conflict.kind, conflict);
      }
      for (const kind of BLOCKING_CONFLICT_KINDS) {
        const conflict = latestByKind.get(kind);
        if (!conflict) continue;
        if (conflict.status !== 'resolved') {
          blocking.push({ sourceKey: key, kind, conflictId: conflict.id, message: 'Unresolved conflict: ' + conflict.id });
        } else if (kind === 'QDN_EXTERNAL_CHANGE' && conflict.resolution !== 'take_source') {
          blocking.push({
            sourceKey: key,
            kind,
            conflictId: conflict.id,
            message: 'External QDN changes were acknowledged but overwriting was not explicitly authorized.'
          });
        }
      }
      const identityConflicts = Object.values(this.store.state.identity.conflicts ?? {})
        .filter((conflict) => conflict.sourceKey === key && !conflict.resolvedAt);
      for (const conflict of identityConflicts) {
        blocking.push({ sourceKey: key, kind: conflict.kind, conflictId: conflict.id, message: 'Unresolved identity conflict.' });
      }
    }
    if (blocking.length > 0) {
      throw new QmsError(ERROR_CODES.PUBLICATION_CONFLICT, 'Publication is blocked by unresolved or unauthorized conflicts.', {
        details: { blocking, planId: plan?.planId ?? planId }
      });
    }
    return { safe: true, checked: keys.length };
  }

  async catalog({ includeWithdrawn = false } = {}) {
    await this._ensureState();
    const mappings = Object.values(this.store.state.identity.mappings ?? {})
      .filter((mapping) => includeWithdrawn || mapping.status !== 'withdrawn');
    return mappings.map((mapping) => ({
      sourceKey: mapping.sourceKey,
      contentType: mapping.contentType,
      title: this.state.items?.[mapping.sourceKey]?.title ?? null,
      slug: mapping.slug ?? null,
      status: mapping.status,
      publicationStatus: publicationStatusFor(mapping),
      contentHash: mapping.contentHash,
      routeHash: mapping.routeHash,
      qdn: { service: mapping.service, name: mapping.name, identifier: mapping.identifier },
      withdrawnAt: mapping.withdrawnAt ?? null
    }));
  }

  async writeCatalog({ scanId = null } = {}) {
    await this._ensureState();
    const scan = scanId ? this._scan(scanId) : Object.values(this.state.scans)
      .filter((candidate) => candidate.status === 'completed' && candidate.complete === true)
      .sort((left, right) => String(right.completedAt).localeCompare(String(left.completedAt)))[0];
    if (!scan) {
      throw new QmsError(ERROR_CODES.SYNC_SCAN_REQUIRED, 'A complete scan is required before writing a derived catalog.');
    }
    if (scan.status !== 'completed' || scan.complete !== true) {
      throw new QmsError(ERROR_CODES.SYNC_SCAN_INCOMPLETE, 'Refusing to rewrite the visible catalog from an incomplete or failed scan.', {
        details: { scanId: scan.id, status: scan.status, complete: scan.complete }
      });
    }
    const visible = await this.catalog({ includeWithdrawn: false });
    const withdrawn = await this.catalog({ includeWithdrawn: true });
    const file = this.syncPaths.catalogFile(scan.id);
    await mkdir(path.dirname(file), { recursive: true });
    const now = nowSafe(this.clock);
    await atomicWriteJson(file, {
      schema: SYNC_CATALOG_SCHEMA,
      version: 1,
      projectId: this.getProject().id,
      siteId: this.store.state.identity.siteId,
      generatedAt: now,
      sourceScanId: scan.id,
      sourceScanStatus: scan.status,
      visible,
      withdrawn: withdrawn.filter((entry) => entry.status === 'withdrawn'),
      counts: {
        visible: visible.length,
        withdrawn: withdrawn.filter((entry) => entry.status === 'withdrawn').length
      },
      networkDeleted: false,
      note: 'Withdrawn entries are hidden locally. This catalog operation does not delete published QDN resources.'
    });
    const relativePath = path.relative(this.paths.root, file);
    await this.store.transaction((draft) => {
      draft.sync.scans[scan.id].catalogPath = relativePath;
      draft.sync.revision += 1;
    });
    return { scanId: scan.id, relativePath, counts: { visible: visible.length, withdrawn: withdrawn.filter((entry) => entry.status === 'withdrawn').length }, networkDeleted: false };
  }

  /**
   * Adopt a Phase 3–6 project into Phase 7 sync without changing any verified
   * QDN identity. This is read-only with respect to mappings and receipts.
   */
  async adoptExisting({ note = null } = {}) {
    await this._ensureState();
    const identityState = this.store.state.identity;
    if (!identityState) {
      throw new QmsError(ERROR_CODES.IDENTITY_MISMATCH, 'Identity state is not initialized.');
    }
    const mappings = Object.values(identityState.mappings ?? {});
    if (mappings.length === 0) {
      return {
        required: false,
        adopted: false,
        reason: 'no_mappings',
        mappingCount: 0,
        issues: [],
        message: 'No existing mappings were found; adoption is not required.'
      };
    }
    const target = this.identity.target();
    const issues = [];
    const seenTriples = new Map();
    for (const mapping of mappings) {
      const key = tripleKey({ service: mapping.service, name: mapping.name, identifier: mapping.identifier });
      if (seenTriples.has(key)) {
        issues.push({
          code: 'DUPLICATE_QDN_TRIPLE',
          sourceKey: mapping.sourceKey,
          otherSourceKey: seenTriples.get(key),
          message: 'Two mappings share the same QDN triple.'
        });
      } else {
        seenTriples.set(key, mapping.sourceKey);
      }
      if (mapping.name !== target.qdnName) {
        issues.push({
          code: 'TARGET_NAME_MISMATCH',
          sourceKey: mapping.sourceKey,
          message: 'Mapping name does not match the current project target; no identity was changed.',
          mappingName: mapping.name,
          targetName: target.qdnName
        });
      }
      if (!PUBLISHABLE_TYPES.includes(mapping.contentType)) continue;
      try {
        const derived = deriveQdnIdentity({
          siteId: identityState.siteId,
          namespace: identityState.namespace,
          sourceKey: mapping.sourceKey,
          contentType: mapping.contentType,
          mimeType: mapping.mimeType ?? null,
          target
        });
        if (tripleKey(derived) !== key) {
          issues.push({
            code: 'IDENTITY_DERIVATION_MISMATCH',
            sourceKey: mapping.sourceKey,
            message: 'The persisted mapping does not match the deterministic site namespace; no identity was changed.',
            derived,
            persisted: { service: mapping.service, name: mapping.name, identifier: mapping.identifier }
          });
        }
      } catch (error) {
        issues.push({
          code: 'IDENTITY_DERIVATION_FAILED',
          sourceKey: mapping.sourceKey,
          message: error.message
        });
      }
    }
    const handoffs = Object.values(this.store.state.publication?.handoffs ?? {});
    const resources = Object.values(this.store.state.publication?.resources ?? {});
    const now = nowSafe(this.clock);
    const report = {
      schema: SYNC_ADOPTION_SCHEMA,
      version: 1,
      projectId: this.getProject().id,
      siteId: identityState.siteId,
      adoptedAt: now,
      note,
      mappingCount: mappings.length,
      activeMappingCount: mappings.filter((mapping) => mapping.status !== 'withdrawn').length,
      withdrawnMappingCount: mappings.filter((mapping) => mapping.status === 'withdrawn').length,
      verifiedResourceCount: resources.filter((resource) => resource.status === 'remote_verified').length,
      handoffCount: handoffs.length,
      issues,
      changedIdentities: false,
      message: issues.length === 0
        ? 'Existing migration adopted without changing verified QDN identities.'
        : 'Existing migration adopted with issues. Identities were preserved for operator review.'
    };
    await this.store.transaction((draft) => {
      draft.sync.adoptions.push(report);
      draft.sync.revision += 1;
      const adapterId = this.getProject().source?.adapter ?? 'wordpress';
      if (!draft.sync.watermarks[adapterId]) {
        draft.sync.watermarks[adapterId] = {
          schema: 'qms-sync-watermark@1',
          adapterId,
          adoptedAt: now,
          scanId: null,
          mode: 'adopted',
          requiresFullScan: true,
          lastCompletedAt: null,
          fullCompletedAt: null,
          itemCount: mappings.length,
          updatedAt: now
        };
      }
      for (const mapping of mappings) {
        if (!draft.sync.items[mapping.sourceKey]) {
          draft.sync.items[mapping.sourceKey] = {
            schema: 'qms-sync-item@1',
            sourceKey: mapping.sourceKey,
            contentType: mapping.contentType,
            contentHash: mapping.contentHash,
            adoptedAt: now,
            lastSeenAt: null,
            lastScanId: null,
            lastFullScanId: null
          };
        }
      }
    });
    return { ...report, required: true, adopted: true };
  }

  async adoptionReports({ limit = 20 } = {}) {
    await this._ensureState();
    return this.state.adoptions.slice(-Math.max(1, Math.min(100, limit))).reverse();
  }

  async withdrawalList({ limit = 500 } = {}) {
    await this._ensureState();
    return Object.values(this.state.withdrawals)
      .sort((left, right) => String(right.detectedAt).localeCompare(String(left.detectedAt)))
      .slice(0, Math.max(1, Math.min(2000, limit)));
  }

  async resume({ scanId } = {}) {
    await this._ensureState();
    const scan = this._scan(scanId);
    if (scan.status === 'completed' || scan.status === 'incomplete') {
      return this.summarizeScan(scan);
    }
    if (!scan.batchId) {
      return {
        scanId,
        status: 'requires_rescan',
        recoverable: false,
        planningAllowed: false,
        message: 'The interrupted scan has no completed source batch. Run a new scan; no changes were assumed.'
      };
    }
    const config = this._config({});
    const context = await this.runs.start({
      kind: 'sync.resume',
      phase: 'classify',
      meta: { scanId, batchId: scan.batchId }
    });
    try {
      await this.store.transaction((draft) => {
        draft.sync.scans[scanId].status = 'classifying';
        draft.sync.scans[scanId].updatedAt = nowSafe(this.clock);
        draft.sync.revision += 1;
      });
      const result = await this._classify({
        scanId,
        context,
        config,
        classifyBatchSize: scan.classifyBatchSize,
        scanComplete: scan.truncated !== true
      });
      if (result.status === 'interrupted') {
        await context.complete({ scanId, status: 'interrupted', ...result.counts });
      } else {
        await context.complete({ scanId, status: result.status, counts: result.counts });
      }
      return result;
    } catch (error) {
      const mapped = isQmsError(error) ? error : new QmsError(ERROR_CODES.SYNC_SCAN_FAILED, error.message, { cause: error });
      await context.fail(mapped);
      await this._finishScanFailure(scanId, {
        status: 'failed',
        code: mapped.code,
        message: mapped.message,
        error: mapped.toJSON()
      });
      return { scanId, status: 'failed', complete: false, planningAllowed: false, error: mapped.toJSON(), noChanges: false };
    }
  }
}

function usesNonPublicStatus(entry) {
  return isNonPublicStatus(entry.publicationStatus) && entry.publicationStatus !== 'inherit';
}

function mappingSnapshot(mapping) {
  if (!mapping) return null;
  return {
    sourceKey: mapping.sourceKey,
    contentType: mapping.contentType,
    service: mapping.service,
    name: mapping.name,
    identifier: mapping.identifier,
    contentHash: mapping.contentHash,
    routeHash: mapping.routeHash,
    status: mapping.status,
    publicationStatus: publicationStatusFor(mapping),
    localPreparation: preparationStatusFor(mapping),
    publishedAt: mapping.publishedAt ?? null,
    remoteVerifiedAt: mapping.remoteVerifiedAt ?? null,
    withdrawnAt: mapping.withdrawnAt ?? null
  };
}

function publicationEvidence(mapping) {
  if (!mapping) return null;
  return {
    service: mapping.service,
    name: mapping.name,
    identifier: mapping.identifier,
    publicationStatus: publicationStatusFor(mapping),
    remoteVerifiedAt: mapping.remoteVerifiedAt ?? null,
    publishedAt: mapping.publishedAt ?? null
  };
}

export function assertSyncScanSummary(scan) {
  if (!scan || scan.schema !== SYNC_SCAN_SCHEMA) {
    throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'Not a qms-sync-scan@1 document.');
  }
  return scan;
}

export { mapDeltaArrays, emptyCounts, mappingSnapshot, publicationEvidence };
