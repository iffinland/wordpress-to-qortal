import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  appendAndSync,
  atomicWriteFile,
  atomicWriteJson,
  readFileIfExists,
  sha256OfJson
} from './atomic.js';
import {
  CURRENT_STORE_VERSION,
  JOURNAL_SCHEMA,
  STATE_MIGRATIONS,
  STATE_SNAPSHOT_SCHEMA,
  assertSupportedStoreVersion,
  createInitialState,
  migrateState,
  normalizeStateShape,
  validateSnapshot,
  validateState
} from './schema.js';
import { QmsError, ERROR_CODES } from '../errors.js';
import { systemClock } from '../clock.js';

const DEFAULT_COMPACT_EVERY = 50;
const DEFAULT_MAX_JOURNAL_BYTES = 2 * 1024 * 1024;

function journalHeader(storeVersion, baseTxnSeq, createdAt) {
  return {
    schema: JOURNAL_SCHEMA,
    formatVersion: 1,
    storeVersion,
    baseTxnSeq,
    createdAt
  };
}

function parseJournal(raw) {
  const records = [];
  let offset = 0;
  let lineNumber = 0;
  let failure = null;
  while (offset < raw.length) {
    const newline = raw.indexOf('\n', offset);
    const lineEnd = newline === -1 ? raw.length : newline;
    const line = raw.slice(offset, lineEnd);
    const nextOffset = newline === -1 ? raw.length : newline + 1;
    lineNumber += 1;
    if (line.trim() !== '') {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        failure = { offset, lineNumber };
        break;
      }
      records.push({ record: parsed, endOffset: nextOffset });
    }
    offset = nextOffset;
  }
  return { records, failure };
}

function hasCommittedTransactionAfter(raw, startOffset) {
  const tail = raw.slice(startOffset);
  const lines = tail.split('\n').slice(1);
  let sawBegin = false;
  let sawState = false;
  for (const line of lines) {
    if (line.trim() === '') {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return false;
    }
    if (parsed.t === 'begin') {
      sawBegin = true;
    } else if (parsed.t === 'state' && sawBegin) {
      sawState = true;
    } else if (parsed.t === 'commit' && sawBegin && sawState) {
      return true;
    }
  }
  return false;
}

/**
 * Append-only journal plus atomic snapshots.
 *
 * Chosen over SQLite for Phase 1 because it is dependency-free (no native
 * module packaging risk in Electron), deterministic to test, and sufficient
 * for the Phase 1 state size. Every committed transaction is a complete,
 * checksummed state record, so recovery only ever replays whole transactions.
 *
 * Invariants:
 * - a transaction is visible only after its commit record is durably written;
 * - the snapshot always describes a state that is a prefix of the journal;
 * - crash recovery discards a torn or uncommitted journal tail, never a
 *   committed transaction;
 * - an unknown newer store version fails closed before any write.
 */
export class JournalStore {
  constructor(options) {
    this.root = options.root;
    this.snapshotFile = options.snapshotFile;
    this.journalFile = options.journalFile;
    this.clock = options.clock ?? systemClock;
    this.guard = options.guard ?? null;
    this.storeVersion = options.storeVersion ?? CURRENT_STORE_VERSION;
    this.compactEveryTransactions = options.compactEveryTransactions ?? DEFAULT_COMPACT_EVERY;
    this.maxJournalBytes = options.maxJournalBytes ?? DEFAULT_MAX_JOURNAL_BYTES;
    this.onBeforeJournalFsync = options.onBeforeJournalFsync ?? null;
    this.logger = options.logger ?? null;
    this.recovery = options.recovery ?? { recovered: false, truncatedBytes: 0, migratedFrom: null };
    this._state = options.state;
    this._lastTxnSeq = options.lastTxnSeq ?? 0;
    this._transactionsSinceSnapshot = 0;
    this._journalBytes = 0;
    this._closed = false;
    this._writeChain = Promise.resolve();
  }

