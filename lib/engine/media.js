import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { QmsError, ERROR_CODES } from './errors.js';
import { resolveRunConfig } from './config.js';
import { diskPreflight } from './disk.js';
import { addConflictRecord } from './identity.js';
import { readIndexedItem } from './source-index.js';
import { assertSafeSegment } from './source-batch.js';
import { assertPathInside } from './storage/paths.js';
import { verifyAsset } from '../media/store.js';
import { MediaDownloader } from '../media/downloader.js';

export const MEDIA_RECEIPT_SCHEMA = 'qms-media-receipt@1';
export const MEDIA_INSPECTION_SCHEMA = 'qms-media-inspection@1';

const ACTIONABLE = new Set(['new', 'modified', 'route_changed', 'reserved']);

function batchDirFor(paths, adapterId, batchId) {
  assertSafeSegment(adapterId, 'adapter id');
  assertSafeSegment(batchId, 'batch id');
  const sourceDir = path.join(paths.artifactsDir, 'source', adapterId);
  return assertPathInside(sourceDir, path.join(sourceDir, 'batches', batchId), 'source batch directory');
}

class RunBudget {
  constructor({ maxBytes, maxFiles }) {
    this.maxBytes = maxBytes > 0 ? maxBytes : Infinity;
    this.maxFiles = maxFiles > 0 ? maxFiles : Infinity;
    this.usedBytes = 0;
    this.usedFiles = 0;
    this.reservedBytes = 0;
    this.reservedFiles = 0;
  }

  get remainingBytes() {
    return this.maxBytes - this.usedBytes - this.reservedBytes;
  }

  tryReserve(bytes) {
    if (this.usedFiles + this.reservedFiles >= this.maxFiles) {
      return { ok: false, reason: 'MAX_FILES_PER_RUN', code: ERROR_CODES.DISK_LIMIT_EXCEEDED };
    }
    const amount = Math.max(0, Number(bytes) || 0);
    if (this.usedBytes + this.reservedBytes + amount > this.maxBytes) {
      return { ok: false, reason: 'MAX_BYTES_PER_RUN', code: ERROR_CODES.DISK_LIMIT_EXCEEDED };
    }
    this.reservedBytes += amount;
    this.reservedFiles += 1;
    return { ok: true, bytes: amount };
  }

  settle({ reservedBytes = 0, actualBytes = 0, countedFile = false }) {
    this.reservedBytes = Math.max(0, this.reservedBytes - reservedBytes);
    this.reservedFiles = Math.max(0, this.reservedFiles - 1);
    this.usedBytes += Math.max(0, Number(actualBytes) || 0);
    if (countedFile) this.usedFiles += 1;
  }
}

function uniquePush(array, value) {
  if (!array.includes(value)) array.push(value);
  return array;
}

export class MediaService {
  constructor({ project, paths, store, clock, runs, events, identity, planning, diskProbe = null, fetchImpl = null }) {
    this.getProject = typeof project === 'function' ? project : () => project;
    this.paths = paths;
    this.store = store;
    this.clock = clock;
    this.runs = runs;
    this.events = events;
    this.identity = identity;
    this.planning = planning;
    this.diskProbe = diskProbe;
    this.fetchImpl = fetchImpl;
  }

  _config(overrides = {}) {
    return resolveRunConfig(this.getProject(), overrides);
  }

