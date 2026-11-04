import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateQortalName,
  checkQortalName,
  normalizeQortalName,
  utf8ByteLength,
  QORTAL_NAME_MAX_BYTES,
  QORTAL_NAME_MIN_BYTES
} from '../../lib/engine/identity.js';
import {
  assertHandoffManifest,
  sealDocument,
  sha256Bytes
} from '../../lib/engine/publication/index.js';
import { qdnPathSegment, verifyNameOwnership } from '../../lib/engine/publication/remote.js';
import { evaluateNameOwnership } from '../../viewer/src/publisher/ownership.ts';
import { checkQortalName as desktopCheck } from '../../desktop/src/shared/qortalName.ts';
import { checkQortalName as viewerCheck } from '../../viewer/src/publisher/name.ts';
import {
  integrityOf as viewerIntegrityOf,
  sha256Bytes as viewerSha256Bytes,
  validateHandoffPackage
} from '../../viewer/src/publisher/handoff.ts';
import { startQdnServer } from '../../test-support/phase5/qdnServer.js';

const OWNER = 'QipPqwJeLtx89dXcSkY7vimMUNT8Gy5k2E';

function manifestWith({ targetName = 'developer iffi', resourceName = targetName } = {}) {
  return sealDocument({
    schema: 'qms-publication-handoff@1',
    version: 1,
    handoffId: 'hof_abcdefgh12345678',
    publicationBatchId: 'pub_abcdefgh12345678',
    planId: 'plan_abcdefgh',
    projectId: 'prj_demo-project',
    siteId: 'site_' + 'a'.repeat(32),
    siteNamespace: 'ns' + 'a'.repeat(14),
    createdAt: '2026-11-03T00:00:00.000Z',
    target: { qdnName: targetName, resourcePrefix: 'qms' },
    estimate: {
      resourceCount: 1,
      feePerResource: 0.01,
      estimatedFee: 0.01,
      currency: 'QORT',
      label: 'Estimate only',
      batches: 1
    },
    resources: [{
      id: 'res_abcdefgh12345678',
      kind: 'content',
      service: 'DOCUMENT',
      name: resourceName,
      identifier: 'qms-ns-abcdefgh',
      relativePath: 'payload/content/abc.json',
      contentType: 'application/json; charset=utf-8',
      bytes: 1,
      sha256: sha256Bytes(Buffer.from('x')),
      order: 0,
      dependsOn: []
    }]
  });
}

test('the confirmed registered name "developer iffi" is accepted and preserved exactly', () => {
  assert.equal(validateQortalName('developer iffi'), 'developer iffi');
  for (const check of [checkQortalName, desktopCheck, viewerCheck]) {
    const result = check('developer iffi');
    assert.equal(result.ok, true);
    assert.equal(result.name, 'developer iffi');
  }
  assert.equal(normalizeQortalName('developer iffi'), 'developer iffi');
});

test('Unicode names follow Core NFKC display rules', () => {
  for (const name of ['Café', '日本語', 'ab😀', 'aé']) {
    for (const check of [checkQortalName, desktopCheck, viewerCheck]) {
      assert.equal(check(name).ok, true, name);
    }
    assert.equal(validateQortalName(name), name);
  }
  // Decomposed and compatibility forms are not the registered display form.
  for (const name of ['Cafe\u0301', 'ＡＢＣ', '①', 'ab\u200Bc']) {
    for (const check of [checkQortalName, desktopCheck, viewerCheck]) {
      assert.equal(check(name).ok, false, name);
      assert.equal(check(name).code, 'TARGET_NAME_NOT_NORMALIZED', name);
    }
  }
});

test('UTF-8 byte length, not JavaScript code-unit length, is enforced', () => {
  assert.equal(QORTAL_NAME_MIN_BYTES, 3);
  assert.equal(QORTAL_NAME_MAX_BYTES, 40);
  assert.equal(validateQortalName('x'.repeat(40)), 'x'.repeat(40));
  assert.throws(() => validateQortalName('x'.repeat(41)), (error) => error.details.reason === 'TARGET_NAME_BYTE_LENGTH');
  assert.equal(validateQortalName('é'.repeat(20)), 'é'.repeat(20));
  assert.equal(utf8ByteLength('é'.repeat(20)), 40);
  assert.throws(() => validateQortalName('é'.repeat(21)), (error) => error.details.reason === 'TARGET_NAME_BYTE_LENGTH');
  assert.throws(() => validateQortalName('日'.repeat(14)), (error) => error.details.reason === 'TARGET_NAME_BYTE_LENGTH');
  assert.throws(() => validateQortalName('ab'), (error) => error.details.reason === 'TARGET_NAME_BYTE_LENGTH');
  assert.equal(validateQortalName('aé'), 'aé');
});

