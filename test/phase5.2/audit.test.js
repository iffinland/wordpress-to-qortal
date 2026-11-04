import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, verifyAuditFile } from '../../broker/src/audit.js';

function withAudit(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'qms-audit-'));
  const path = join(dir, 'audit.jsonl');
  try {
    return fn({ dir, path });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('builds a verifiable hash chain and resumes it', () => {
  withAudit(({ path }) => {
    const log = AuditLog.open({ path, fsync: false, clock: () => 1000 });
    log.append('publication_request', { requestId: 'req_00000001', bytes: 12 });
    log.append('publication_signed', { txRef: 'sig-1', feeAtomic: 100000 });
    log.close();
    assert.equal(verifyAuditFile(path).ok, true);
    assert.equal(verifyAuditFile(path).entries, 2);

    const resumed = AuditLog.open({ path, fsync: false, clock: () => 2000 });
    resumed.append('publication_completed', { state: 'remote_verified' });
    resumed.close();
    const verified = verifyAuditFile(path);
    assert.equal(verified.ok, true);
    assert.equal(verified.entries, 3);
  });
});

test('detects tampering and refuses to append to a corrupt chain', () => {
  withAudit(({ path }) => {
    const log = AuditLog.open({ path, fsync: false, clock: () => 1000 });
    log.append('event_one', { value: 1 });
    log.append('event_two', { value: 2 });
    log.append('event_three', { value: 3 });
    log.close();

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const entry = JSON.parse(lines[1]);
    entry.value = 99;
    lines[1] = JSON.stringify(entry);
    writeFileSync(path, lines.join('\n') + '\n');
    assert.equal(verifyAuditFile(path).ok, false);
    assert.equal(verifyAuditFile(path).code, 'HASH');

    assert.throws(() => AuditLog.open({ path, fsync: false }), (error) => error.code === 'UNAVAILABLE');
  });
});

test('redacts secrets, payload bytes and signatures from audit entries', () => {
  withAudit(({ path }) => {
    const log = AuditLog.open({ path, fsync: false });
    log.append('publication_request', {
      requestId: 'req_00000001',
      dataBase64: 'c2VjcmV0IHBheWxvYWQ=',
      password: 'hunter2',
      walletId: 'wallet',
      token: 'bearer-token',
      signature: 'transaction-signature',
      nested: { privateKey: 'key-material', note: 'ok' }
    });
    log.close();
    const raw = readFileSync(path, 'utf8');
    for (const secret of ['c2VjcmV0IHBheWxvYWQ=', 'hunter2', 'bearer-token', 'transaction-signature', 'key-material']) {
      assert.equal(raw.includes(secret), false, secret + ' leaked into the audit log');
    }
    assert.equal(raw.includes('[redacted]'), true);
    assert.equal(verifyAuditFile(path).ok, true);
  });
});
