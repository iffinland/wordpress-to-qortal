import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeeOracle, arbitraryTransactionLength, buildUnsignedArbitraryTransaction } from '../../broker/src/fees.js';
import { validateConfig, defaultConfig } from '../../broker/src/config.js';
import { makeConfig, makeRequest, makeResource, createTestBroker, NAME } from './support/harness.js';

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

test('reconstructs the exact Core v5 ARBITRARY transaction length', () => {
  const name = NAME;
  const identifier = 'qms-dev-length-check';
  const payloadBytes = 5000;
  const bytes = buildUnsignedArbitraryTransaction({ name, identifier, payloadBytes, timestamp: Date.now() });
  const expected = arbitraryTransactionLength({ name, identifier, payloadBytes });
  assert.equal(bytes.length + 64, expected);
  assert.ok(expected < 1024, 'normal DOCUMENT transactions fit in one unit fee');
});

test('exposes the 5 QORT / 24 hour default without a per-transaction fee ceiling', () => {
  const config = defaultConfig();
  assert.equal(config.policy.budgetQort, '5');
  assert.equal(config.policy.budgetWindowMs, 86400000);
  assert.equal(config.policy.walletReserveQort, '0.1');
  assert.equal(Object.prototype.hasOwnProperty.call(config.policy, 'maxFeePerTransactionQort'), false);
});

test('rejects a retired per-transaction fee ceiling and an unsafe reserve', () => {
  const base = defaultConfig();
  assert.throws(() => validateConfig({ ...base, policy: { ...base.policy, maxFeePerTransactionQort: '0.001' } }),
    (error) => /no longer supported/.test(error.message));
  assert.throws(() => validateConfig({ ...base, policy: { ...base.policy, budgetQort: '5', walletReserveQort: '5' } }),
    (error) => /walletReserveQort/.test(error.message));
});

test('quotes per-resource fees from the node and records each exact amount', async () => {
  await withBroker({}, async (harness) => {
    const resources = [makeResource(), makeResource()];
    const body = makeRequest({ resources });
    const result = await publish(harness, body);
    assert.equal(result.state, 'remote_verified');
    assert.equal(result.unitFeeAtomic, 1000000);
    assert.equal(result.totalFeeAtomic, 2000000);
    assert.equal(result.chargedAtomic, 2000000);
    assert.deepEqual(result.resources.map((entry) => entry.feeAtomic), [1000000, 1000000]);
    assert.equal(harness.node.calls.some((call) => call.startsWith('/transactions/unitfee')), true);
    assert.equal(harness.node.calls.filter((call) => call === '/transactions/fee').length, 2);
    assert.equal(harness.backend.calls[0].feeAtomic, 1000000);
  });
});

test('supports differing per-resource quotes when the node reports them', async () => {
  await withBroker({}, async (harness) => {
    harness.node.queueFees([1000000, 2000000]);
    const resources = [makeResource(), makeResource()];
    const result = await publish(harness, makeRequest({ resources }));
    assert.deepEqual(result.resources.map((entry) => entry.feeAtomic), [1000000, 2000000]);
    assert.equal(result.totalFeeAtomic, 3000000);
    assert.equal(result.chargedAtomic, 3000000);
  });
});

test('rejects when the exact fee cannot be quoted, before any reservation or signing', async () => {
  await withBroker({}, async (harness) => {
    harness.node.setUnitFee(0);
    await expectCode(publish(harness, makeRequest()), 'FEE_UNAVAILABLE');
    assert.equal(harness.backend.calls.length, 0);
    assert.equal(harness.state.snapshot().budget.spentAtomic, 0);
    assert.deepEqual(harness.state.snapshot().budget.reservations, {});
    assert.deepEqual(harness.state.snapshot().publications, {});
  });
});

test('rejects a quote that is not an exact multiple of the unit fee', async () => {
  await withBroker({}, async (harness) => {
    harness.node.queueFees([1500000]);
    await expectCode(publish(harness, makeRequest()), 'FEE_MISMATCH');
    assert.equal(harness.backend.calls.length, 0);
    assert.equal(harness.state.snapshot().budget.spentAtomic, 0);
  });
});

test('rejects an insufficient confirmed wallet balance and preserves the reserve', async () => {
  await withBroker({ policy: { walletReserveQort: '0.001' } }, async (harness) => {
    harness.node.setBalanceQort('0.01099999');
    await expectCode(publish(harness, makeRequest()), 'BALANCE_INSUFFICIENT');
    assert.equal(harness.backend.calls.length, 0);

    harness.node.setBalanceQort('0.01100000');
    const result = await publish(harness, makeRequest());
    assert.equal(result.state, 'remote_verified');
  });
});

