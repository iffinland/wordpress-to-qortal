import { appendFile, mkdir, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteJson, fsyncDirectory, readFileIfExists, sha256OfJson } from './storage/atomic.js';
import { QmsError, ERROR_CODES } from './errors.js';
import { redact } from './events.js';
import { stableStringify } from '../model/content.js';

/**
 * Phase 8 durable migration/sync history.
 *
 * The audit ledger is a hash-chained append-only JSONL file under
 * <project>/history/audit.jsonl. It survives media cleanup, state
 * compaction and app restarts, and it is never touched by the cleanup
 * service. Records contain metadata and QDN evidence only: no content
 * bodies, credentials, cookies, tokens or wallet material.
 */
export const AUDIT_ENTRY_SCHEMA = 'qms-audit-entry@1';
export const HISTORY_SNAPSHOT_SCHEMA = 'qms-history-snapshot@1';
export const HISTORY_LEDGER_FILE = 'audit.jsonl';
export const HISTORY_LEDGER_VERSION = 1;
export const MAX_AUDIT_ENTRIES_READ = 20000;

export const AUDIT_TYPES = Object.freeze([
  'project_opened',
  'run_started',
  'run_completed',
  'run_failed',
  'run_cancelled',
  'run_paused',
  'run_interrupted',
  'run_resumed',
  'run_dismissed',
  'checkpoint_written',
  'checkpoint_corrupt',
  'publication_prepared',
  'publication_receipt_imported',
  'publication_verified',
  'publication_reconciled',
  'publication_ambiguous',
  'cleanup_previewed',
  'cleanup_started',
  'cleanup_quarantined',
  'cleanup_interrupted',
  'cleanup_resumed',
  'cleanup_restored',
  'cleanup_purged',
  'cleanup_refused',
  'history_snapshot'
]);

const SECRET_VALUE_PATTERNS = Object.freeze([
  /bearer\s+[a-z0-9._~+/=-]{8,}/i,
  /eyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}/i,
  /(?:password|passwd|secret|token|api[_-]?key|seed|private[_-]?key)\s*[:=]\s*\S+/i
]);