test('leading/trailing whitespace, collapsed whitespace, controls and addresses are rejected', () => {
  const rejected = [
    [' developer iffi', 'TARGET_NAME_NOT_NORMALIZED'],
    ['developer iffi ', 'TARGET_NAME_NOT_NORMALIZED'],
    ['developer  iffi', 'TARGET_NAME_NOT_NORMALIZED'],
    ['developer\tiffi', 'TARGET_NAME_NOT_NORMALIZED'],
    ['developer\niffi', 'TARGET_NAME_NOT_NORMALIZED'],
    ['developer\u0001iffi', 'TARGET_NAME_CONTROL'],
    ['ab\uD800', 'TARGET_NAME_UNPAIRED_SURROGATE'],
    [OWNER, 'TARGET_NAME_ADDRESS']
  ];
  for (const [name, code] of rejected) {
    for (const check of [checkQortalName, desktopCheck, viewerCheck]) {
      assert.equal(check(name).ok, false, name);
      assert.equal(check(name).code, code, name);
    }
  }
});

test('exact display names and reducedName are distinct; reducedName is never identity', async (t) => {
  assert.notEqual(normalizeQortalName('Developer Iffi'), 'developer iffi');
  const qdn = await startQdnServer({
    names: [{ name: 'developer iffi', owner: OWNER, reducedName: 'developer iffi', data: '' }]
  });
  t.after(() => qdn.close());
  const result = await verifyNameOwnership({
    fetchImpl: fetch,
    nodeUrl: qdn.url,
    name: 'developer iffi',
    ownerAddress: OWNER
  });
  assert.equal(result.state, 'verified');
  assert.equal(result.name, 'developer iffi');
  assert.equal(result.ownerAddress, OWNER);
  assert.equal(result.reducedName, 'developer iffi');
  assert.ok(qdn.requests.includes('/names/developer%20iffi'));
  assert.ok(qdn.requests.every((url) => !url.includes('+') && !url.includes('%2520')));
});

test('ownership lookup blocks mismatch, wrong owner, missing name and unreachable nodes', async (t) => {
  const qdn = await startQdnServer({ names: [] });
  t.after(() => qdn.close());

  qdn.setName({ lookupName: 'developer iffi', name: 'Developer Iffi', owner: OWNER, reducedName: 'developer iffi' });
  const wrongDisplay = await verifyNameOwnership({
    fetchImpl: fetch, nodeUrl: qdn.url, name: 'developer iffi', ownerAddress: OWNER
  });
  assert.equal(wrongDisplay.state, 'blocked');
  assert.equal(wrongDisplay.code, 'NAME_MISMATCH');
  assert.equal(wrongDisplay.name, 'developer iffi');

  qdn.setName({ name: 'developer iffi', owner: 'QZLJV7wbaFyxaoZQsjm6rb9MWMiDzWsqM2', reducedName: 'developer iffi' });
  const wrongOwner = await verifyNameOwnership({
    fetchImpl: fetch, nodeUrl: qdn.url, name: 'developer iffi', ownerAddress: OWNER
  });
  assert.equal(wrongOwner.state, 'blocked');
  assert.equal(wrongOwner.code, 'OWNER_MISMATCH');

  qdn.removeName('developer iffi');
  const missing = await verifyNameOwnership({
    fetchImpl: fetch, nodeUrl: qdn.url, name: 'developer iffi', ownerAddress: OWNER
  });
  assert.equal(missing.state, 'blocked');
  assert.equal(missing.code, 'NAME_NOT_FOUND');

  const unreachable = await verifyNameOwnership({
    fetchImpl: async () => { throw new Error('offline'); },
    nodeUrl: 'http://127.0.0.1:1',
    name: 'developer iffi',
    ownerAddress: OWNER
  });
  assert.equal(unreachable.state, 'blocked');
  assert.equal(unreachable.code, 'NODE_UNREACHABLE');
});

test('Publisher ownership requires the exact registered name and owning address', () => {
  const exact = evaluateNameOwnership({
    targetName: 'developer iffi',
    accountAddress: OWNER,
    ownedNames: [{ name: 'developer iffi', owner: OWNER }]
  });
  assert.equal(exact.state, 'verified');

  for (const ownedNames of [
    [{ name: 'Developer Iffi', owner: OWNER }],
    [{ name: 'developer iffi', owner: 'QZLJV7wbaFyxaoZQsjm6rb9MWMiDzWsqM2' }],
    [{ name: 'developer iffi', owner: '' }]
  ]) {
    const result = evaluateNameOwnership({ targetName: 'developer iffi', accountAddress: OWNER, ownedNames });
    assert.equal(result.state, 'blocked');
  }
});