  /**
   * Serialize writers inside one process. The project lock excludes other
   * processes; this excludes interleaved async transactions in the same one.
   */
  async _withWriteLock(fn) {
    const previous = this._writeChain;
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    this._writeChain = previous.then(() => current);
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  get state() {
    return this._state;
  }

  get lastTxnSeq() {
    return this._lastTxnSeq;
  }

  get journalBytes() {
    return this._journalBytes;
  }

  static paths(root, options = {}) {
    return {
      snapshotFile: options.snapshotFile ?? path.join(root, 'snapshot.json'),
      journalFile: options.journalFile ?? path.join(root, 'journal.jsonl')
    };
  }

  /**
   * Open (and if necessary recover) a state store.
   * Fails closed on unknown newer versions without writing anything.
   */
  static async open(options = {}) {
    const root = options.root;
    if (!root) {
      throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'JournalStore.open requires a root directory.');
    }
    const clock = options.clock ?? systemClock;
    const { snapshotFile, journalFile } = JournalStore.paths(root, options);
    const migrations = options.migrations ?? STATE_MIGRATIONS;
    const targetVersion = options.storeVersion ?? CURRENT_STORE_VERSION;

    await mkdir(root, { recursive: true });

    const recovery = {
      recovered: false,
      truncatedBytes: 0,
      migratedFrom: null,
      replayedTransactions: 0,
      discardedTransactions: 0
    };

    let snapshot = null;
    const snapshotRaw = await readFileIfExists(snapshotFile);
    if (snapshotRaw !== null) {
      let parsed;
      try {
        parsed = JSON.parse(snapshotRaw);
      } catch (error) {
        throw new QmsError(ERROR_CODES.STATE_JOURNAL_CORRUPT, `State snapshot is not valid JSON: ${snapshotFile}`, {
          cause: error,
          details: { file: snapshotFile }
        });
      }
      validateSnapshot(parsed, { file: snapshotFile });
      // Fail closed before any migration or write can occur.
      assertSupportedStoreVersion(parsed.storeVersion, { file: snapshotFile });
      snapshot = parsed;
    }

    const journalRaw = await readFileIfExists(journalFile);
    let headerRecord = null;
    if (journalRaw !== null && journalRaw.trim() !== '') {
      const parsed = parseJournal(journalRaw);
      const first = parsed.records[0]?.record;
      if (!first || first.schema !== JOURNAL_SCHEMA) {
        throw new QmsError(ERROR_CODES.STATE_JOURNAL_CORRUPT, `Journal header is missing or invalid: ${journalFile}`, {
          details: { file: journalFile }
        });
      }
      assertSupportedStoreVersion(first.storeVersion, { file: journalFile });
      headerRecord = parsed.records[0];
    }

    let state;
    let storeVersion;
    let lastTxnSeq;
    if (snapshot) {
      state = snapshot.state;
      storeVersion = snapshot.storeVersion;
      lastTxnSeq = snapshot.lastTxnSeq;
    } else {
      const initial = options.initialState ?? createInitialState({
        projectId: options.projectId ?? 'prj_unknown',
        createdAt: clock.nowIso()
      });
      state = normalizeStateShape(structuredClone(initial));
      storeVersion = targetVersion;
      lastTxnSeq = 0;
    }

    if (storeVersion < targetVersion) {
      const migrated = migrateState(state, storeVersion, { migrations, targetVersion });
      state = migrated.state;
      recovery.migratedFrom = storeVersion;
      storeVersion = migrated.storeVersion;
    }
    validateState(state, { file: snapshotFile });

    let lastCommittedOffset = headerRecord ? headerRecord.endOffset : 0;
    if (headerRecord && journalRaw) {
      const parsed = parseJournal(journalRaw);
      let current = null;
      for (const entry of parsed.records.slice(1)) {
        const record = entry.record;
        if (record.t === 'begin') {
          current = {
            txnSeq: record.txnSeq,
            storeVersion: record.storeVersion,
            state: null,
            stateChecksum: null
          };
        } else if (record.t === 'state' && current) {
          current.state = record.state;
          current.stateChecksum = record.checksum;
        } else if (record.t === 'commit' && current && current.state) {
          const expected = sha256OfJson({
            txnSeq: current.txnSeq,
            storeVersion: current.storeVersion,
            state: current.state
          });
          const checksumMatches =
            record.checksum === expected || record.checksum === current.stateChecksum;
          if (!checksumMatches) {
            break;
          }
          if (current.txnSeq > lastTxnSeq) {
            validateState(current.state, { file: journalFile });
            state = current.state;
            lastTxnSeq = current.txnSeq;
            storeVersion = Math.max(storeVersion, current.storeVersion);
            recovery.replayedTransactions += 1;
          }
          lastCommittedOffset = entry.endOffset;
          current = null;
        }
      }

      if (parsed.failure) {
        if (hasCommittedTransactionAfter(journalRaw, parsed.failure.offset)) {
          throw new QmsError(
            ERROR_CODES.STATE_JOURNAL_CORRUPT,
            'State journal is corrupt before a committed transaction; refusing to truncate committed data.',
            { details: { file: journalFile, offset: parsed.failure.offset } }
          );
        }
        recovery.truncatedBytes = journalRaw.length - lastCommittedOffset;
        recovery.recovered = recovery.truncatedBytes > 0;
      } else if (current !== null) {
        // begin/state without a commit: discard the uncommitted tail.
        recovery.truncatedBytes = journalRaw.length - lastCommittedOffset;
        recovery.recovered = recovery.truncatedBytes > 0;
      } else if (lastCommittedOffset < journalRaw.length) {
        // Bytes after the last complete record that are not part of a
        // committed transaction (for example a half-written line without
        // a newline that still parsed as JSON is handled above).
        recovery.truncatedBytes = journalRaw.length - lastCommittedOffset;
        recovery.recovered = recovery.truncatedBytes > 0;
        recovery.discardedTransactions = 1;
      }
    }

    validateState(state, { file: snapshotFile });

    const store = new JournalStore({
      root,
      snapshotFile,
      journalFile,
      clock,
      guard: options.guard ?? null,
      storeVersion,
      compactEveryTransactions: options.compactEveryTransactions,
      maxJournalBytes: options.maxJournalBytes,
      onBeforeJournalFsync: options.onBeforeJournalFsync,
      logger: options.logger,
      state,
      lastTxnSeq,
      recovery
    });

    // Normalize on open: persist a consistent snapshot and a clean journal.
    // This also applies migrations and repairs a crash-damaged tail.
    await store._ensureGuard();
    await store._persistSnapshot();
    await store._rewriteJournal();
    if (recovery.recovered && store.logger) {
      store.logger.warn?.('Recovered project state by discarding an uncommitted journal tail.', {
        file: journalFile,
        discardedBytes: recovery.truncatedBytes
      });
    }
    return store;
  }

