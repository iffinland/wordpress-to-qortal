import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicationRequest } from '../../broker/src/policy.js';
import { sealDocument, HANDOFF_SCHEMA } from '../../lib/engine/publication/handoff.js';
import { makeConfig, makeRequest, makeResource, NAME, OWNER } from './support/harness.js';

function rejects(body, code, overrides = {}, message = null) {
  const config = makeConfig(overrides);
  assert.throws(
    () => validatePublicationRequest({ body, config }),
    (error) => {
      assert.equal(error.code, code, message ?? ('expected ' + code + ', got ' + error.code + ': ' + error.message));
      return true;
    }
  );
}

function accepts(body, overrides = {}) {
  return validatePublicationRequest({ body, config: makeConfig(overrides) });
}

test('accepts a valid DOCUMENT request for the exact test name', () => {
  const body = makeRequest();
  const normalized = accepts(body);
  assert.equal(normalized.targetName, NAME);
  assert.equal(normalized.ownerAddress, OWNER);
  assert.equal(normalized.resources.length, 1);
  assert.equal(normalized.resources[0].service, 'DOCUMENT');
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'totalFeeAtomic'), false);
  assert.equal(normalized.handoffId, null);
});

test('rejects a different or non-exact target name', () => {
  for (const name of ['Developer iffi', 'developer iffi ', ' developer iffi', 'developer  iffi', 'developer-iffi', 'other name']) {
    const body = makeRequest();
    body.target.name = name;
    rejects(body, 'POLICY_NAME');
  }
});

test('rejects a different owner address', () => {
  const body = makeRequest();
  body.target.ownerAddress = 'Qaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  rejects(body, 'POLICY_OWNER');
});

test('rejects non-DOCUMENT services', () => {
  for (const service of ['IMAGE', 'JSON', 'FILE', 'AUDIO', 'DOCUMENT_PRIVATE', '']) {
    const body = makeRequest();
    body.resources[0].service = service;
    rejects(body, 'POLICY_SERVICE');
  }
});

test('rejects identifiers outside the development prefix', () => {
  for (const identifier of ['hello-world', 'qms-prod-hello', 'qms-dev-']) {
    const body = makeRequest();
    body.resources[0].identifier = identifier;
    rejects(body, 'POLICY_IDENTIFIER');
  }
  for (const identifier of ['QMS-DEV-hello', 'qms-dev-../escape', 'qms-dev-a/b', 'qms-dev-..', 'qms-dev-a b']) {
    const body = makeRequest();
    body.resources[0].identifier = identifier;
    rejects(body, 'INVALID_REQUEST');
  }
});

test('rejects unsupported content types', () => {
  for (const type of ['image/png', 'application/pdf', 'text/plain; charset=utf-8', 'application/octet-stream']) {
    const body = makeRequest();
    body.resources[0].contentType = type;
    rejects(body, 'POLICY_CONTENT_TYPE');
  }
});

test('rejects oversized payloads and aggregate byte limits', () => {
  const body = makeRequest();
  body.resources[0].dataBase64 = Buffer.from('x'.repeat(40)).toString('base64');
  body.resources[0].bytes = 40;
  body.resources[0].sha256 = 'sha256:' + '0'.repeat(64);
  rejects(body, 'HASH_MISMATCH');
  const small = makeRequest({ resources: [makeResource({ content: '0123456789' })] });
  rejects(small, 'PAYLOAD_TOO_LARGE', { policy: { maxPayloadBytes: 9 } });
  const aggregate = makeRequest({
    resources: [
      makeResource({ content: '1234567890' }),
      makeResource({ content: '1234567890' })
    ]
  });
  rejects(aggregate, 'PAYLOAD_TOO_LARGE', { policy: { maxTotalBytesPerRequest: 10 } });
});

test('rejects too many resources', () => {
  const resources = [makeResource(), makeResource(), makeResource()];
  rejects(makeRequest({ resources }), 'TOO_MANY_RESOURCES', { policy: { maxResourcesPerRequest: 2, maxTransactionsPerRequest: 2 } });
});

test('rejects duplicate resource ids and QDN triples', () => {
  const first = makeResource();
  const second = makeResource();
  second.id = first.id;
  rejects(makeRequest({ resources: [first, second] }), 'INVALID_REQUEST');

  const third = makeResource();
  const fourth = makeResource({ identifier: third.identifier });
  rejects(makeRequest({ resources: [third, fourth] }), 'INVALID_REQUEST');
});

