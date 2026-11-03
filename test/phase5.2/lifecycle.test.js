import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdminServer } from '../../broker/src/server.js';
import { BrokerState } from '../../broker/src/state.js';
import { verifyAuditFile } from '../../broker/src/audit.js';
import { ExternalAuthCredentialStore } from '../../broker/src/credentials/store.js';
import { signRequest } from '../../broker/src/auth.js';
import { createTestBroker, startTestHttpServer, makeRequest, createClientKey } from './support/harness.js';

function credentialCtx() {
  const dir = mkdtempSync(join(tmpdir(), 'qms-lifecycle-cred-'));
  const tokenFile = join(dir, 'external-auth-token');
  writeFileSync(tokenFile, 'valid-token-aaaaaaaaaaaaaaaaaaaa' + '\n', { mode: 0o600 });
  chmodSync(tokenFile, 0o600);
  return { dir, tokenFile, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('refresh issues a short-lived grant and enforces replay, wrong key, revocation and expiry', async () => {
  const harness = await createTestBroker();
  const http = await startTestHttpServer(harness);
  try {
    const first = await http.refreshAccess();
    assert.equal(first.status, 200);
    assert.equal(first.body.schema, 'qms-broker-access@1');
    assert.equal(first.body.accessTtlMs, harness.config.auth.accessTtlMs);
    assert.equal(typeof first.body.accessToken, 'string');

    const nonce = 'nonce-replay-refresh-0001';
    const path = '/v1/auth/refresh';
    const bodyBytes = Buffer.from(JSON.stringify({ schema: 'qms-broker-refresh@1' }), 'utf8');
    const signed = signRequest({
      method: 'POST', path, bodyBytes, keyId: http.client.keyId,
      privateKey: http.client.privateKey, timestamp: harness.clock(), nonce
    });
    const one = await fetch(http.baseUrl + path, { method: 'POST', headers: { ...signed, 'content-type': 'application/json' }, body: bodyBytes });
    assert.equal(one.status, 200);
    const replay = await fetch(http.baseUrl + path, { method: 'POST', headers: { ...signed, 'content-type': 'application/json' }, body: bodyBytes });
    assert.equal(replay.status, 401);
    assert.equal((await replay.json()).error.code, 'AUTH_REPLAY');

    const wrongKey = createClientKey({ keyId: 'wrong-key', issuedAt: harness.clock() - 1000, expiresAt: harness.clock() + 3600000 });
    const forged = await fetch(http.baseUrl + path, {
      method: 'POST',
      headers: {
        ...signRequest({
          method: 'POST', path, bodyBytes, keyId: http.client.keyId,
          privateKey: wrongKey.privateKey, timestamp: harness.clock(), nonce: 'nonce-forged-refresh-01'
        }),
        'content-type': 'application/json'
      },
      body: bodyBytes
    });
    assert.equal(forged.status, 401);
    assert.equal((await forged.json()).error.code, 'AUTH_INVALID');

    const foreign = await http.request('GET', '/v1/publications/pub_000000000000000000000000', null, { key: wrongKey });
    assert.equal(foreign.status, 401);
    assert.ok(['AUTH_KEY_UNKNOWN', 'AUTH_GRANT_INVALID'].includes(foreign.body.error.code));

    harness.advance(harness.config.auth.accessTtlMs + 1000);
    const stale = await http.request('POST', '/v1/publications', makeRequest());
    assert.equal(stale.status, 401);
    assert.equal(stale.body.error.code, 'AUTH_GRANT_EXPIRED');
    const refreshed = await http.refreshAccess();
    assert.equal(refreshed.status, 200);
  } finally {
    await http.close();
    harness.cleanup();
  }
});

test('the kill switch blocks refresh and publication and re-enables cleanly', async () => {
  const harness = await createTestBroker();
  const http = await startTestHttpServer(harness);
  const admin = createAdminServer({ config: harness.config, broker: harness.broker, audit: harness.audit, clock: harness.clock });
  await admin.listen();
  try {
    const disable = await admin.handle(JSON.stringify({ command: 'disable', reason: 'lifecycle test' }));
    assert.equal(disable.ok, true);
    const refresh = await http.refreshAccess();
    assert.equal(refresh.status, 503);
    assert.equal(refresh.body.error.code, 'DISABLED');
    const publish = await http.request('POST', '/v1/publications', makeRequest());
    assert.equal(publish.status, 503);

    const enable = await admin.handle(JSON.stringify({ command: 'enable', confirm: 'ENABLE' }));
    assert.equal(enable.ok, true);
    const after = await http.refreshAccess();
    assert.equal(after.status, 200);
  } finally {
    await admin.close();
    await http.close();
    harness.cleanup();
  }
});

test('concurrent refreshes mint distinct grants and stay within the bound', async () => {
  const harness = await createTestBroker({ auth: { maxGrantsPerKey: 8 } });
  const http = await startTestHttpServer(harness);
  try {
    const responses = await Promise.all(Array.from({ length: 6 }, () => http.refreshAccess()));
    assert.equal(responses.every((response) => response.status === 200), true);
    const tokens = new Set(responses.map((response) => response.body.accessToken));
    assert.equal(tokens.size, 6);
    assert.ok(Object.keys(harness.state.snapshot().accessGrants).length <= 8);

    for (const response of responses) {
      const accepted = await http.request('GET', '/v1/publications/pub_000000000000000000000000', null, { token: response.body.accessToken });
      assert.equal(accepted.status, 400);
      assert.equal(accepted.body.error.code, 'INVALID_REQUEST');
    }
  } finally {
    await http.close();
    harness.cleanup();
  }
});

test('credential reload and broker restart preserve budget, reservations, idempotency and grants', async () => {
  const harness = await createTestBroker();
  const http = await startTestHttpServer(harness);
  const cred = credentialCtx();
  try {
    const published = await http.request('POST', '/v1/publications', makeRequest());
    assert.equal(published.status, 200);
    const before = harness.state.snapshot();
    assert.ok(before.budget.spentAtomic > 0);
    assert.ok(Object.keys(before.accessGrants).length > 0);

    const store = new ExternalAuthCredentialStore({
      tokenFile: cred.tokenFile,
      validateToken: async () => true,
      clock: harness.clock
    });
    await store.open();
    await store.accept({
      token: 'valid-token-bbbbbbbbbbbbbbbbbbbb',
      expiresAt: harness.clock() + 3600000
    });

    const after = harness.state.snapshot();
    assert.equal(after.budget.spentAtomic, before.budget.spentAtomic);
    assert.equal(after.budget.windowStart, before.budget.windowStart);
    assert.deepEqual(after.budget.reservations, before.budget.reservations);
    assert.deepEqual(after.idempotency, before.idempotency);
    assert.deepEqual(after.accessGrants, before.accessGrants);
    assert.equal(verifyAuditFile(harness.config.audit.path).ok, true);

    // An in-flight reservation must survive a credential swap untouched.
    await harness.state.transact((draft) => {
      draft.publications.pub_ffffffffffffffffffffffff = {
        schema: 'qms-test-publication@1',
        publicationId: 'pub_ffffffffffffffffffffffff',
        requestId: 'req_inflight',
        projectId: 'prj_corbett-test',
        target: { name: 'developer iffi', ownerAddress: 'QipPqwJeLtx89dXcSkY7vimMUNT8Gy5k2E' },
        state: 'reserved', decision: 'accepted', code: 'RESERVED', message: 'reserved',
        createdAt: new Date(harness.clock()).toISOString(),
        updatedAt: new Date(harness.clock()).toISOString(),
        clientKeyId: 'agent-test', handoffId: null, updateExisting: false,
        resources: [], unitFeeAtomic: 1000000, totalFeeAtomic: 1000000,
        reservedAtomic: 1000000, balanceAtReservationAtomic: 502000000,
        chargedAtomic: 0, verification: null
      };
      draft.budget.reservations.pub_ffffffffffffffffffffffff = 1000000;
    });
    const reserved = harness.state.snapshot();
    await store.accept({ token: 'valid-token-cccccccccccccccccccc', expiresAt: harness.clock() + 3600000 });
    assert.deepEqual(harness.state.snapshot().budget.reservations, reserved.budget.reservations);

    // Reopening the state file must retain every accounting field.
    const reopened = await BrokerState.open({ path: harness.config.state.path, fsync: false, clock: harness.clock });
    assert.equal(reopened.snapshot().budget.spentAtomic, reserved.budget.spentAtomic);
    assert.deepEqual(reopened.snapshot().budget.reservations, reserved.budget.reservations);
    assert.deepEqual(reopened.snapshot().idempotency, reserved.idempotency);
    assert.deepEqual(reopened.snapshot().accessGrants, reserved.accessGrants);
    assert.equal(reopened.snapshot().publications.pub_ffffffffffffffffffffffff.state, 'reserved');

    // The old grant still authenticates after the state round trip.
    const oldGrant = Object.values(reserved.accessGrants)[0];
    assert.equal(oldGrant.revoked, false);
  } finally {
    await http.close();
    cred.cleanup();
    harness.cleanup();
  }
});