function fail(code, message, details) {
  throw new QmsError(code, message, { details });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Reject free text that looks like a leaked credential. */
export function assertNoSecretText(value, label = 'history entry') {
  const serialized = typeof value === 'string' ? value : stableStringify(value ?? {});
  for (const pattern of SECRET_VALUE_PATTERNS) {
    if (pattern.test(serialized)) {
      fail(ERROR_CODES.DIAGNOSTICS_UNSAFE, label + ' contains credential-like text and was not stored.');
    }
  }
  return value;
}

export function auditChecksum({ prev, entry }) {
  const clone = { ...entry };
  delete clone.checksum;
  return 'sha256:' + createHash('sha256')
    .update(String(prev ?? '') + '\n' + stableStringify(clone), 'utf8')
    .digest('hex');
}

export function newAuditId(seq) {
  return 'aud_' + String(seq).padStart(8, '0');
}

export function validateAuditEntry(entry) {
  if (!isPlainObject(entry)) fail(ERROR_CODES.HISTORY_LEDGER_CORRUPT, 'Audit entry must be an object.');
  if (entry.schema !== AUDIT_ENTRY_SCHEMA) {
    fail(ERROR_CODES.HISTORY_LEDGER_CORRUPT, 'Unsupported audit entry schema: ' + String(entry.schema));
  }
  if (!Number.isInteger(entry.seq) || entry.seq < 1) fail(ERROR_CODES.HISTORY_LEDGER_CORRUPT, 'Audit sequence is invalid.');
  if (typeof entry.id !== 'string' || !/^aud_[a-z0-9]{8,40}$/.test(entry.id)) {
    fail(ERROR_CODES.HISTORY_LEDGER_CORRUPT, 'Audit id is invalid.');
  }
  if (!AUDIT_TYPES.includes(entry.type)) fail(ERROR_CODES.HISTORY_LEDGER_CORRUPT, 'Audit type is invalid.');
  if (typeof entry.at !== 'string' || Number.isNaN(Date.parse(entry.at))) {
    fail(ERROR_CODES.HISTORY_LEDGER_CORRUPT, 'Audit timestamp is invalid.');
  }
  if (entry.checksum !== auditChecksum({ prev: entry.prev, entry })) {
    fail(ERROR_CODES.HISTORY_LEDGER_CORRUPT, 'Audit checksum does not match.', { seq: entry.seq });
  }
  return entry;
}

function sanitizeDetails(details) {
  return redact(details ?? {});
}


export class HistoryService {
  constructor({ projectId, paths, store, clock, events = null }) {
    this.projectId = projectId;
    this.paths = paths;
    this.store = store;
    this.clock = clock;
    this.events = events;
    this.ledgerFile = paths.historyLedgerFile ?? path.join(paths.root, 'history', HISTORY_LEDGER_FILE);
    this.snapshotsDir = paths.historySnapshotsDir ?? path.join(paths.root, 'history', 'snapshots');
    this._head = null;
    this._writeChain = Promise.resolve();
  }

  _serialize(fn) {
    const previous = this._writeChain;
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    this._writeChain = previous.then(() => current);
    return previous.then(fn).finally(release);
  }

  async _loadHead() {
    if (this._head) return this._head;
    const raw = await readFileIfExists(this.ledgerFile);
    if (raw === null || raw.trim() === '') {
      this._head = { seq: 0, checksum: null };
      return this._head;
    }
    const lines = raw.split('\n');
    let last = null;
    for (const line of lines) {
      if (!line.trim()) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        // A torn tail can only be the last line; stop at the first failure.
        break;
      }
      if (!isPlainObject(parsed) || parsed.schema !== AUDIT_ENTRY_SCHEMA) {
        throw new QmsError(ERROR_CODES.HISTORY_LEDGER_CORRUPT, 'Audit ledger contains an unreadable record.', {
          details: { file: this.ledgerFile }
        });
      }
      last = parsed;
    }
    this._head = last
      ? { seq: last.seq, checksum: last.checksum }
      : { seq: 0, checksum: null };
    return this._head;
  }

  /** Append one metadata-only audit entry. */
  async record({ type, at = null, runId = null, handoffId = null, resourceId = null, sourceKey = null, status = null, txSignature = null, contentHash = null, bytes = null, details = {} }) {
    if (!AUDIT_TYPES.includes(type)) {
      fail(ERROR_CODES.INVALID_ARGUMENT, 'Unknown audit type: ' + String(type));
    }
    const cleanDetails = sanitizeDetails(details);
    assertNoSecretText(cleanDetails, 'history details');
    return this._serialize(async () => {
      const head = await this._loadHead();
      const seq = head.seq + 1;
      const entry = {
        schema: AUDIT_ENTRY_SCHEMA,
        version: HISTORY_LEDGER_VERSION,
        projectId: this.projectId,
        seq,
        id: newAuditId(seq),
        at: at ?? this.clock.nowIso(),
        type,
        runId,
        handoffId,
        resourceId,
        sourceKey,
        status,
        txSignature: typeof txSignature === 'string' ? txSignature.slice(0, 200) : null,
        contentHash: typeof contentHash === 'string' ? contentHash.slice(0, 200) : null,
        bytes: Number.isInteger(bytes) && bytes >= 0 ? bytes : null,
        details: cleanDetails,
        prev: head.checksum
      };
      assertNoSecretText(stableStringify(entry), 'history entry');
      entry.checksum = auditChecksum({ prev: head.checksum, entry });
      await mkdir(path.dirname(this.ledgerFile), { recursive: true, mode: 0o700 });
      await appendFile(this.ledgerFile, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 });
      await fsyncDirectory(path.dirname(this.ledgerFile));
      this._head = { seq, checksum: entry.checksum };
      return entry;
    });
  }

  /** Read ledger entries newest first, tolerating a torn trailing line. */
  async entries({ limit = 500, types = null, since = null } = {}) {
    const raw = await readFileIfExists(this.ledgerFile);
    if (raw === null) return [];
    const filter = Array.isArray(types) && types.length > 0 ? new Set(types) : null;
    const sinceMs = since ? Date.parse(since) : null;
    const accepted = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        break; // torn tail from a crash; committed entries above stay valid
      }
      if (!isPlainObject(parsed) || parsed.schema !== AUDIT_ENTRY_SCHEMA) {
        throw new QmsError(ERROR_CODES.HISTORY_LEDGER_CORRUPT, 'Audit ledger contains an unreadable record.');
      }
      if (filter && !filter.has(parsed.type)) continue;
      if (sinceMs !== null && Date.parse(parsed.at) < sinceMs) continue;
      accepted.push(parsed);
    }
    return accepted.reverse().slice(0, Math.max(1, Math.min(MAX_AUDIT_ENTRIES_READ, limit)));
  }

  _verifiedResourceEntries() {
    const publication = this.store.state.publication ?? {};
    const handoffs = publication.handoffs ?? {};
    const resources = Object.values(publication.resources ?? {});
    return resources.map((resource) => {
      const handoff = handoffs[resource.handoffId] ?? null;
      return {
        schema: AUDIT_ENTRY_SCHEMA,
        version: HISTORY_LEDGER_VERSION,
        projectId: this.projectId,
        seq: null,
        id: 'derived_resource_' + createHash('sha256').update(String(resource.id)).digest('hex').slice(0, 16),
        at: resource.verifiedAt ?? resource.updatedAt ?? resource.receiptImportedAt ?? handoff?.updatedAt ?? null,
        type: 'publication_verified',
        runId: null,
        handoffId: resource.handoffId ?? null,
        resourceId: resource.id ?? null,
        sourceKey: resource.sourceKey ?? null,
        status: resource.status ?? null,
        txSignature: resource.txSignature ?? null,
        contentHash: resource.sha256 ?? null,
        bytes: Number.isInteger(resource.bytes) ? resource.bytes : null,
        details: {
          kind: resource.kind ?? null,
          service: resource.service ?? null,
          identifier: resource.identifier ?? null,
          independentVerification: resource.verification?.verified === true,
          source: 'state'
        },
        source: 'state'
      };
    }).filter((entry) => entry.at);
  }

  _cleanupEntries() {
    const cleanups = this.store.state.recovery?.cleanups ?? {};
    return Object.values(cleanups).map((record) => ({
      schema: AUDIT_ENTRY_SCHEMA,
      version: HISTORY_LEDGER_VERSION,
      projectId: this.projectId,
      seq: null,
      id: 'derived_cleanup_' + createHash('sha256').update(String(record.cleanupId)).digest('hex').slice(0, 16),
      at: record.updatedAt ?? record.createdAt ?? null,
      type: record.status === 'purged'
        ? 'cleanup_purged'
        : record.status === 'restored'
          ? 'cleanup_restored'
          : record.status === 'quarantined'
            ? 'cleanup_quarantined'
            : 'cleanup_started',
      runId: null,
      handoffId: null,
      resourceId: null,
      sourceKey: null,
      status: record.status ?? null,
      txSignature: null,
      contentHash: null,
      bytes: Number.isInteger(record.bytesQuarantined) ? record.bytesQuarantined : null,
      details: { cleanupId: record.cleanupId, files: record.fileCount ?? null, source: 'state' },
      source: 'state'
    })).filter((entry) => entry.at);
  }

  _syncEntries(limit) {
    const scans = Object.values(this.store.state.sync?.scans ?? {});
    return scans
      .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)))
      .slice(0, limit)
      .map((scan) => ({
        schema: AUDIT_ENTRY_SCHEMA,
        version: HISTORY_LEDGER_VERSION,
        projectId: this.projectId,
        seq: null,
        id: 'derived_scan_' + createHash('sha256').update(String(scan.id)).digest('hex').slice(0, 16),
        at: scan.completedAt ?? scan.updatedAt ?? scan.startedAt ?? null,
        type: 'run_completed',
        runId: scan.runId ?? null,
        handoffId: null,
        resourceId: null,
        sourceKey: null,
        status: scan.status ?? null,
        txSignature: null,
        contentHash: null,
        bytes: null,
        details: {
          scanId: scan.id,
          mode: scan.mode ?? null,
          counts: scan.counts ?? null,
          source: 'state'
        },
        source: 'state'
      })).filter((entry) => entry.at);
  }

  /**
   * Unified, newest-first timeline. The hash-chained ledger is authoritative;
   * state-derived records fill in evidence that predates Phase 8 or that is
   * reconstructed after a restart.
   */
  async timeline({ limit = 500, types = null } = {}) {
    const ledger = await this.entries({ limit, types });
    const truncated = Math.max(1, Math.min(MAX_AUDIT_ENTRIES_READ, limit));
    const derived = [
      ...this._verifiedResourceEntries(),
      ...this._cleanupEntries(),
      ...this._syncEntries(truncated)
    ];
    const seen = new Set(ledger.map((entry) => entry.type + ':' + (entry.handoffId ?? '') + ':' + (entry.resourceId ?? '') + ':' + (entry.status ?? '')));
    const filter = Array.isArray(types) && types.length > 0 ? new Set(types) : null;
    const extra = derived.filter((entry) => {
      if (filter && !filter.has(entry.type)) return false;
      return !seen.has(entry.type + ':' + (entry.handoffId ?? '') + ':' + (entry.resourceId ?? '') + ':' + (entry.status ?? ''));
    });
    return [...ledger, ...extra]
      .sort((left, right) => String(right.at).localeCompare(String(left.at)))
      .slice(0, truncated);
  }

  async evidence({ sourceKey = null, resourceId = null, handoffId = null } = {}) {
    const entries = await this.timeline({ limit: 5000 });
    return entries.filter((entry) => (
      (sourceKey === null || entry.sourceKey === sourceKey) &&
      (resourceId === null || entry.resourceId === resourceId) &&
      (handoffId === null || entry.handoffId === handoffId)
    ));
  }

  /**
   * Write a sealed, self-contained history snapshot. Cleanup calls this before
   * moving any file so audit records survive local media deletion.
   */
  async snapshot({ reason = 'manual', limit = 5000 } = {}) {
    const createdAt = this.clock.nowIso();
    const entries = await this.timeline({ limit });
    const head = await this._loadHead();
    const document = {
      schema: HISTORY_SNAPSHOT_SCHEMA,
      version: 1,
      projectId: this.projectId,
      createdAt,
      reason,
      ledger: { file: 'history/' + HISTORY_LEDGER_FILE, entries: head.seq, headChecksum: head.checksum },
      entryCount: entries.length,
      entries
    };
    document.integrity = { algorithm: 'sha256', value: sha256OfJson(document) };
    assertNoSecretText(stableStringify(document), 'history snapshot');
    await mkdir(this.snapshotsDir, { recursive: true, mode: 0o700 });
    const safeReason = String(reason).replace(/[^a-z0-9-]/gi, '-').slice(0, 40) || 'snapshot';
    const file = path.join(this.snapshotsDir, createdAt.replace(/[:.]/g, '-') + '-' + safeReason + '.json');
    const temporary = file + '.' + process.pid + '.tmp';
    await atomicWriteJson(temporary, document);
    await rename(temporary, file).catch(async (error) => {
      await unlink(temporary).catch(() => {});
      throw error;
    });
    const relativePath = path.relative(this.paths.root, file).split(path.sep).join('/');
    await this.record({
      type: 'history_snapshot',
      details: { reason, entries: entries.length, relativePath }
    });
    return { path: file, relativePath, bytes: Buffer.byteLength(stableStringify(document)), createdAt, entries: entries.length };
  }

  async readSnapshot(relativePath) {
    const absolute = path.resolve(this.paths.root, String(relativePath));
    if (!absolute.startsWith(path.resolve(this.paths.root) + path.sep)) {
      fail(ERROR_CODES.PATH_ESCAPE, 'History snapshot path escapes the project root.');
    }
    const raw = await readFile(absolute, 'utf8');
    return JSON.parse(raw);
  }

  async summary() {
    const head = await this._loadHead();
    const publication = this.store.state.publication ?? {};
    const resources = Object.values(publication.resources ?? {});
    return {
      ledger: { entries: head.seq, headChecksum: head.checksum, file: 'history/' + HISTORY_LEDGER_FILE },
      resources: resources.length,
      verifiedResources: resources.filter((resource) => resource.status === 'remote_verified').length,
      withTxSignature: resources.filter((resource) => typeof resource.txSignature === 'string' && resource.txSignature.length > 0).length,
      cleanups: Object.keys(this.store.state.recovery?.cleanups ?? {}).length,
      snapshots: (await this.entries({ limit: 50, types: ['history_snapshot'] })).length
    };
  }
}

