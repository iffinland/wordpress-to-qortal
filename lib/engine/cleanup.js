import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson, fsyncDirectory, sha256OfJson } from './storage/atomic.js';
import { assertPathInside } from './storage/paths.js';
import { QmsError, ERROR_CODES } from './errors.js';
import { contentId } from '../model/content.js';
import { hashFile } from '../media/store.js';
import { measureFreeBytes } from './disk.js';

/**
 * Phase 8 two-phase cleanup.
 *
 * Phase 1 (quarantine) moves eligible files into <project>/cleanup/quarantine
 * with a manifest. Phase 2 (purge) deletes them after a configurable retention
 * window. Restoration is a rename back before purge.
 *
 * Safety rules enforced here:
 * - cleanup is refused unless every referenced publication is remotely
 *   verified with exact read-back evidence;
 * - shared media is protected by reference counts and per-item evidence;
 * - project state, manifests, identity mappings, receipts, audit history and
 *   recovery checkpoints are never candidates;
 * - every path is resolved and checked against the real project root, and
 *   symlinks anywhere in the path are refused;
 * - actual disk usage is measured before and after each phase.
 */
export const CLEANUP_RECORD_SCHEMA = 'qms-cleanup-record@1';
export const CLEANUP_PREVIEW_SCHEMA = 'qms-cleanup-preview@1';
export const QUARANTINE_MANIFEST_SCHEMA = 'qms-quarantine-manifest@1';
export const CLEANUP_RECEIPT_SCHEMA = 'qms-cleanup-receipt@1';
export const DEFAULT_RETENTION_DAYS = 14;
export const MAX_RETENTION_DAYS = 3650;
export const MAX_CLEANUP_FILES = 200000;

const CLEANUP_ID = /^cln_[a-z0-9]{8,40}$/;
const PREVIEW_ID = /^cln_[a-z0-9]{8,40}$/;
const HANDOFF_ID = /^hof_[a-z0-9]{8,40}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const PROTECTED_RELATIVE = Object.freeze([
  'state',
  'project.json',
  'lock.json',
  'runs',
  'recovery',
  'history',
  'cleanup/records',
  'cleanup/receipts',
  'cleanup/previews',
  'artifacts/source',
  'publication/plans',
  'publication/receipts'
]);

const DELETABLE_PREFIXES = Object.freeze([
  'media/assets',
  'media/tmp'
]);

function fail(code, message, details) {
  throw new QmsError(code, message, { details });
}

function newCleanupId() {
  return 'cln_' + randomBytes(12).toString('hex');
}

function nowMs(clock) {
  return clock.nowMs ? clock.nowMs() : Date.now();
}

function toRelative(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/');
}

function isProtectedRelative(relative) {
  return PROTECTED_RELATIVE.some((prefix) => relative === prefix || relative.startsWith(prefix + '/'));
}

function isDeletableRelative(relative) {
  if (isProtectedRelative(relative)) return false;
  if (DELETABLE_PREFIXES.some((prefix) => relative.startsWith(prefix + '/'))) return true;
  return /^publication\/handoffs\/[a-z0-9_-]+\/payload\//.test(relative);
}

/**
 * Resolve a project-relative path and refuse traversal, absolute paths and
 * symlinked components. Returns the absolute path without following the final
 * component.
 */
export async function assertSafeProjectPath(root, relativePath, { label = 'cleanup path', allowMissing = true } = {}) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.includes('\0')) {
    fail(ERROR_CODES.CLEANUP_PATH_UNSAFE, label + ' is not a valid relative path.', { relativePath });
  }
  if (path.isAbsolute(relativePath)) {
    fail(ERROR_CODES.CLEANUP_PATH_UNSAFE, label + ' must be relative to the project root.', { relativePath });
  }
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, '/'));
  if (normalized === '..' || normalized.startsWith('../')) {
    fail(ERROR_CODES.CLEANUP_PATH_UNSAFE, label + ' escapes the project root.', { relativePath });
  }
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(rootResolved, normalized);
  assertPathInside(rootResolved, resolved, label);
  const realRoot = await realpath(rootResolved);
  const segments = normalized.split('/').filter(Boolean);
  let current = rootResolved;
  for (const segment of segments) {
    current = path.join(current, segment);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT') {
        if (!allowMissing) {
          fail(ERROR_CODES.CLEANUP_PATH_UNSAFE, label + ' does not exist.', { relativePath });
        }
        break;
      }
      throw error;
    }
    if (info.isSymbolicLink()) {
      fail(ERROR_CODES.CLEANUP_PATH_UNSAFE, label + ' contains a symbolic link and is refused.', {
        relativePath,
        component: toRelative(rootResolved, current)
      });
    }
    const realCurrent = await realpath(current);
    if (realCurrent !== realRoot && !realCurrent.startsWith(realRoot + path.sep)) {
      fail(ERROR_CODES.CLEANUP_PATH_UNSAFE, label + ' resolves outside the project root.', {
        relativePath,
        component: toRelative(rootResolved, current)
      });
    }
  }
  return resolved;
}