  async _ensureGuard() {
    if (this.guard) {
      await this.guard();
    }
  }

  async _rewriteJournal() {
    const header = journalHeader(this.storeVersion, this._lastTxnSeq, this.clock.nowIso());
    const content = `${JSON.stringify(header)}\n`;
    await atomicWriteFile(this.journalFile, content);
    this._journalBytes = Buffer.byteLength(content, 'utf8');
    this._transactionsSinceSnapshot = 0;
  }

  async _persistSnapshot() {
    const snapshot = {
      schema: STATE_SNAPSHOT_SCHEMA,
      formatVersion: 1,
      storeVersion: this.storeVersion,
      lastTxnSeq: this._lastTxnSeq,
      createdAt: this.clock.nowIso(),
      state: this._state
    };
    await atomicWriteJson(this.snapshotFile, snapshot);
  }

  /**
   * Apply a mutation atomically.
   * The mutator receives a deep clone; if it throws, nothing is written.
   */
  async transaction(mutator) {
    return this._withWriteLock(() => this._transaction(mutator));
  }

  async _transaction(mutator) {
    if (this._closed) {
      throw new QmsError(ERROR_CODES.STATE_NOT_OPEN, 'State store is closed.');
    }
    await this._ensureGuard();
    const draft = structuredClone(this._state);
    const result = await mutator(draft);
    draft.updatedAt = this.clock.nowIso();
    validateState(draft, { file: this.journalFile });

    const txnSeq = this._lastTxnSeq + 1;
    const stateChecksum = sha256OfJson({ txnSeq, storeVersion: this.storeVersion, state: draft });
    const lines = [
      JSON.stringify({ t: 'begin', txnSeq, storeVersion: this.storeVersion, at: this.clock.nowIso() }),
      JSON.stringify({ t: 'state', storeVersion: this.storeVersion, state: draft, checksum: stateChecksum }),
      JSON.stringify({ t: 'commit', txnSeq, checksum: stateChecksum, at: this.clock.nowIso() })
    ].join('\n') + '\n';

    // Re-check ownership immediately before the durable append: a long
    // mutation must not outlive its lock and still write.
    await this._ensureGuard();

    if (this.onBeforeJournalFsync) {
      await this.onBeforeJournalFsync({
        txnSeq,
        storeVersion: this.storeVersion,
        journalPath: this.journalFile,
        snapshotPath: this.snapshotFile,
        payload: lines,
        state: structuredClone(draft)
      });
    }

    await appendAndSync(this.journalFile, lines);
    this._journalBytes += Buffer.byteLength(lines, 'utf8');
    this._state = draft;
    this._lastTxnSeq = txnSeq;
    this._transactionsSinceSnapshot += 1;

    if (
      this._transactionsSinceSnapshot >= this.compactEveryTransactions ||
      this._journalBytes >= this.maxJournalBytes
    ) {
      // Already holding the write lock: compact without re-entering it.
      await this._compactUnlocked('threshold');
    }
    return { applied: true, txnSeq, result };
  }

  /** Replace the journal with a fresh snapshot. Safe to interrupt. */
  async compact(options = {}) {
    return this._withWriteLock(async () => {
      if (this._closed) {
        throw new QmsError(ERROR_CODES.STATE_NOT_OPEN, 'State store is closed.');
      }
      return this._compactUnlocked(options.reason ?? 'manual');
    });
  }

  async _compactUnlocked(reason) {
    await this._ensureGuard();
    await this._persistSnapshot();
    await this._rewriteJournal();
    return {
      compacted: true,
      lastTxnSeq: this._lastTxnSeq,
      reason
    };
  }

  async close() {
    this._closed = true;
  }
}