test('rejects when the confirmed balance cannot be read', async () => {
  await withBroker({}, async (harness) => {
    harness.node.setBalanceQort(null);
    await expectCode(publish(harness, makeRequest()), 'BALANCE_UNAVAILABLE');
    assert.equal(harness.backend.calls.length, 0);
  });
});

test('counts existing reservations against the available wallet balance', async () => {
  await withBroker({ policy: { walletReserveQort: '0.001' } }, async (harness) => {
    await harness.state.transact((draft) => {
      draft.budget.reservations.pub_pending = 1000000;
    });
    harness.node.setBalanceQort('0.01500000');
    await expectCode(publish(harness, makeRequest()), 'BALANCE_INSUFFICIENT');
    assert.equal(harness.backend.calls.length, 0);
  });
});

test('keeps pending and ambiguous charges inside the rolling budget', async () => {
  const body = makeRequest();
  await withBroker({
    policy: { budgetQort: '0.015' },
    backendResults: [{ state: 'pending', code: 'APPROVAL_PENDING' }]
  }, async (harness) => {
    const pending = await publish(harness, body);
    assert.equal(pending.chargedAtomic, 1000000);
    assert.equal(harness.state.snapshot().budget.spentAtomic, 1000000);
    await expectCode(publish(harness, makeRequest()), 'BUDGET_EXCEEDED');
    assert.equal(harness.backend.calls.length, 1);
  });
});

test('charges that finalize after a window boundary count in the new window', async () => {
  let current;
  await withBroker({
    backendResults: [() => {
      current.advance(2 * 86400000);
      return { state: 'signed' };
    }]
  }, async (harness) => {
    current = harness;
    const result = await publish(harness, makeRequest());
    assert.equal(result.state, 'remote_verified');
    const snapshot = harness.state.snapshot();
    assert.equal(snapshot.budget.spentAtomic, 1000000);
    assert.equal(snapshot.budget.windowStart, harness.clock());
  });
});

test('serialized reservations cannot overcommit the confirmed wallet balance', async () => {
  await withBroker({
    policy: { budgetQort: '5', walletReserveQort: '0.001' },
    server: { maxConcurrentPublications: 4 }
  }, async (harness) => {
    harness.node.setBalanceQort('0.03100000');
    const results = await Promise.allSettled([
      publish(harness, makeRequest()),
      publish(harness, makeRequest()),
      publish(harness, makeRequest()),
      publish(harness, makeRequest())
    ]);
    const fulfilled = results.filter((entry) => entry.status === 'fulfilled');
    const rejected = results.filter((entry) => entry.status === 'rejected');
    assert.equal(fulfilled.length, 3);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.code, 'BALANCE_INSUFFICIENT');
    assert.equal(harness.state.snapshot().budget.spentAtomic, 3000000);
  });
});

test('never increases the configured budget automatically', async () => {
  await withBroker({ policy: { budgetQort: '0.015' } }, async (harness) => {
    const first = await publish(harness, makeRequest());
    assert.equal(first.state, 'remote_verified');
    const before = harness.config.policy.budgetAtomic;
    await expectCode(publish(harness, makeRequest()), 'BUDGET_EXCEEDED');
    assert.equal(harness.config.policy.budgetAtomic, before);
    assert.equal(before, 1500000);
  });
});

test('recovers an interrupted reservation as spent and blocks overspending', async () => {
  await withBroker({ policy: { budgetQort: '0.015' } }, async (harness) => {
    await harness.state.transact((draft) => {
      const id = 'pub_' + 'b'.repeat(24);
      draft.publications[id] = { publicationId: id, state: 'submitting', reservedAtomic: 1000000, resources: [] };
      draft.budget.reservations[id] = 1000000;
    });
    const recovered = await harness.state.recoverInterrupted();
    assert.equal(recovered.recovered, 1);
    assert.equal(harness.state.snapshot().budget.spentAtomic, 1000000);
    await expectCode(publish(harness, makeRequest()), 'BUDGET_EXCEEDED');
    assert.equal(harness.backend.calls.length, 0);
  });
});

test('fee oracle fails closed on malformed and unavailable node responses', async () => {
  const responses = [
    { status: 500, body: 'error' },
    { status: 200, body: 'not-a-number' },
    { status: 200, body: '0' }
  ];
  for (const entry of responses) {
    const oracle = createFeeOracle({
      nodeUrl: 'http://node.test',
      timeoutMs: 1000,
      fetchImpl: async () => ({
        status: entry.status,
        ok: entry.status >= 200 && entry.status < 300,
        async text() { return entry.body; }
      })
    });
    await assert.rejects(oracle.unitFee(), (error) => error.code === 'FEE_UNAVAILABLE');
  }
});