async function walkFiles(directory, root, { maxFiles = MAX_CLEANUP_FILES } = {}) {
  const files = [];
  let truncated = false;
  async function walk(current) {
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        files.push({ absolute, symlink: true, bytes: 0 });
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const info = await lstat(absolute);
        files.push({ absolute, bytes: info.size, relativePath: toRelative(root, absolute) });
      }
    }
  }
  await walk(directory);
  return { files, truncated };
}


export class CleanupService {
  constructor({ projectId, project, paths, store, clock, events = null, history = null, runs = null, diskProbe = null, onProgress = null }) {
    this.projectId = projectId;
    this.getProject = project;
    this.paths = paths;
    this.store = store;
    this.clock = clock;
    this.events = events;
    this.history = history;
    this.runs = runs;
    this.diskProbe = diskProbe;
    this.onProgress = onProgress;
    this._active = new Set();
  }

  _assertNoActiveRun() {
    const active = this.runs?.activeRunIds ?? [];
    if (active.length > 0) {
      fail(ERROR_CODES.CLEANUP_ACTIVE_RUN, 'Cleanup cannot start while an operation is running. Finish or cancel it first.', {
        activeRunIds: active
      });
    }
  }

  _state() {
    const recovery = this.store.state.recovery;
    if (!recovery) {
      fail(ERROR_CODES.STATE_JOURNAL_CORRUPT, 'Recovery state is missing; reopen the project.');
    }
    return recovery;
  }

  _evidence() {
    const state = this.store.state;
    const project = this.getProject();
    const adapterId = project?.source?.adapter ?? 'wordpress';
    const handoffs = state.publication?.handoffs ?? {};
    const resources = Object.values(state.publication?.resources ?? {});
    const mappings = state.identity?.mappings ?? {};
    const byHandoff = new Map();
    for (const resource of resources) {
      const list = byHandoff.get(resource.handoffId) ?? [];
      list.push(resource);
      byHandoff.set(resource.handoffId, list);
    }
    const verified = resources.filter((resource) => resource.status === 'remote_verified');
    const verifiedHashes = new Set(
      verified.filter((resource) => resource.kind === 'media' && typeof resource.sha256 === 'string')
        .map((resource) => resource.sha256)
    );
    const verifiedSourceKeys = new Set(
      verified.filter((resource) => resource.kind === 'content' && typeof resource.sourceKey === 'string')
        .map((resource) => resource.sourceKey)
    );
    const verifiedItemIds = new Set();
    for (const sourceKey of verifiedSourceKeys) {
      const mapping = mappings[sourceKey];
      if (!mapping) continue;
      verifiedItemIds.add(contentId(adapterId, mapping.contentType, sourceKey));
    }
    const eligibleHandoffs = [];
    const refusedHandoffs = [];
    for (const [handoffId, handoff] of Object.entries(handoffs)) {
      const handoffResources = byHandoff.get(handoffId) ?? [];
      const allVerified = handoffResources.length > 0
        && handoffResources.every((resource) => resource.status === 'remote_verified');
      if (handoff.status === 'remote_verified' && allVerified) {
        eligibleHandoffs.push({ handoffId, status: handoff.status, resources: handoffResources.length });
      } else {
        const statuses = {};
        for (const resource of handoffResources) {
          statuses[resource.status] = (statuses[resource.status] ?? 0) + 1;
        }
        refusedHandoffs.push({
          handoffId,
          status: handoff.status,
          reason: 'NOT_REMOTELY_VERIFIED',
          resourceStatuses: statuses
        });
      }
    }
    return {
      adapterId,
      handoffs,
      resources,
      byHandoff,
      verifiedHashes,
      verifiedSourceKeys,
      verifiedItemIds,
      eligibleHandoffs,
      refusedHandoffs
    };
  }

  _assetItem(asset, evidence, options) {
    const refs = [];
    for (const [itemId, hashes] of Object.entries(this.store.state.media?.itemRefs ?? {})) {
      if (Array.isArray(hashes) && hashes.includes(asset.hash)) refs.push(itemId);
    }
    const unverifiedRefs = refs.filter((itemId) => !evidence.verifiedItemIds.has(itemId));
    let eligible = false;
    let reason = null;
    if (unverifiedRefs.length > 0) {
      reason = refs.length > 1 ? 'SHARED_MEDIA_REFERENCED' : 'UNVERIFIED_REFERENCE';
    } else if (!evidence.verifiedHashes.has(asset.hash)) {
      reason = 'NO_REMOTE_EVIDENCE';
    } else if (refs.length === 0) {
      if (options.includeUnreferenced) {
        eligible = true;
        reason = 'UNREFERENCED_AND_UNPUBLISHED';
      } else {
        reason = 'UNREFERENCED_MEDIA';
      }
    } else {
      eligible = true;
    }
    return {
      category: 'media_asset',
      relativePath: 'media/assets/' + String(asset.relativePath ?? '').replace(/^\/+/, ''),
      bytes: Number.isInteger(asset.bytes) ? asset.bytes : 0,
      eligible,
      reason,
      hash: asset.hash,
      refCount: refs.length,
      recordedRefCount: asset.refCount ?? 0,
      referencedBy: refs.slice(0, 50)
    };
  }

