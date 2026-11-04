import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { startPhase8, discoverAndPlan, downloadAll, selectionFor, preparePublishVerify } from './support.js';
import { assertSafeBundle, buildBundleDocument } from '../../lib/engine/diagnostics.js';
import { assertNoSecretText, auditChecksum, validateAuditEntry } from '../../lib/engine/history.js';
import { sha256OfJson } from '../../lib/engine/storage/atomic.js';

test('AC8.6 the support bundle contains no secrets, cookies, keys, addresses or content bodies', async (t) => {
  const env = await startPhase8(t);
  const { plan } = await discoverAndPlan(env, { batchSize: 2 });
  await downloadAll(env, plan.planId);
  await preparePublishVerify(t, env, { plan, selection: selectionFor(plan) });
  const canaries = [
    'CANARY-TOKEN-9f2c18',
    'CANARY-PASS-4d1e77',
    'CANARY-KEYRING-7b3a55',
    'CANARY-BODY-1c9f02',
    'CANARY-AUTH-88aa11'
  ];
  const exported = await env.handle.supportBundle({
    dataRoot: env.dataRoot,
    appInfo: { name: 'Qortal Migration Studio', version: '0.6.0', apiToken: canaries[0] },
    settings: {
      theme: 'dark',
      sourcePassword: canaries[1],
      content: '<p>' + canaries[3] + '</p>',
      nested: { authorization: 'Bearer ' + canaries[4] }
    },
    keyring: { status: 'locked', seed: canaries[2], accountAddress: 'QZLJV7wbaFyxaoZQsjm6rb9MWMiDzWsqM2' },
    logLines: ['opened project', 'ignored header Bearer ' + canaries[4]],
    canaries
  });
  assert.equal(exported.schema, 'qms-support-bundle@1');
  assert.ok(exported.bytes > 0);
  assert.ok(exported.path.startsWith(path.join(env.dataRoot, 'exports')));
  const info = await stat(exported.path);
  assert.equal(info.mode & 0o777, 0o600);
  const raw = await readFile(exported.path, 'utf8');
  for (const canary of canaries) {
    assert.equal(raw.includes(canary), false, 'bundle must not contain ' + canary);
  }
  assert.equal(/Q[1-9A-HJ-NP-Za-km-z]{40,60}/.test(raw), false, 'bundle must not contain wallet addresses');
  const bundle = JSON.parse(raw);
  assert.equal(bundle.schema, 'qms-support-bundle@1');
  assert.ok(bundle.project && bundle.project.name);
  assert.ok(bundle.stateHealth);
  assert.ok(bundle.recovery?.schema === 'qms-recovery-status@1');
  assert.ok(bundle.history?.summary);
  assert.ok(Array.isArray(bundle.cleanup));
  assert.equal(bundle.settings.theme, 'dark');
  assert.equal(bundle.settings.sourcePassword, '[redacted]');
  assert.equal(bundle.settings.content, '[content-body-excluded]');
  assert.equal(bundle.keyring.seed, '[redacted]');
  assert.equal(bundle.keyring.accountAddress, '[redacted-address]');
  assert.doesNotThrow(() => assertSafeBundle(bundle, { canaries }));
});

test('the support bundle refuses a leaked canary or credential pattern instead of writing it', async () => {
  assert.throws(
    () => assertSafeBundle({ schema: 'qms-support-bundle@1', note: 'leak CANARY-LEAK-123456' }, { canaries: ['CANARY-LEAK-123456'] }),
    (error) => error.code === 'DIAGNOSTICS_UNSAFE'
  );
  assert.throws(
    () => assertSafeBundle({ schema: 'qms-support-bundle@1', note: 'Authorization: Bearer abcdefghijklmnop' }),
    (error) => error.code === 'DIAGNOSTICS_UNSAFE'
  );
  assert.throws(
    () => assertSafeBundle({ schema: 'qms-support-bundle@1', body: 'raw content must never be here' }),
    (error) => error.code === 'DIAGNOSTICS_UNSAFE'
  );
  const clean = await buildBundleDocument({ handle: null }).catch(() => null);
  assert.equal(clean, null);
});

test('audit ledger entries are hash-chained and reject credential-like text', async (t) => {
  const env = await startPhase8(t);
  await env.handle.source.discover({ perPage: 50 });
  const entries = await env.handle.history.entries({ limit: 100 });
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    validateAuditEntry(entry);
    assert.equal(entry.checksum, auditChecksum({ prev: entry.prev, entry }));
  }
  await assert.rejects(
    () => env.handle.history.record({ type: 'run_started', details: { note: 'password=super-secret-value' } }),
    (error) => error.code === 'DIAGNOSTICS_UNSAFE'
  );
  assert.throws(
    () => assertNoSecretText({ token: 'Bearer abcdefghijklmnop' }),
    (error) => error.code === 'DIAGNOSTICS_UNSAFE'
  );
});

test('history snapshots are sealed and independently verifiable', async (t) => {
  const env = await startPhase8(t);
  await env.handle.source.discover({ perPage: 50 });
  const snapshot = await env.handle.history.snapshot({ reason: 'test-export' });
  const document = await env.handle.history.readSnapshot(snapshot.relativePath);
  const integrity = document.integrity;
  const clone = { ...document };
  delete clone.integrity;
  assert.equal(integrity.algorithm, 'sha256');
  assert.equal(integrity.value, sha256OfJson(clone));
  assert.ok(Array.isArray(document.entries));
  await assert.rejects(
    () => env.handle.history.readSnapshot('../outside.json'),
    (error) => error.code === 'PATH_ESCAPE'
  );
});