test('handoff validation accepts spaces and rejects invalid or mismatched names', () => {
  assert.equal(assertHandoffManifest(manifestWith()), true);

  const invalid = manifestWith();
  invalid.target.qdnName = 'developer  iffi';
  invalid.integrity = { algorithm: 'sha256', value: '' };
  const invalidSealed = sealDocument(invalid);
  assert.throws(() => assertHandoffManifest(invalidSealed), (error) => error.code === 'PUBLICATION_HANDOFF_INVALID');

  const mismatch = manifestWith({ resourceName: 'other name' });
  assert.throws(() => assertHandoffManifest(mismatch), (error) => error.code === 'PUBLICATION_HANDOFF_INVALID');
});

test('Publisher Q-App handoff validation accepts exact spaces and rejects invalid or mismatched names', async () => {
  async function sealViewer(value) {
    const clone = structuredClone(value);
    delete clone.integrity;
    clone.integrity = { algorithm: 'sha256', value: await viewerIntegrityOf(clone) };
    return clone;
  }
  const payload = new TextEncoder().encode('{"ok":true}');
  const payloadSha = await viewerSha256Bytes(payload);
  const base = {
    schema: 'qms-publication-handoff@1',
    version: 1,
    handoffId: 'hof_abcdefgh12345678',
    publicationBatchId: 'pub_abcdefgh12345678',
    planId: 'plan_abcdefgh',
    projectId: 'prj_demo-project',
    siteId: 'site_' + 'a'.repeat(32),
    siteNamespace: 'ns' + 'a'.repeat(14),
    createdAt: '2026-11-03T00:00:00.000Z',
    target: { qdnName: 'developer iffi', resourcePrefix: 'qms' },
    estimate: {
      resourceCount: 1,
      feePerResource: 0.01,
      estimatedFee: 0.01,
      currency: 'QORT',
      label: 'Estimate only',
      batches: 1
    },
    resources: [{
      id: 'res_abcdefgh12345678',
      kind: 'content',
      service: 'DOCUMENT',
      name: 'developer iffi',
      identifier: 'qms-ns-abcdefgh',
      relativePath: 'payload/content/abc.json',
      contentType: 'application/json; charset=utf-8',
      bytes: payload.length,
      sha256: payloadSha,
      order: 0,
      dependsOn: []
    }]
  };
  const manifest = await sealViewer(base);
  const raw = new TextEncoder().encode(JSON.stringify(manifest));
  const files = new Map([
    ['handoff.json', { path: 'handoff.json', file: new File([raw], 'handoff.json'), bytes: raw }],
    ['payload/content/abc.json', {
      path: 'payload/content/abc.json',
      file: new File([payload], 'abc.json'),
      bytes: payload
    }]
  ]);
  const validated = await validateHandoffPackage(files);
  assert.equal(validated.manifest.target.qdnName, 'developer iffi');

  for (const [targetName, resourceName] of [
    ['developer  iffi', 'developer  iffi'],
    ['developer iffi', 'other name'],
    [' padded', ' padded']
  ]) {
    const changed = structuredClone(base);
    changed.target.qdnName = targetName;
    changed.resources[0].name = resourceName;
    const changedManifest = await sealViewer(changed);
    const changedRaw = new TextEncoder().encode(JSON.stringify(changedManifest));
    const changedFiles = new Map(files);
    changedFiles.set('handoff.json', { path: 'handoff.json', file: new File([changedRaw], 'handoff.json'), bytes: changedRaw });
    await assert.rejects(() => validateHandoffPackage(changedFiles), (error) => /Qortal names|does not match/.test(error.message));
  }
});

test('URL path segments encode spaces as %20, never + and never double-encode', () => {
  assert.equal(qdnPathSegment('developer iffi'), 'developer%20iffi');
  assert.equal(qdnPathSegment('Café'), 'Caf%C3%A9');
  assert.equal(qdnPathSegment('a+b'), 'a%2Bb');
  assert.equal(qdnPathSegment('100% name'), '100%25%20name');
  for (const name of ['developer iffi', 'Café', 'a+b', '100% name']) {
    const encoded = qdnPathSegment(name);
    assert.equal(encoded.includes('+'), false);
    assert.equal(decodeURIComponent(encoded), name);
  }
});