  async _collectCandidates(evidence, options) {
    const items = [];
    const warnings = [];
    for (const asset of Object.values(this.store.state.media?.assets ?? {})) {
      if (!asset?.hash || !asset.relativePath) continue;
      items.push(this._assetItem(asset, evidence, options));
    }
    if (options.includeParts) {
      const tmpDir = this.paths.mediaTmpDir;
      try {
        const entries = await readdir(tmpDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.part')) continue;
          const absolute = path.join(tmpDir, entry.name);
          const info = await lstat(absolute);
          items.push({
            category: 'media_part',
            relativePath: 'media/tmp/' + entry.name,
            bytes: info.size,
            eligible: true,
            reason: 'INCOMPLETE_DOWNLOAD',
            hash: null,
            refCount: 0
          });
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (options.includeHandoffPayloads) {
      const wanted = options.handoffIds ? new Set(options.handoffIds) : null;
      for (const entry of evidence.eligibleHandoffs) {
        if (wanted && !wanted.has(entry.handoffId)) continue;
        const record = evidence.handoffs[entry.handoffId];
        const relative = record.relativePath ?? ('handoffs/' + entry.handoffId);
        let handoffRoot;
        try {
          handoffRoot = await assertSafeProjectPath(this.paths.root, relative, { label: 'handoff directory' });
        } catch (error) {
          warnings.push({ code: error.code ?? 'HANDOFF_PATH_UNSAFE', handoffId: entry.handoffId, message: error.message });
          continue;
        }
        for (const sub of ['payload/media', 'payload/content']) {
          const directory = path.join(handoffRoot, sub);
          const walked = await walkFiles(directory, this.paths.root);
          if (walked.truncated) {
            warnings.push({ code: 'CLEANUP_SCAN_TRUNCATED', directory: sub, message: 'Payload listing was truncated.' });
          }
          for (const file of walked.files) {
            if (file.symlink) {
              items.push({
                category: 'handoff_payload',
                relativePath: file.relativePath,
                bytes: 0,
                eligible: false,
                reason: 'SYMLINK_REFUSED',
                handoffId: entry.handoffId
              });
              continue;
            }
            items.push({
              category: 'handoff_payload',
              relativePath: file.relativePath,
              bytes: file.bytes,
              eligible: true,
              reason: 'PUBLISHED_PAYLOAD_COPY',
              handoffId: entry.handoffId
            });
          }
        }
      }
    }
    return { items, warnings };
  }

  _retentionDays(value) {
    const days = value === undefined || value === null ? DEFAULT_RETENTION_DAYS : Number(value);
    if (!Number.isInteger(days) || days < 0 || days > MAX_RETENTION_DAYS) {
      fail(ERROR_CODES.INVALID_ARGUMENT, 'retentionDays must be an integer between 0 and ' + MAX_RETENTION_DAYS + '.');
    }
    return days;
  }

  async _freeBytes() {
    try {
      return await measureFreeBytes(this.diskProbe, this.paths.root);
    } catch {
      return null;
    }
  }

  async preview({
    handoffIds = null,
    planIds = null,
    includeHandoffPayloads = true,
    includeParts = true,
    includeUnreferenced = false,
    explicitPaths = null,
    retentionDays = undefined
  } = {}) {
    const evidence = this._evidence();
    const requested = Array.isArray(handoffIds) && handoffIds.length > 0 ? handoffIds : null;
    if (requested) {
      for (const handoffId of requested) {
        if (!HANDOFF_ID.test(String(handoffId))) {
          fail(ERROR_CODES.INVALID_ARGUMENT, 'Invalid handoff id: ' + String(handoffId));
        }
      }
    }
    const refused = requested
      ? evidence.refusedHandoffs.filter((entry) => requested.includes(entry.handoffId))
      : [...evidence.refusedHandoffs];
    const scopeHandoffs = requested ?? evidence.eligibleHandoffs.map((entry) => entry.handoffId);
    if (requested) {
      const missing = requested.filter((handoffId) => !evidence.handoffs[handoffId]);
      if (missing.length > 0) {
        fail(ERROR_CODES.PUBLICATION_PLAN_NOT_FOUND, 'Unknown handoff id(s) for cleanup.', { missing });
      }
    }
    const options = {
      handoffIds: scopeHandoffs,
      includeHandoffPayloads: includeHandoffPayloads !== false,
      includeParts: includeParts !== false,
      includeUnreferenced: includeUnreferenced === true
    };
    const collected = await this._collectCandidates(evidence, options);
    const truncated = collected.items.length > 5000;
    const items = collected.items.slice(0, MAX_CLEANUP_FILES);
    if (Array.isArray(explicitPaths) && explicitPaths.length > 0) {
      items.length = 0;
      for (const candidate of explicitPaths) {
        const absolute = await assertSafeProjectPath(this.paths.root, String(candidate), { label: 'explicit cleanup path' });
        const relative = toRelative(this.paths.root, absolute);
        if (!isDeletableRelative(relative)) {
          fail(ERROR_CODES.CLEANUP_NOT_ELIGIBLE, 'The requested path is protected project data and cannot be cleaned.', {
            relativePath: relative
          });
        }
        let info;
        try {
          info = await lstat(absolute);
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          throw error;
        }
        if (info.isSymbolicLink()) {
          fail(ERROR_CODES.CLEANUP_PATH_UNSAFE, 'A symbolic link is never cleaned.', { relativePath: relative });
        }
        if (!info.isFile()) {
          fail(ERROR_CODES.CLEANUP_NOT_ELIGIBLE, 'Only regular files can be cleaned.', { relativePath: relative });
        }
        items.push({
          category: relative.startsWith('media/assets/') ? 'media_asset' : relative.startsWith('media/tmp/') ? 'media_part' : 'handoff_payload',
          relativePath: relative,
          bytes: info.size,
          eligible: true,
          reason: 'EXPLICIT_VERIFIED_PATH',
          hash: null,
          refCount: 0
        });
      }
    }
    const totals = {
      files: items.length,
      bytes: items.reduce((sum, item) => sum + (item.bytes ?? 0), 0),
      eligibleFiles: items.filter((item) => item.eligible).length,
      eligibleBytes: items.filter((item) => item.eligible).reduce((sum, item) => sum + (item.bytes ?? 0), 0),
      protectedFiles: items.filter((item) => !item.eligible && item.reason !== 'SYMLINK_REFUSED').length,
      protectedBytes: items.filter((item) => !item.eligible && item.reason !== 'SYMLINK_REFUSED').reduce((sum, item) => sum + (item.bytes ?? 0), 0),
      unsafeFiles: items.filter((item) => item.reason === 'SYMLINK_REFUSED').length
    };
    const days = this._retentionDays(retentionDays);
    const preview = {
      schema: CLEANUP_PREVIEW_SCHEMA,
      version: 1,
      previewId: newCleanupId(),
      projectId: this.projectId,
      createdAt: this.clock.nowIso(),
      scope: {
        handoffIds: scopeHandoffs,
        planIds: Array.isArray(planIds) ? planIds : [],
        includeHandoffPayloads: options.includeHandoffPayloads,
        includeParts: options.includeParts,
        includeUnreferenced: options.includeUnreferenced,
        retentionDays: days
      },
      eligibleHandoffs: evidence.eligibleHandoffs
        .filter((entry) => scopeHandoffs.length === 0 || scopeHandoffs.includes(entry.handoffId))
        .map((entry) => ({ handoffId: entry.handoffId, status: entry.status, resources: entry.resources })),
      refusedHandoffs: refused.filter((entry) => scopeHandoffs.length === 0 || scopeHandoffs.includes(entry.handoffId)),
      items: items.slice(0, 5000),
      itemLimit: 5000,
      truncated,
      totals,
      disk: { freeBytesBefore: await this._freeBytes() },
      protected: PROTECTED_RELATIVE,
      warnings: collected.warnings,
      eligible: totals.eligibleFiles > 0 && totals.unsafeFiles === 0
    };
    await mkdir(this.paths.cleanupPreviewsDir, { recursive: true, mode: 0o700 });
    await atomicWriteJson(path.join(this.paths.cleanupPreviewsDir, preview.previewId + '.json'), preview, { mode: 0o600 });
    return preview;
  }


  _getRecord(cleanupId) {
    if (!CLEANUP_ID.test(String(cleanupId))) {
      fail(ERROR_CODES.INVALID_ARGUMENT, 'Invalid cleanup id: ' + String(cleanupId));
    }
    const record = this._state().cleanups[cleanupId];
    if (!record) {
      fail(ERROR_CODES.CLEANUP_NOT_FOUND, 'Unknown cleanup: ' + String(cleanupId), { cleanupId });
    }
    return record;
  }

  async _updateRecord(cleanupId, patch) {
    const now = this.clock.nowIso();
    await this.store.transaction((draft) => {
      const record = draft.recovery.cleanups[cleanupId];
      if (!record) fail(ERROR_CODES.CLEANUP_NOT_FOUND, 'Cleanup record disappeared.', { cleanupId });
      Object.assign(record, patch);
      record.updatedAt = now;
      draft.recovery.revision += 1;
    });
    const record = this._state().cleanups[cleanupId];
    await this._persistRecordFile(record);
    return record;
  }

  async _persistRecordFile(record) {
    await mkdir(this.paths.cleanupRecordsDir, { recursive: true, mode: 0o700 });
    await atomicWriteJson(path.join(this.paths.cleanupRecordsDir, record.cleanupId + '.json'), {
      schema: CLEANUP_RECORD_SCHEMA,
      version: 1,
      persistedAt: this.clock.nowIso(),
      record
    }, { mode: 0o600 });
  }

  async _writeManifest(record) {
    const directory = path.join(this.paths.cleanupDir, 'manifests');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const manifest = {
      schema: QUARANTINE_MANIFEST_SCHEMA,
      version: 1,
      cleanupId: record.cleanupId,
      projectId: this.projectId,
      createdAt: record.createdAt,
      updatedAt: this.clock.nowIso(),
      retentionDays: record.retentionDays,
      restoreBy: record.restoreBy,
      entryCount: record.items.length,
      bytes: record.bytesQuarantined ?? 0,
      entries: record.items.map((item) => ({
        relativePath: item.relativePath,
        category: item.category,
        bytes: item.bytes ?? 0,
        hash: item.hash ?? null,
        handoffId: item.handoffId ?? null,
        moved: item.moved === true,
        movedAt: item.movedAt ?? null,
        missing: item.missing === true
      }))
    };
    await atomicWriteJson(path.join(directory, record.cleanupId + '.json'), manifest, { mode: 0o600 });
    return manifest;
  }

  async _moveOne(item, cleanupId) {
    const root = this.paths.root;
    const source = await assertSafeProjectPath(root, item.relativePath, { label: 'cleanup source' });
    const target = assertPathInside(
      this.paths.cleanupQuarantineDir,
      path.join(this.paths.cleanupQuarantineDir, cleanupId, item.relativePath),
      'quarantine target'
    );
    const sourceInfo = await lstat(source).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    const targetInfo = await lstat(target).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!sourceInfo) {
      if (targetInfo) return { alreadyMoved: true, bytes: targetInfo.size };
      return { missing: true, bytes: 0 };
    }
    if (sourceInfo.isSymbolicLink()) {
      fail(ERROR_CODES.CLEANUP_PATH_UNSAFE, 'A symbolic link is never quarantined.', { relativePath: item.relativePath });
    }
    if (!sourceInfo.isFile()) {
      fail(ERROR_CODES.CLEANUP_NOT_ELIGIBLE, 'Only regular files can be quarantined.', { relativePath: item.relativePath });
    }
    if (targetInfo) {
      fail(ERROR_CODES.CLEANUP_STATE_INVALID, 'Both the source and the quarantined copy exist; refusing to overwrite.', {
        relativePath: item.relativePath
      });
    }
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await rename(source, target);
    await fsyncDirectory(path.dirname(source));
    await fsyncDirectory(path.dirname(target));
    return { moved: true, bytes: sourceInfo.size };
  }

  async _quarantineItems(cleanupId) {
    let record = this._getRecord(cleanupId);
    let movedBytes = 0;
    let movedCount = 0;
    const failed = [];
    const items = record.items.map((item) => ({ ...item }));
    for (const item of items) {
      if (item.moved === true) {
        movedCount += 1;
        movedBytes += item.bytes ?? 0;
        continue;
      }
      try {
        const result = await this._moveOne(item, cleanupId);
        if (result.missing) {
          item.missing = true;
          item.moved = true;
          item.movedAt = this.clock.nowIso();
        } else {
          item.moved = true;
          item.movedAt = this.clock.nowIso();
          movedBytes += result.bytes ?? item.bytes ?? 0;
        }
        movedCount += 1;
      } catch (error) {
        failed.push({
          relativePath: item.relativePath,
          code: error.code ?? 'CLEANUP_MOVE_FAILED',
          message: error.message
        });
        item.failed = { code: error.code ?? 'CLEANUP_MOVE_FAILED', message: error.message };
      }
      if (typeof this.onProgress === 'function') {
        await this.onProgress({
          cleanupId,
          movedCount,
          failedCount: failed.length,
          bytesQuarantined: movedBytes,
          relativePath: item.relativePath
        });
      }
      if ((movedCount + failed.length) % 25 === 0) {
        record = await this._updateRecord(cleanupId, {
          items,
          movedCount,
          bytesQuarantined: movedBytes,
          failedItems: failed
        });
      }
    }
    const status = failed.length === 0 ? 'quarantined' : 'partial';
    record = await this._updateRecord(cleanupId, {
      items,
      movedCount,
      bytesQuarantined: movedBytes,
      failedItems: failed,
      fileCount: items.length,
      status,
      quarantinedAt: failed.length === 0 ? this.clock.nowIso() : null,
      disk: { ...(record.disk ?? {}), freeBytesAfter: await this._freeBytes() }
    });
    await this._writeManifest(record);
    return record;
  }

  async start(options = {}) {
    this._assertNoActiveRun();
    const preview = await this.preview(options);
    if (options.dryRun === true) {
      return { dryRun: true, preview };
    }
    const scoped = Array.isArray(options.handoffIds) && options.handoffIds.length > 0;
    const blocking = preview.refusedHandoffs.filter((entry) => (
      scoped ? options.handoffIds.includes(entry.handoffId) : true
    ));
    if (preview.truncated) {
      fail(ERROR_CODES.CLEANUP_NOT_ELIGIBLE, 'This cleanup scope exceeds the 5,000-file preview limit. Narrow the scope before deleting anything.', {
        previewId: preview.previewId,
        files: preview.totals.files
      });
    }
    if (!preview.eligible || blocking.length > 0) {
      if (this.history) {
        await this.history.record({
          type: 'cleanup_refused',
          status: 'refused',
          details: {
            previewId: preview.previewId,
            totals: preview.totals,
            refusedHandoffs: blocking.map((entry) => ({ handoffId: entry.handoffId, status: entry.status }))
          }
        }).catch(() => {});
      }
      fail(
        ERROR_CODES.CLEANUP_NOT_ELIGIBLE,
        blocking.length > 0
          ? 'Cleanup is refused because a publication is not remotely verified. Verify exact QDN read-back first; nothing is deleted for unverified, partial or failed runs.'
          : 'Cleanup is refused because there are no eligible files.',
        { previewId: preview.previewId, totals: preview.totals, refusedHandoffs: blocking }
      );
    }
    const eligibleItems = preview.items
      .filter((item) => item.eligible)
      .map((item) => ({
        relativePath: item.relativePath,
        category: item.category,
        bytes: item.bytes ?? 0,
        hash: item.hash ?? null,
        handoffId: item.handoffId ?? null,
        moved: false,
        movedAt: null
      }));
    const cleanupId = newCleanupId();
    const createdAt = this.clock.nowIso();
    const retentionDays = preview.scope.retentionDays;
    const restoreBy = new Date(nowMs(this.clock) + retentionDays * DAY_MS).toISOString();

    // Audit records are written before any file moves.
    const historySnapshot = this.history
      ? await this.history.snapshot({ reason: 'pre-cleanup-' + cleanupId })
      : null;
    const receipt = {
      schema: CLEANUP_RECEIPT_SCHEMA,
      version: 1,
      cleanupId,
      projectId: this.projectId,
      createdAt,
      retentionDays,
      restoreBy,
      scope: preview.scope,
      eligibleHandoffs: preview.eligibleHandoffs,
      historySnapshot: historySnapshot ? { relativePath: historySnapshot.relativePath, entries: historySnapshot.entries } : null,
      evidence: preview.eligibleHandoffs.map((entry) => {
        const resources = this.store.state.publication.resources ?? {};
        return {
          handoffId: entry.handoffId,
          status: entry.status,
          resources: Object.values(resources)
            .filter((resource) => resource.handoffId === entry.handoffId)
            .map((resource) => ({
              resourceId: resource.id,
              service: resource.service,
              identifier: resource.identifier,
              status: resource.status,
              sha256: resource.sha256 ?? null,
              bytes: resource.bytes ?? null,
              txSignature: resource.txSignature ?? null
            }))
        };
      }),
      files: eligibleItems.map((item) => ({
        relativePath: item.relativePath,
        bytes: item.bytes,
        hash: item.hash,
        handoffId: item.handoffId
      })),
      totals: preview.totals
    };
    receipt.integrity = { algorithm: 'sha256', value: sha256OfJson(receipt) };
    await mkdir(this.paths.cleanupReceiptsDir, { recursive: true, mode: 0o700 });
    const receiptFile = path.join(this.paths.cleanupReceiptsDir, cleanupId + '.json');
    await atomicWriteJson(receiptFile, receipt, { mode: 0o600 });

    const record = {
      schema: CLEANUP_RECORD_SCHEMA,
      version: 1,
      cleanupId,
      projectId: this.projectId,
      status: 'quarantining',
      createdAt,
      updatedAt: createdAt,
      retentionDays,
      restoreBy,
      scope: preview.scope,
      previewId: preview.previewId,
      receiptPath: toRelative(this.paths.root, receiptFile),
      historySnapshotPath: historySnapshot?.relativePath ?? null,
      items: eligibleItems.slice(0, 5000),
      fileCount: eligibleItems.length,
      movedCount: 0,
      bytesQuarantined: 0,
      bytesReclaimed: 0,
      failedItems: [],
      disk: { freeBytesBefore: preview.disk.freeBytesBefore, freeBytesAfter: null },
      purgedAt: null,
      restoredAt: null
    };
    await this.store.transaction((draft) => {
      draft.recovery.cleanups[cleanupId] = record;
      draft.recovery.counters.cleanup = (draft.recovery.counters.cleanup ?? 0) + 1;
      draft.recovery.history.unshift({
        type: 'cleanup_started',
        cleanupId,
        at: createdAt,
        files: eligibleItems.length,
        bytes: preview.totals.eligibleBytes
      });
      draft.recovery.history = draft.recovery.history.slice(0, 2000);
      draft.recovery.revision += 1;
    });
    await this._persistRecordFile(record);
    if (this.history) {
      await this.history.record({
        type: 'cleanup_started',
        runId: null,
        status: 'quarantining',
        bytes: preview.totals.eligibleBytes,
        details: {
          cleanupId,
          files: eligibleItems.length,
          handoffs: preview.eligibleHandoffs.map((entry) => entry.handoffId),
          historySnapshot: historySnapshot?.relativePath ?? null
        }
      }).catch(() => {});
    }
    this._active.add(cleanupId);
    try {
      const finished = await this._quarantineItems(cleanupId);
      if (this.history) {
        await this.history.record({
          type: 'cleanup_quarantined',
          status: finished.status,
          bytes: finished.bytesQuarantined,
          details: {
            cleanupId,
            files: finished.movedCount,
            failed: finished.failedItems.length,
            restoreBy: finished.restoreBy,
            actualDiskFreeBytes: finished.disk?.freeBytesAfter ?? null
          }
        }).catch(() => {});
      }
      return this.describe(finished);
    } finally {
      this._active.delete(cleanupId);
    }
  }

  describe(record) {
    return {
      schema: CLEANUP_RECORD_SCHEMA,
      cleanupId: record.cleanupId,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      retentionDays: record.retentionDays,
      restoreBy: record.restoreBy,
      scope: record.scope,
      receiptPath: record.receiptPath,
      historySnapshotPath: record.historySnapshotPath,
      fileCount: record.fileCount,
      movedCount: record.movedCount,
      bytesQuarantined: record.bytesQuarantined,
      bytesReclaimed: record.bytesReclaimed,
      bytesRestored: record.bytesRestored ?? 0,
      failedItems: record.failedItems ?? [],
      disk: record.disk ?? {},
      freed: {
        bytesQuarantined: record.bytesQuarantined ?? 0,
        bytesReclaimed: record.bytesReclaimed ?? 0,
        diskFreeBytesBefore: record.disk?.freeBytesBefore ?? null,
        diskFreeBytesAfterQuarantine: record.disk?.freeBytesAfter ?? null,
        diskFreeBytesAfterPurge: record.disk?.freeBytesAfterPurge ?? null,
        diskFreeDeltaBytes: record.disk?.freeBytesBefore !== null && record.disk?.freeBytesAfterPurge !== null
          ? (record.disk.freeBytesAfterPurge - record.disk.freeBytesBefore)
          : null
      },
      items: (record.items ?? []).slice(0, 5000).map((item) => ({
        relativePath: item.relativePath,
        category: item.category,
        bytes: item.bytes,
        hash: item.hash ?? null,
        moved: item.moved === true,
        missing: item.missing === true,
        failed: item.failed ?? null
      }))
    };
  }

  list({ limit = 100 } = {}) {
    return Object.values(this._state().cleanups)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, Math.max(1, Math.min(500, limit)))
      .map((record) => this.describe(record));
  }

  get(cleanupId) {
    return this.describe(this._getRecord(cleanupId));
  }

  async resume(cleanupId) {
    const record = this._getRecord(cleanupId);
    if (!['quarantining', 'partial'].includes(record.status)) {
      fail(ERROR_CODES.CLEANUP_STATE_INVALID, 'Only an interrupted or partial cleanup can be resumed.', {
        cleanupId,
        status: record.status
      });
    }
    this._assertNoActiveRun();
    if (this.history) {
      await this.history.record({
        type: 'cleanup_resumed',
        status: record.status,
        details: { cleanupId }
      }).catch(() => {});
    }
    const finished = await this._quarantineItems(cleanupId);
    return this.describe(finished);
  }

  async restore(cleanupId) {
    const record = this._getRecord(cleanupId);
    if (!['quarantined', 'partial', 'restored'].includes(record.status)) {
      fail(ERROR_CODES.CLEANUP_STATE_INVALID, 'This cleanup cannot be restored in its current state.', {
        cleanupId,
        status: record.status
      });
    }
    if (record.status === 'restored') {
      return { ...this.describe(record), alreadyRestored: true };
    }
    this._assertNoActiveRun();
    const root = this.paths.root;
    const items = record.items.map((item) => ({ ...item }));
    const failed = [];
    let restoredBytes = 0;
    for (const item of items) {
      if (item.moved !== true) continue;
      if (item.missing === true) continue;
      try {
        const target = await assertSafeProjectPath(root, item.relativePath, { label: 'restore target', allowMissing: true });
        const quarantined = assertPathInside(
          this.paths.cleanupQuarantineDir,
          path.join(this.paths.cleanupQuarantineDir, cleanupId, item.relativePath),
          'quarantine source'
        );
        const quarantineInfo = await lstat(quarantined).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (!quarantineInfo) {
          failed.push({ relativePath: item.relativePath, code: 'QUARANTINE_FILE_MISSING' });
          continue;
        }
        const targetInfo = await lstat(target).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (targetInfo) {
          failed.push({ relativePath: item.relativePath, code: 'RESTORE_TARGET_EXISTS' });
          continue;
        }
        if (item.hash) {
          const verified = await hashFile(quarantined);
          if (verified.hash !== item.hash) {
            failed.push({ relativePath: item.relativePath, code: 'QUARANTINE_HASH_MISMATCH' });
            continue;
          }
        }
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await rename(quarantined, target);
        await fsyncDirectory(path.dirname(target));
        item.moved = false;
        item.restoredAt = this.clock.nowIso();
        restoredBytes += quarantineInfo.size;
      } catch (error) {
        failed.push({ relativePath: item.relativePath, code: error.code ?? 'CLEANUP_RESTORE_FAILED', message: error.message });
      }
    }
    const finished = await this._updateRecord(cleanupId, {
      items,
      status: failed.length === 0 ? 'restored' : 'partial',
      restoredAt: this.clock.nowIso(),
      bytesRestored: restoredBytes,
      restoredFailedItems: failed
    });
    await this._writeManifest(finished);
    if (this.history) {
      await this.history.record({
        type: 'cleanup_restored',
        status: finished.status,
        bytes: restoredBytes,
        details: { cleanupId, failed: failed.length }
      }).catch(() => {});
    }
    return { ...this.describe(finished), restoredBytes, failedItems: failed };
  }

  async purge(cleanupId, { force = false } = {}) {
    const record = this._getRecord(cleanupId);
    if (record.status !== 'quarantined') {
      fail(ERROR_CODES.CLEANUP_STATE_INVALID, 'Only a fully quarantined cleanup can be purged.', {
        cleanupId,
        status: record.status
      });
    }
    this._assertNoActiveRun();
    const restoreByMs = Date.parse(record.restoreBy);
    if (!force && Number.isFinite(restoreByMs) && nowMs(this.clock) < restoreByMs) {
      fail(ERROR_CODES.CLEANUP_RETENTION_ACTIVE, 'The retention window is still active; restore is possible until ' + record.restoreBy + '.', {
        cleanupId,
        restoreBy: record.restoreBy
      });
    }
    const quarantineRoot = assertPathInside(
      this.paths.cleanupQuarantineDir,
      path.join(this.paths.cleanupQuarantineDir, cleanupId),
      'quarantine root'
    );
    const freeBefore = await this._freeBytes();
    const walked = await walkFiles(quarantineRoot, this.paths.root);
    if (walked.files.some((file) => file.symlink)) {
      fail(ERROR_CODES.CLEANUP_PATH_UNSAFE, 'The quarantine contains a symbolic link; refusing to purge it.');
    }
    let reclaimed = 0;
    for (const file of walked.files) {
      reclaimed += file.bytes ?? 0;
      await unlink(file.absolute).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    await rm(quarantineRoot, { recursive: true, force: true });
    await fsyncDirectory(path.dirname(quarantineRoot));
    const freeAfter = await this._freeBytes();
    const finished = await this._updateRecord(cleanupId, {
      status: 'purged',
      purgedAt: this.clock.nowIso(),
      bytesReclaimed: reclaimed,
      disk: {
        ...(record.disk ?? {}),
        freeBytesBefore: record.disk?.freeBytesBefore ?? freeBefore,
        freeBytesAfterPurge: freeAfter
      }
    });
    if (this.history) {
      await this.history.record({
        type: 'cleanup_purged',
        status: 'purged',
        bytes: reclaimed,
        details: {
          cleanupId,
          files: walked.files.length,
          diskFreeBytesBefore: freeBefore,
          diskFreeBytesAfter: freeAfter,
          diskFreeDeltaBytes: freeBefore !== null && freeAfter !== null ? freeAfter - freeBefore : null
        }
      }).catch(() => {});
    }
    return {
      ...this.describe(finished),
      bytesReclaimed: reclaimed,
      filesDeleted: walked.files.length,
      diskFreeBytesBefore: freeBefore,
      diskFreeBytesAfter: freeAfter,
      diskFreeDeltaBytes: freeBefore !== null && freeAfter !== null ? freeAfter - freeBefore : null
    };
  }
}

