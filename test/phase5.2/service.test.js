import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { verifyAuditFile } from '../../broker/src/audit.js';
import { makeRequest, makeResource, createTestBroker } from './support/harness.js';

function publish(harness, body) {
  return harness.broker.publish({
    body,
    rawBody: Buffer.from(JSON.stringify(body), 'utf8'),
    keyId: 'agent-test'
  });
}

async function withBroker(overrides, fn) {
  const harness = await createTestBroker(overrides);
  try {
    return await fn(harness);
  } finally {
    harness.cleanup();
  }
}

function expectCode(promise, code) {
  return assert.rejects(promise, (error) => {
    assert.equal(error.code, code, 'expected ' + code + ', got ' + error.code + ': ' + error.message);
    return true;
  });
}

test('publishes, charges the budget and verifies exact bytes', async () => {
  await withBroker({}, async (harness) => {
    const body = makeRequest();
    const result = await publish(harness, body);
    assert.equal(result.state, 'remote_verified');
    assert.equal(result.decision, 'verified');
    assert.equal(result.chargedAtomic, 1000000);
    assert.equal(result.resources[0].state, 'remote_verified');
    assert.ok(result.resources[0].txRef);
    assert.equal(harness.backend.calls.length, 1);
    assert.deepEqual(harness.node.published(), [body.resources[0].identifier]);
    const snapshot = harness.state.snapshot();
    assert.equal(snapshot.budget.spentAtomic, 1000000);
    assert.deepEqual(snapshot.budget.reservations, {});
    assert.equal(verifyAuditFile(harness.config.audit.path).ok, true);
    const auditText = readFileSync(harness.config.audit.path, 'utf8');
    for (const event of ['publication_request', 'publication_reserved', 'publication_signed', 'publication_charged', 'publication_verification', 'publication_completed']) {
      assert.equal(auditText.includes('"' + event + '"'), true, 'missing audit event ' + event);
    }
    assert.equal(auditText.includes('"txRef":'), true);
    assert.equal(auditText.includes('"chargedAtomic":1000000'), true);
    assert.equal(auditText.includes('REMOTE_VERIFIED'), false);
    assert.equal(auditText.includes('remote_verified'), true);
  });
});

test('rejects an existing resource identity unless controlled updates are authorized', async () => {
  const body = makeRequest();
  await withBroker({}, async (harness) => {
    harness.node.put(body.resources[0].identifier, Buffer.from('already there'));
    await expectCode(publish(harness, body), 'RESOURCE_EXISTS');
    assert.equal(harness.backend.calls.length, 0);
    assert.equal(harness.state.snapshot().budget.spentAtomic, 0);
  });

  await withBroker({ policy: { allowResourceUpdates: true } }, async (harness) => {
    harness.node.put(body.resources[0].identifier, Buffer.from('old bytes'));
    const result = await publish(harness, body);
    assert.equal(result.updateExisting, true);
    assert.equal(result.state, 'remote_verified');
    assert.equal(harness.node.resources.get(body.resources[0].identifier).toString('utf8'), 'hello qdn test');
  });
});

test('preserves a pending signing outcome without resubmitting it', async () => {
  await withBroker({ backendResults: [{ state: 'pending', code: 'APPROVAL_PENDING' }] }, async (harness) => {
    const body = makeRequest();
    const result = await publish(harness, body);
    assert.equal(result.state, 'pending_confirmation');
    assert.equal(result.decision, 'pending');
    assert.equal(result.chargedAtomic, 1000000);
    assert.equal(harness.backend.calls.length, 1);

    const replay = await publish(harness, body);
    assert.equal(replay.publicationId, result.publicationId);
    assert.equal(harness.backend.calls.length, 1);

    const other = makeRequest({ resources: [makeResource({ identifier: body.resources[0].identifier })] });
    await expectCode(publish(harness, other), 'RESOURCE_PENDING');
    assert.equal(harness.backend.calls.length, 1);
  });
});

test('records a failed signature, releases budget and allows a later new request', async () => {
  await withBroker({ backendResults: [{ state: 'failed', code: 'WALLET_LOCKED' }] }, async (harness) => {
    const body = makeRequest();
    const failed = await publish(harness, body);
    assert.equal(failed.state, 'failed');
    assert.equal(failed.chargedAtomic, 0);
    assert.equal(harness.state.snapshot().budget.spentAtomic, 0);

    const retry = makeRequest({ resources: [makeResource({ identifier: body.resources[0].identifier })] });
    const result = await publish(harness, retry);
    assert.equal(result.state, 'remote_verified');
    assert.equal(harness.backend.calls.length, 2);
  });
});

test('keeps an ambiguous signing outcome locked and never retries it', async () => {
  await withBroker({ backendResults: [{ state: 'ambiguous', code: 'SIGNING_TRANSPORT_UNKNOWN' }] }, async (harness) => {
    const body = makeRequest();
    const result = await publish(harness, body);
    assert.equal(result.state, 'ambiguous');
    assert.equal(result.chargedAtomic, 1000000);
    assert.equal(harness.backend.calls.length, 1);

    const replay = await publish(harness, body);
    assert.equal(replay.publicationId, result.publicationId);
    const other = makeRequest({ resources: [makeResource({ identifier: body.resources[0].identifier })] });
    await expectCode(publish(harness, other), 'RESOURCE_PENDING');
    assert.equal(harness.backend.calls.length, 1);
  });
});

