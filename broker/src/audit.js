import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson, redactForAudit } from './util.js';
import { BrokerError, BROKER_ERROR } from './errors.js';

export const AUDIT_SCHEMA = 'qms-test-broker-audit@1';
const GENESIS = 'genesis';

function hashEntry(entry) {
  const clone = { ...entry };
  delete clone.hash;
  return 'sha256:' + createHash('sha256').update(canonicalJson(clone), 'utf8').digest('hex');
}

function parseLines(raw) {
  return raw.split('\n').filter((line) => line.trim() !== '');
}

/**
 * Append-only, hash-chained JSONL ledger. It is written by the broker process
 * into a directory outside the development agent's write scope. Application
 * logs are not a substitute for this ledger.
 */
export class AuditLog {
  constructor({ path, clock = () => Date.now(), fsync = true }) {
    this.path = path;
    this.clock = clock;
    this.fsync = fsync;
    this.seq = 0;
    this.prev = GENESIS;
    this.fd = null;
  }

  static open(options) {
    const log = new AuditLog(options);
    log.init();
    return log;
  }

  init() {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    if (existsSync(this.path)) {
      const raw = readFileSync(this.path, 'utf8');
      const lines = parseLines(raw);
      if (lines.length > 0) {
        const verified = verifyAuditFile(this.path);
        if (!verified.ok) {
          throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'Audit log hash chain is invalid (' + verified.code + '); refusing to append.');
        }
        let last;
        try {
          last = JSON.parse(lines[lines.length - 1]);
        } catch {
          throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'Audit log tail is corrupt; refusing to append.');
        }
        this.seq = last.seq;
        this.prev = last.hash;
      }
    }
    this.fd = openSync(this.path, 'a', 0o600);
  }

  append(event, fields = {}) {
    if (typeof event !== 'string' || event.length === 0 || event.length > 120) {
      throw new Error('audit event name is invalid');
    }
    this.seq += 1;
    const entry = {
      schema: AUDIT_SCHEMA,
      seq: this.seq,
      at: new Date(this.clock()).toISOString(),
      prev: this.prev,
      event,
      ...redactForAudit(fields)
    };
    entry.hash = hashEntry(entry);
    const line = JSON.stringify(entry) + '\n';
    writeSync(this.fd, line);
    if (this.fsync) fsyncSync(this.fd);
    this.prev = entry.hash;
    return entry;
  }

  close() {
    if (this.fd !== null) {
      closeSync(this.fd);
      this.fd = null;
    }
  }
}

export function verifyAuditFile(path) {
  const lines = parseLines(readFileSync(path, 'utf8'));
  let prev = GENESIS;
  let seq = 0;
  for (const line of lines) {
    const entry = JSON.parse(line);
    if (entry.schema !== AUDIT_SCHEMA) return { ok: false, code: 'SCHEMA', seq: entry.seq };
    if (entry.seq !== seq + 1) return { ok: false, code: 'SEQ', seq: entry.seq };
    if (entry.prev !== prev) return { ok: false, code: 'PREV', seq: entry.seq };
    if (hashEntry(entry) !== entry.hash) return { ok: false, code: 'HASH', seq: entry.seq };
    prev = entry.hash;
    seq = entry.seq;
  }
  return { ok: true, entries: seq, head: prev };
}