  async download({
    planId,
    disk = {},
    media = {},
    concurrency = undefined,
    signal = null
  } = {}) {
    const config = this._config({
      disk,
      media: {
        ...media,
        ...(concurrency !== undefined ? { concurrency } : {})
      }
    });
    const project = this.getProject();
    const loaded = await this.planning.get(planId);
    const plan = loaded.plan;
    if (plan.status !== 'ready') {
      throw new QmsError(ERROR_CODES.PLAN_BLOCKED, 'This plan is blocked and cannot be downloaded.', {
        details: { planId, status: plan.status, errors: plan.errors }
      });
    }
    if (plan.siteId !== project.identity.siteId) {
      throw new QmsError(ERROR_CODES.IDENTITY_MISMATCH, 'Plan site identity does not match this project.', {
        details: { planSiteId: plan.siteId, projectSiteId: project.identity.siteId }
      });
    }

    const context = await this.runs.start({
      kind: 'media.download',
      phase: 'validate_plan',
      meta: { planId, batchId: plan.batchId, mediaCount: plan.media.length }
    });
    const onAbort = () => context.controller.abort('cancelled');
    if (signal) {
      if (signal.aborted) context.controller.abort('cancelled');
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    const warnings = [];
    const receipts = [];
    const errors = [];
    const budget = new RunBudget({
      maxBytes: config.disk.maxBytesPerRun,
      maxFiles: config.disk.maxFilesPerRun
    });
    let processedCount = 0;
    let downloadedBytes = 0;
    let stop = false;
    let stopReason = null;
    let status = 'completed';

    try {
      await context.phase('validate_plan');
      await this.reconcileReferences();
      const batchDir = batchDirFor(this.paths, plan.source.adapter, plan.batchId);
      const invalidItemIds = new Set();
      const planEntries = plan.entries.filter((entry) => ACTIONABLE.has(entry.status) && entry.file);
      for (const entry of planEntries) {
        context.throwIfCancelled();
        try {
          const document = await readIndexedItem(batchDir, {
            id: entry.id,
            file: entry.file,
            sourceKey: entry.sourceKey,
            contentHash: entry.contentHash
          }, { baseUrl: project.source?.baseUrl ?? plan.source.site?.url ?? null });
          if (document.content_hash !== entry.contentHash) {
            throw new QmsError(ERROR_CODES.PLAN_STALE, 'Source content changed after the plan was created.');
          }
        } catch (error) {
          invalidItemIds.add(entry.id);
          const qms = error instanceof QmsError ? error : new QmsError(ERROR_CODES.PLAN_STALE, String(error));
          await this._recordConflict({
            planId,
            sourceKey: entry.sourceKey,
            triple: entry.qdn,
            contentType: entry.contentType,
            contentHash: entry.contentHash,
            message: 'Source changed after planning: ' + qms.message,
            code: qms.code
          });
          warnings.push({
            code: 'SOURCE_CHANGED_AFTER_PLANNING',
            message: 'Source item changed after planning; its media will not be downloaded.',
            details: { sourceKey: entry.sourceKey, id: entry.id }
          });
          await context.warn('SOURCE_CHANGED_AFTER_PLANNING', warnings.at(-1).message, {
            sourceKey: entry.sourceKey,
            id: entry.id
          });
        }
      }

      await context.phase('media_preflight');
      const verifiedReceipts = new Set();
      const records = [];
      for (const record of plan.media) {
        const receipt = this.store.state.media?.downloads?.[record.url] ?? null;
        if (receipt?.status === 'verified' && receipt.hash && !verifiedReceipts.has(record.url)) {
          verifiedReceipts.add(record.url);
        }
        const items = record.items.filter((id) => !invalidItemIds.has(id));
        records.push({ ...record, items });
      }
      const pendingRecords = records.filter((record) => !verifiedReceipts.has(record.url));
      const knownRemaining = pendingRecords.reduce((total, record) => total + (record.status === 'known' ? record.bytes ?? 0 : 0), 0);
      const unknownRemaining = pendingRecords.filter((record) => record.status === 'unknown').length;
      const preflight = await diskPreflight({
        probe: this.diskProbe,
        workspacePath: this.paths.root,
        limits: config.disk,
        knownBytes: knownRemaining,
        unknownCount: unknownRemaining,
        metadataBytes: 0
      });
      if (!preflight.fits) {
        await context.warn(preflight.reason ?? ERROR_CODES.DISK_SPACE_INSUFFICIENT, preflight.message, {
          availableBytes: preflight.availableBytes,
          requiredBytes: preflight.requiredBytes
        });
        await this._finishPlanDownload({ planId, plan, status: 'blocked', reason: preflight.reason, counts: { verified: 0, failed: 0 } });
        const completion = await context.complete({
          status: 'blocked',
          planId,
          disk: preflight,
          reasons: [preflight.reason]
        });
        return {
          runId: context.runId,
          status: 'blocked',
          planId,
          disk: preflight,
          receipts,
          errors: [{ code: preflight.reason, message: preflight.message }],
          warnings,
          events: completion.events
        };
      }

      const downloader = new MediaDownloader({
        fetchImpl: this.fetchImpl ?? globalThis.fetch,
        clock: this.clock,
        diskProbe: this.diskProbe,
        diskLimits: config.disk,
        mediaSettings: config.media,
        baseUrl: project.source?.baseUrl ?? plan.source.site?.url ?? null,
        assetsDir: this.paths.mediaAssetsDir,
        tmpDir: this.paths.mediaTmpDir,
        signal: context.signal,
        onProgress: ({ bytes }) => {
          if (bytes - (this._lastProgressBytes ?? 0) >= 2 * 1024 * 1024) {
            this._lastProgressBytes = bytes;
            void context.progress({
              phase: 'download',
              completed: processedCount,
              total: records.length,
              bytes,
              code: 'MEDIA_DOWNLOAD_PROGRESS',
              message: 'Media bytes downloaded.'
            }).catch(() => {});
          }
        }
      });

      await context.phase('download');
      await context.checkpoint({
        step: 'download_start',
        phase: 'download',
        cursor: verifiedReceipts.size,
        total: records.length,
        resumable: true,
        resume: { service: 'media', method: 'download', params: { planId } },
        details: { pending: pendingRecords.length, verified: verifiedReceipts.size }
      });
      const queue = records;
      let cursor = 0;
      const workerCount = Math.max(1, Math.min(config.media.concurrency, queue.length || 1));
      const workers = Array.from({ length: workerCount }, async () => {
        for (;;) {
          if (stop || context.signal.aborted) return;
          const index = cursor;
          cursor += 1;
          if (index >= queue.length) return;
          const record = queue[index];
          const result = await this._processRecord({
            record,
            plan,
            planId,
            invalidItemIds,
            config,
            context,
            budget,
            downloader
          });
          processedCount += 1;
          if (result.actualBytes) downloadedBytes += result.actualBytes;
          await context.checkpoint({
            step: 'download_record',
            phase: 'download',
            cursor: processedCount,
            total: queue.length,
            resumable: true,
            resume: { service: 'media', method: 'download', params: { planId } },
            details: {
              lastUrl: record.url,
              status: result.result.status,
              downloadedBytes
            }
          }).catch(() => {});
          if (result.result.status === 'paused') {
            stop = true;
            stopReason = result.result.code ?? 'MEDIA_PAUSED';
          } else if (result.result.status === 'cancelled') {
            stop = true;
            stopReason = 'CANCELLED';
          }
          if (result.result.status === 'verified' && result.result.reused) {
            budget.settle({ reservedBytes: result.reservedBytes, actualBytes: 0, countedFile: false });
          } else {
            budget.settle({
              reservedBytes: result.reservedBytes,
              actualBytes: result.actualBytes,
              countedFile: result.result.status === 'verified'
            });
          }
          receipts.push(result.result);
          if (result.result.status === 'failed') {
            errors.push({
              code: result.result.code ?? ERROR_CODES.MEDIA_DOWNLOAD_FAILED,
              message: result.result.message ?? 'Media download failed.',
              url: record.url,
              retryable: result.result.retryable === true
            });
          } else if (result.result.status === 'paused') {
            errors.push({
              code: result.result.code ?? ERROR_CODES.DISK_LIMIT_EXCEEDED,
              message: result.result.message ?? 'Media download paused.',
              url: record.url
            });
          } else if (result.result.status === 'missing' || result.result.status === 'blocked') {
            errors.push({
              code: result.result.code ?? ERROR_CODES.MEDIA_NOT_FOUND,
              message: result.result.message ?? 'Media resource is unavailable.',
              url: record.url
            });
          }
          await context.progress({
            phase: 'download',
            completed: processedCount,
            total: records.length,
            bytes: downloadedBytes,
            code: 'MEDIA_PROGRESS',
            message: processedCount + ' of ' + records.length + ' media resources processed.',
            details: {
              status: result.result.status,
              planId,
              url: record.url,
              hash: result.result.hash ?? null
            }
          });
        }
      });
      await Promise.all(workers);

      const verified = receipts.filter((entry) => entry.status === 'verified');
      const failed = receipts.filter((entry) => entry.status === 'failed');
      const paused = receipts.filter((entry) => entry.status === 'paused');
      const skipped = receipts.filter((entry) => ['skipped_external', 'blocked', 'missing'].includes(entry.status));
      const interrupted = receipts.filter((entry) => entry.status === 'cancelled');
      const conflicts = receipts.filter((entry) => entry.status === 'conflict');
      const unavailable = receipts.filter((entry) => entry.status === 'missing' || entry.status === 'blocked');
      const unprocessed = records.length - verified.length - failed.length - paused.length - skipped.length - interrupted.length - conflicts.length;
      if (context.signal.aborted) {
        status = 'cancelled';
      } else if (stopReason && stopReason !== 'CANCELLED') {
        status = 'paused';
      } else if (failed.length > 0 || interrupted.length > 0 || conflicts.length > 0 || unavailable.length > 0) {
        status = 'partial';
      } else if (unprocessed > 0) {
        status = 'paused';
      } else {
        status = 'completed';
      }
      await this._finishPlanDownload({
        planId,
        plan,
        status,
        reason: stopReason,
        counts: {
          verified: verified.length,
          reused: verified.filter((entry) => entry.reused).length,
          failed: failed.length,
          paused: paused.length,
          skipped: skipped.length,
          interrupted: interrupted.length,
          conflicts: conflicts.length
        }
      });

      if (status === 'cancelled') {
        const cancellation = await context.cancel();
        return {
          runId: context.runId,
          status: 'cancelled',
          planId,
          receipts,
          counts: {
            verified: verified.length,
            failed: failed.length,
            paused: paused.length,
            skipped: skipped.length,
            interrupted: interrupted.length,
            conflicts: conflicts.length,
            unprocessed
          },
          errors,
          warnings,
          events: cancellation?.events ?? []
        };
      }

      const completion = await context.complete({
        status,
        planId,
        counts: {
          total: records.length,
          verified: verified.length,
          reused: verified.filter((entry) => entry.reused).length,
          failed: failed.length,
          paused: paused.length,
          skipped: skipped.length,
          interrupted: interrupted.length,
          conflicts: conflicts.length,
          unprocessed
        },
        bytes: downloadedBytes,
        reasons: stopReason ? [stopReason] : []
      });
      return {
        runId: context.runId,
        status,
        planId,
        receipts,
        counts: {
          total: records.length,
          verified: verified.length,
          reused: verified.filter((entry) => entry.reused).length,
          failed: failed.length,
          paused: paused.length,
          skipped: skipped.length,
          interrupted: interrupted.length,
          conflicts: conflicts.length,
          unprocessed
        },
        bytes: downloadedBytes,
        errors,
        warnings,
        events: completion.events
      };
    } catch (error) {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (error?.code === ERROR_CODES.OPERATION_CANCELLED || context.signal.aborted) {
        const cancellation = await context.cancel();
        return {
          runId: context.runId,
          status: 'cancelled',
          planId,
          receipts,
          errors,
          warnings,
          events: cancellation?.events ?? []
        };
      }
      const qms = error instanceof QmsError
        ? error
        : new QmsError(ERROR_CODES.MEDIA_DOWNLOAD_FAILED, error instanceof Error ? error.message : String(error), {
            cause: error
          });
      await this._finishPlanDownload({ planId, status: 'failed', reason: qms.code, counts: { verified: 0, failed: 1 } }).catch(() => {});
      const failure = await context.fail(qms);
      return {
        runId: context.runId,
        status: 'failed',
        planId,
        error: qms.toJSON(),
        receipts,
        errors,
        warnings,
        events: failure?.events ?? []
      };
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  async _processRecord({ record, plan, planId, invalidItemIds, config, context, budget, downloader }) {
    const now = this.clock.nowIso();
    if (record.items.length === 0) {
      const result = {
        status: 'conflict',
        code: 'SOURCE_CHANGED_AFTER_PLANNING',
        message: 'Every item referencing this media changed after planning.',
        url: record.url,
        hash: null
      };
      await this._recordReceipt({ planId, record, result, itemIds: [] });
      return { result, reservedBytes: 0, actualBytes: 0 };
    }
    if (record.status === 'skipped_external') {
      const result = {
        status: 'skipped_external',
        code: record.code ?? ERROR_CODES.MEDIA_URL_BLOCKED,
        message: record.message ?? 'External media is linked-only.',
        url: record.url,
        hash: null
      };
      await this._recordReceipt({ planId, record, result, itemIds: record.items });
      await context.warn('MEDIA_SKIPPED_EXTERNAL', result.message, { url: record.url });
      return { result, reservedBytes: 0, actualBytes: 0 };
    }
    if (record.status === 'missing') {
      const result = {
        status: 'missing',
        code: ERROR_CODES.MEDIA_NOT_FOUND,
        message: record.message ?? 'Media resource was not found.',
        url: record.url,
        hash: null
      };
      await this._recordReceipt({ planId, record, result, itemIds: record.items });
      await context.warn(ERROR_CODES.MEDIA_NOT_FOUND, result.message, { url: record.url });
      return { result, reservedBytes: 0, actualBytes: 0 };
    }
    if (record.status === 'blocked') {
      const result = {
        status: 'blocked',
        code: record.code ?? ERROR_CODES.MEDIA_URL_BLOCKED,
        message: record.message ?? 'Media URL was blocked by policy.',
        url: record.url,
        hash: null
      };
      await this._recordReceipt({ planId, record, result, itemIds: record.items });
      await context.warn(result.code, result.message, { url: record.url });
      return { result, reservedBytes: 0, actualBytes: 0 };
    }

    const existingReceipt = this.store.state.media?.downloads?.[record.url] ?? null;
    if (existingReceipt?.status === 'verified' && existingReceipt.hash) {
      const reused = await this._reuseVerified({ planId, record, receipt: existingReceipt, itemIds: record.items });
      if (reused) {
        await context.progress({
          phase: 'download',
          completed: 0,
          total: 0,
          code: 'MEDIA_REUSED',
          message: 'Verified media was reused without downloading.',
          details: { url: record.url, hash: existingReceipt.hash, planId }
        });
        return { result: reused, reservedBytes: 0, actualBytes: 0 };
      }
    }

    const expectedBytes = record.status === 'known' ? record.bytes : null;
    if (expectedBytes !== null && expectedBytes > config.disk.maxFileBytes) {
      const result = {
        status: 'failed',
        code: ERROR_CODES.MEDIA_FILE_TOO_LARGE,
        message: 'Media file exceeds the configured per-file byte cap.',
        url: record.url,
        bytes: expectedBytes
      };
      await this._recordReceipt({ planId, record, result, itemIds: record.items });
      await context.warn(result.code, result.message, { url: record.url });
      return { result, reservedBytes: 0, actualBytes: 0 };
    }

    const reserveBytes = expectedBytes ?? config.disk.maxFileBytes;
    const reservation = budget.tryReserve(reserveBytes);
    if (!reservation.ok) {
      const result = {
        status: 'paused',
        code: reservation.code,
        message: 'Download paused at the configured per-run ' + (reservation.reason === 'MAX_FILES_PER_RUN' ? 'file' : 'byte') + ' limit.',
        url: record.url,
        reason: reservation.reason
      };
      await this._recordReceipt({ planId, record, result, itemIds: record.items });
      await context.warn('MEDIA_PAUSED', result.message, { url: record.url, reason: reservation.reason });
      return { result, reservedBytes: 0, actualBytes: 0 };
    }

    const result = await downloader.download(record.url, {
      expectedBytes,
      maxFileBytes: config.disk.maxFileBytes,
      maxTotalBytes: expectedBytes ?? reservation.bytes
    });
    const actualBytes = result.status === 'verified'
      ? (result.reused ? 0 : (result.bytesDownloaded ?? result.bytes ?? 0))
      : (result.bytesDownloaded ?? 0);

    if (result.status === 'verified') {
      const stored = await this._recordVerified({ planId, record, result, itemIds: record.items });
      await context.progress({
        phase: 'download',
        completed: 0,
        total: 0,
        bytes: actualBytes,
        code: result.reused ? 'MEDIA_DEDUPLICATED' : 'MEDIA_VERIFIED',
        message: result.reused
          ? 'Media verified and deduplicated into the content-addressed store.'
          : 'Media downloaded, hashed and atomically finalized.',
        details: { url: record.url, hash: result.hash, bytes: result.bytes, planId, reused: result.reused }
      });
      return { result: { ...result, receipt: stored }, reservedBytes: reservation.bytes, actualBytes };
    }

    if (result.status === 'paused') {
      await this._recordReceipt({ planId, record, result, itemIds: record.items });
      await context.warn('MEDIA_PAUSED', result.message, {
        url: record.url,
        code: result.code,
        bytesDownloaded: result.bytesDownloaded ?? 0
      });
      return { result, reservedBytes: reservation.bytes, actualBytes };
    }
    if (result.status === 'cancelled') {
      await this._recordReceipt({ planId, record, result: { ...result, status: 'cancelled' }, itemIds: record.items });
      return { result, reservedBytes: reservation.bytes, actualBytes };
    }
    await this._recordReceipt({ planId, record, result, itemIds: record.items });
    await context.warn(result.code ?? ERROR_CODES.MEDIA_DOWNLOAD_FAILED, result.message ?? 'Media download failed.', {
      url: record.url,
      retryable: result.retryable === true,
      bytesDownloaded: result.bytesDownloaded ?? 0
    });
    return { result, reservedBytes: reservation.bytes, actualBytes };
  }

  async _reuseVerified({ planId, record, receipt, itemIds }) {
    try {
      const filePath = assertPathInside(this.paths.mediaAssetsDir, path.join(this.paths.mediaAssetsDir, receipt.relativePath), 'media asset path');
      const verified = await verifyAsset({ filePath, hash: receipt.hash, bytes: receipt.bytes });
      if (!verified.valid) return null;
      await this._recordVerified({
        planId,
        record,
        result: {
          status: 'verified',
          url: record.url,
          hash: receipt.hash,
          bytes: receipt.bytes,
          mimeType: receipt.mimeType,
          relativePath: receipt.relativePath,
          reused: true,
          bytesDownloaded: 0
        },
        itemIds
      });
      return {
        status: 'verified',
        url: record.url,
        hash: receipt.hash,
        bytes: receipt.bytes,
        mimeType: receipt.mimeType,
        reused: true,
        bytesDownloaded: 0
      };
    } catch {
      return null;
    }
  }

  async _recordVerified({ planId, record, result, itemIds }) {
    const now = this.clock.nowIso();
    let receipt = null;
    await this.store.transaction((draft) => {
      const media = draft.media;
      const existing = media.assets[result.hash];
      if (!existing) {
        media.assets[result.hash] = {
          schema: 'qms-media-asset@1',
          hash: result.hash,
          bytes: result.bytes,
          mimeType: result.mimeType ?? record.mimeType ?? null,
          relativePath: result.relativePath,
          refCount: 0,
          sourceUrls: [record.url],
          firstStoredAt: now,
          lastVerifiedAt: now
        };
        media.counters.bytes += result.bytes;
        media.counters.files += 1;
      } else {
        if (!existing.sourceUrls.includes(record.url)) existing.sourceUrls.push(record.url);
        existing.lastVerifiedAt = now;
        existing.refCount = Number.isInteger(existing.refCount) ? existing.refCount : 0;
      }
      receipt = {
        schema: MEDIA_RECEIPT_SCHEMA,
        version: 1,
        url: record.url,
        status: 'verified',
        hash: result.hash,
        bytes: result.bytes,
        mimeType: result.mimeType ?? record.mimeType ?? null,
        relativePath: result.relativePath,
        planId,
        itemIds,
        sourceKeys: record.sourceKeys ?? [],
        reused: Boolean(result.reused),
        bytesDownloaded: result.bytesDownloaded ?? 0,
        verifiedAt: now,
        updatedAt: now
      };
      media.downloads[record.url] = receipt;
      for (const itemId of itemIds) {
        const refs = media.itemRefs[itemId] ?? [];
        if (!refs.includes(result.hash)) refs.push(result.hash);
        media.itemRefs[itemId] = refs;
      }
      media.assets[result.hash].refCount = countRefs(media.itemRefs, result.hash);
      const planRecord = draft.plans[planId];
      if (!planRecord) return;
      const progress = planRecord.download ?? {
        status: 'running',
        startedAt: now,
        downloadedBytes: 0,
        files: 0,
        reused: 0,
        verifiedUrls: [],
        failedUrls: [],
        interruptedUrls: []
      };
      uniquePush(progress.verifiedUrls, record.url);
      progress.downloadedBytes += result.reused ? 0 : (result.bytesDownloaded ?? 0);
      progress.files += result.reused ? 0 : 1;
      progress.reused += result.reused ? 1 : 0;
      progress.status = 'running';
      progress.updatedAt = now;
      planRecord.download = progress;
    });
    return receipt;
  }

  async _recordReceipt({ planId, record, result, itemIds }) {
    const now = this.clock.nowIso();
    await this.store.transaction((draft) => {
      const media = draft.media;
      media.downloads[record.url] = {
        schema: MEDIA_RECEIPT_SCHEMA,
        version: 1,
        url: record.url,
        status: result.status,
        hash: result.hash ?? null,
        bytes: result.bytes ?? null,
        mimeType: result.mimeType ?? record.mimeType ?? null,
        relativePath: result.relativePath ?? null,
        planId,
        itemIds,
        sourceKeys: record.sourceKeys ?? [],
        reused: Boolean(result.reused),
        bytesDownloaded: result.bytesDownloaded ?? 0,
        code: result.code ?? null,
        message: result.message ?? null,
        retryable: result.retryable === true,
        updatedAt: now,
        verifiedAt: result.status === 'verified' ? now : null
      };
      const planRecord = draft.plans[planId];
      if (planRecord) {
        const progress = planRecord.download ?? {
          status: 'running',
          startedAt: now,
          downloadedBytes: 0,
          files: 0,
          reused: 0,
          verifiedUrls: [],
          failedUrls: [],
          interruptedUrls: []
        };
        if (result.status === 'failed') uniquePush(progress.failedUrls, record.url);
        if (result.status === 'cancelled') uniquePush(progress.interruptedUrls, record.url);
        progress.downloadedBytes += result.bytesDownloaded ?? 0;
        progress.updatedAt = now;
        progress.status = 'running';
        planRecord.download = progress;
      }
    });
  }

  async _finishPlanDownload({ planId, plan = null, status, reason = null, counts = {} }) {
    await this.store.transaction((draft) => {
      const planRecord = draft.plans[planId];
      if (!planRecord) return;
      const progress = planRecord.download ?? {
        startedAt: this.clock.nowIso(),
        downloadedBytes: 0,
        files: 0,
        reused: 0,
        verifiedUrls: [],
        failedUrls: [],
        interruptedUrls: []
      };
      progress.status = status;
      progress.pausedReason = reason;
      progress.counts = counts;
      progress.completedAt = this.clock.nowIso();
      progress.updatedAt = this.clock.nowIso();
      planRecord.download = progress;
      // Locally prepared is a separate dimension from publication. A verified
      // media set never implies that anything was published to QDN.
      if (plan?.entries && draft.identity?.mappings) {
        const receipts = draft.media.downloads ?? {};
        for (const entry of plan.entries) {
          const mapping = draft.identity.mappings[entry.sourceKey];
          if (!mapping) continue;
          const urls = plan.media
            .filter((record) => Array.isArray(record.items) && record.items.includes(entry.id))
            .filter((record) => record.status !== 'skipped_external')
            .map((record) => record.url);
          if (urls.length === 0) {
            mapping.localPreparation = 'prepared';
            mapping.preparedAt = mapping.preparedAt ?? this.clock.nowIso();
            continue;
          }
          const verified = urls.filter((url) => receipts[url]?.status === 'verified').length;
          if (verified === urls.length) {
            mapping.localPreparation = 'prepared';
            mapping.preparedAt = mapping.preparedAt ?? this.clock.nowIso();
          } else if (verified > 0 && mapping.localPreparation !== 'prepared') {
            mapping.localPreparation = 'partial';
          }
        }
      }
    });
  }

  async _recordConflict({ planId, sourceKey, triple, contentType, contentHash, message, code }) {
    const now = this.clock.nowIso();
    await this.store.transaction((draft) => {
      if (!draft.identity) return;
      addConflictRecord(draft.identity, {
        planId,
        conflict: {
          kind: 'SOURCE_CHANGED_AFTER_PLANNING',
          sourceKey,
          triple: triple ?? null,
          contentType,
          contentHash,
          code,
          message
        },
        now
      });
    });
  }

  /** Rebuild reference counts from the persisted item→hash references. */
  async reconcileReferences() {
    return this.store.transaction((draft) => {
      const media = draft.media;
      const itemRefs = {};
      const counts = new Map();
      for (const [itemId, hashes] of Object.entries(media.itemRefs ?? {})) {
        const valid = [];
        for (const hash of Array.isArray(hashes) ? hashes : []) {
          if (media.assets[hash] && !valid.includes(hash)) {
            valid.push(hash);
            counts.set(hash, (counts.get(hash) ?? 0) + 1);
          }
        }
        if (valid.length > 0) itemRefs[itemId] = valid;
      }
      media.itemRefs = itemRefs;
      let bytes = 0;
      let files = 0;
      for (const [hash, asset] of Object.entries(media.assets ?? {})) {
        asset.refCount = counts.get(hash) ?? 0;
        bytes += asset.bytes ?? 0;
        files += 1;
      }
      media.counters = { bytes, files };
      return { assets: files, bytes, refs: counts.size };
    });
  }

  async inspect() {
    const media = this.store.state.media ?? { assets: {}, downloads: {}, itemRefs: {}, counters: { bytes: 0, files: 0 } };
    const assets = Object.values(media.assets ?? {})
      .sort((left, right) => String(left.hash).localeCompare(String(right.hash)))
      .map((asset) => ({
        hash: asset.hash,
        bytes: asset.bytes,
        mimeType: asset.mimeType ?? null,
        relativePath: asset.relativePath,
        refCount: asset.refCount ?? 0,
        sourceCount: asset.sourceUrls?.length ?? 0,
        firstStoredAt: asset.firstStoredAt ?? null,
        lastVerifiedAt: asset.lastVerifiedAt ?? null
      }));
    const downloadCounts = {};
    for (const receipt of Object.values(media.downloads ?? {})) {
      downloadCounts[receipt.status] = (downloadCounts[receipt.status] ?? 0) + 1;
    }
    let parts = { count: 0, bytes: 0 };
    try {
      const entries = await readdir(this.paths.mediaTmpDir);
      let bytes = 0;
      let count = 0;
      for (const entry of entries) {
        if (!entry.endsWith('.part')) continue;
        const info = await stat(path.join(this.paths.mediaTmpDir, entry));
        if (info.isFile()) {
          count += 1;
          bytes += info.size;
        }
      }
      parts = { count, bytes };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return {
      schema: MEDIA_INSPECTION_SCHEMA,
      version: 1,
      assets,
      totals: {
        assets: assets.length,
        bytes: media.counters?.bytes ?? 0,
        itemRefs: Object.keys(media.itemRefs ?? {}).length,
        referencedAssets: assets.filter((asset) => asset.refCount > 0).length
      },
      downloads: downloadCounts,
      receipts: Object.values(media.downloads ?? {}).map((receipt) => ({
        url: receipt.url,
        status: receipt.status,
        hash: receipt.hash ?? null,
        bytes: receipt.bytes ?? null,
        planId: receipt.planId ?? null,
        sourceKeys: receipt.sourceKeys ?? [],
        updatedAt: receipt.updatedAt ?? null
      })),
      parts
    };
  }
}

function countRefs(itemRefs, hash) {
  let count = 0;
  for (const refs of Object.values(itemRefs ?? {})) {
    if (Array.isArray(refs) && refs.includes(hash)) count += 1;
  }
  return count;
}