test('preserves a read-back mismatch as ambiguous without resubmission', async () => {
  await withBroker({ backendResults: [{ state: 'signed', corruptRemote: true }] }, async (harness) => {
    const body = makeRequest();
    const result = await publish(harness, body);
    assert.equal(result.state, 'ambiguous');
    assert.equal(result.resources[0].verification.code, 'READBACK_MISMATCH');
    assert.equal(harness.backend.calls.length, 1);

    const revalidated = await harness.broker.revalidate(result.publicationId, 'agent-test');
    assert.equal(revalidated.state, 'ambiguous');
    assert.equal(harness.backend.calls.length, 1);
  });
});

test('rejects cumulative fee budget exhaustion and never overspends', async () => {
  await withBroker({ policy: { budgetQort: '0.015' } }, async (harness) => {
    const first = await publish(harness, makeRequest());
    assert.equal(first.state, 'remote_verified');
    await expectCode(publish(harness, makeRequest()), 'BUDGET_EXCEEDED');
    assert.equal(harness.state.snapshot().budget.spentAtomic, 1000000);
    assert.equal(harness.backend.calls.length, 1);
  });
});

test('rejects a multi-resource request whose total fee exceeds the budget before signing', async () => {
  await withBroker({ policy: { budgetQort: '0.015' } }, async (harness) => {
    const body = makeRequest({ resources: [makeResource(), makeResource()] });
    await expectCode(publish(harness, body), 'BUDGET_EXCEEDED');
    assert.equal(harness.backend.calls.length, 0);
    assert.equal(harness.state.snapshot().budget.spentAtomic, 0);
  });
});

test('serializes concurrent requests so the budget cannot be double-spent', async () => {
  await withBroker({
    policy: { budgetQort: '0.015' },
    server: { maxConcurrentPublications: 2 }
  }, async (harness) => {
    const results = await Promise.allSettled([publish(harness, makeRequest()), publish(harness, makeRequest())]);
    const fulfilled = results.filter((entry) => entry.status === 'fulfilled');
    const rejected = results.filter((entry) => entry.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.code, 'BUDGET_EXCEEDED');
    assert.equal(harness.state.snapshot().budget.spentAtomic, 1000000);
    assert.equal(harness.backend.calls.length, 1);
  });
});

test('returns the same publication for an idempotent replay and rejects conflicting reuse', async () => {
  await withBroker({}, async (harness) => {
    const body = makeRequest();
    const first = await publish(harness, body);
    const replay = await publish(harness, body);
    assert.equal(replay.publicationId, first.publicationId);
    assert.equal(harness.backend.calls.length, 1);

    const conflict = { ...body, resources: [makeResource({ identifier: 'qms-dev-conflict' })] };
    await expectCode(publish(harness, conflict), 'IDEMPOTENCY_CONFLICT');
  });
});

test('fails closed when the name is not the exact registered owner or the node is unavailable', async () => {
  await withBroker({}, async (harness) => {
    harness.node.setName('some other name');
    await expectCode(publish(harness, makeRequest()), 'NAME_NOT_VERIFIED');
    assert.equal(harness.backend.calls.length, 0);

    harness.node.setName('developer iffi');
    harness.node.setOwner('Qaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await expectCode(publish(harness, makeRequest()), 'NAME_NOT_VERIFIED');

    harness.node.setOwner('QipPqwJeLtx89dXcSkY7vimMUNT8Gy5k2E');
    harness.node.failAll(true);
    await expectCode(publish(harness, makeRequest()), 'NAME_NOT_VERIFIED');
    assert.equal(harness.backend.calls.length, 0);
  });
});

test('emergency disable blocks publication through state and the external flag', async () => {
  await withBroker({}, async (harness) => {
    await harness.state.transact((draft) => { draft.disabled = true; });
    await expectCode(publish(harness, makeRequest()), 'DISABLED');

    await harness.state.transact((draft) => { draft.disabled = false; });
    writeFileSync(harness.config.killSwitch.path, 'operator disabled\n');
    await expectCode(publish(harness, makeRequest()), 'DISABLED');

    rmSync(harness.config.killSwitch.path, { force: true });
    const result = await publish(harness, makeRequest());
    assert.equal(result.state, 'remote_verified');
  });
});

test('recovers an interrupted reservation conservatively as ambiguous', async () => {
  await withBroker({}, async (harness) => {
    await harness.state.transact((draft) => {
      const id = 'pub_' + 'a'.repeat(24);
      draft.publications[id] = {
        publicationId: id,
        state: 'reserved',
        reservedAtomic: 1000000,
        resources: []
      };
      draft.budget.reservations[id] = 1000000;
    });
    const recovery = await harness.state.recoverInterrupted();
    assert.equal(recovery.recovered, 1);
    const snapshot = harness.state.snapshot();
    assert.equal(snapshot.publications['pub_' + 'a'.repeat(24)].state, 'ambiguous');
    assert.equal(snapshot.publications['pub_' + 'a'.repeat(24)].chargedAtomic, 1000000);
    assert.equal(snapshot.budget.spentAtomic, 1000000);
    assert.deepEqual(snapshot.budget.reservations, {});
  });
});