test('rejects any client-supplied fee field because fees are derived by the broker', () => {
  rejects(makeRequest({ fees: { currency: 'QORT', feePerTransaction: 0.01 } }), 'INVALID_REQUEST');
  rejects(makeRequest({ fees: { currency: 'QORT', feePerTransaction: 0.001 } }), 'INVALID_REQUEST');
  rejects(makeRequest({ feePerTransaction: 0.01 }), 'INVALID_REQUEST');
  rejects(makeRequest({ maxFee: '5' }), 'INVALID_REQUEST');
});

test('rejects modified payload bytes, wrong byte counts and malformed base64', () => {
  const body = makeRequest();
  const bytes = Buffer.from(body.resources[0].dataBase64, 'base64');
  bytes[0] ^= 0xff;
  body.resources[0].dataBase64 = bytes.toString('base64');
  rejects(body, 'HASH_MISMATCH');

  const wrongBytes = makeRequest();
  wrongBytes.resources[0].bytes += 1;
  rejects(wrongBytes, 'HASH_MISMATCH');

  const badBase64 = makeRequest();
  badBase64.resources[0].dataBase64 = 'not base64!!';
  rejects(badBase64, 'INVALID_REQUEST');

  const unpadded = makeRequest();
  unpadded.resources[0].dataBase64 = unpadded.resources[0].dataBase64.replace(/=+$/, '');
  rejects(unpadded, 'INVALID_REQUEST');
});

test('rejects signing, wallet and node fields at the request boundary', () => {
  for (const field of ['nodeUrl', 'walletId', 'password', 'unsignedBytes', 'privateKey', 'seedPhrase']) {
    const body = makeRequest();
    body[field] = 'attacker-controlled';
    rejects(body, 'INVALID_REQUEST');
  }
  const nested = makeRequest();
  nested.target.walletId = 'wallet';
  rejects(nested, 'INVALID_REQUEST');
  const resourceField = makeRequest();
  resourceField.resources[0].nodeUrl = 'http://evil.example';
  rejects(resourceField, 'INVALID_REQUEST');
});

test('rejects wrong schema and malformed identifiers', () => {
  rejects(makeRequest({ schema: 'qms-test-publication-request@1' }), 'INVALID_REQUEST');
  rejects(makeRequest({ schema: 'qms-test-publication-request@3' }), 'INVALID_REQUEST');
  rejects(makeRequest({ requestId: 'req_bad' }), 'INVALID_REQUEST');
  rejects(makeRequest({ projectId: 'project' }), 'INVALID_REQUEST');
  rejects(makeRequest({ requestId: 'req_ABCDEFGH' }), 'INVALID_REQUEST');
});

function handoffFor(body) {
  const resource = body.resources[0];
  return sealDocument({
    schema: HANDOFF_SCHEMA,
    version: 1,
    handoffId: 'hof_test1234',
    publicationBatchId: 'pub_test1234',
    planId: 'plan_test1234',
    projectId: body.projectId,
    siteId: 'site_' + 'a'.repeat(20),
    siteNamespace: 'ns' + 'b'.repeat(10),
    target: { qdnName: NAME, resourcePrefix: 'qms' },
    estimate: {
      label: 'test estimate',
      resourceCount: 1,
      currency: 'QORT',
      feePerResource: 0.001,
      estimatedFee: 0.001
    },
    resources: [{
      id: resource.id,
      kind: 'content',
      service: resource.service,
      name: NAME,
      identifier: resource.identifier,
      relativePath: 'payload/resource.txt',
      contentType: resource.contentType,
      bytes: resource.bytes,
      sha256: resource.sha256,
      order: 0,
      dependsOn: []
    }],
    createdAt: '2026-11-03T10:00:00.000Z'
  });
}

test('accepts a sealed handoff whose identity and hashes match', () => {
  const body = makeRequest();
  body.handoff = handoffFor(body);
  const normalized = accepts(body);
  assert.equal(normalized.handoffId, 'hof_test1234');
});

test('rejects a handoff with a broken integrity seal or mismatched identity', () => {
  const body = makeRequest();
  const handoff = handoffFor(body);
  handoff.projectId = 'prj_other-project';
  rejects({ ...body, handoff }, 'HANDOFF_INVALID');

  const second = makeRequest();
  const mismatched = handoffFor(second);
  mismatched.resources[0].sha256 = 'sha256:' + '1'.repeat(64);
  rejects({ ...second, handoff: mismatched }, 'HANDOFF_INVALID');

  const third = makeRequest();
  const wrongProject = handoffFor(third);
  rejects({ ...third, projectId: 'prj_other-project', handoff: wrongProject }, 'HANDOFF_INVALID');
});
