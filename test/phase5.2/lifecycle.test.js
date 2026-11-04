import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdminServer, createBrokerHttpServer } from '../../broker/src/server.js';
import { PublicationBroker } from '../../broker/src/service.js';
import { BrokerState } from '../../broker/src/state.js';
import { createNonceCache, signRequest } from '../../broker/src/auth.js';
import { verifyAuditFile } from '../../broker/src/audit.js';
import { ExternalAuthCredentialStore } from '../../broker/src/credentials/store.js';
import { createTestBroker, startTestHttpServer, makeRequest } from './support/harness.js';

function credentialCtx() {
  const dir = mkdtempSync(join(tmpdir(), 'qms-lifecycle-cred-'));
  const tokenFile = join(dir, 'external-auth-token');
  writeFileSync(tokenFile, 'valid-token-aaaaaaaaaaaaaaaaaaaa' + '\n', { mode: 0o600 });
  chmodSync(tokenFile, 0o600);
  return { dir, tokenFile, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return 'http://127.0.0.1:' + server.address().port;
}

function signedFetch(baseUrl, key, method, path, body, { timestamp, nonce }) {
  const bodyBytes = body === null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body), 'utf8');
  const headers = signRequest({
    method,
    path,
    bodyBytes,
    keyId: key.keyId,
    privateKey: key.privateKey,
    timestamp,
    nonce
  });
  if (body !== null) headers['content-type'] = 'application/json';
  return fetch(baseUrl + path, { method, headers, body: body === null ? undefined : bodyBytes })
    .then(async (response) => {
      const text = await response.text();
      let parsed;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
      return { status: response.status, body: parsed };
    });
}

async function safeClose(server) {
  if (!server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

async function restartBroker(harness, keys) {
  const state = await BrokerState.open({
    path: harness.config.state.path,
    fsync: false,
    clock: harness.clock
  });
  await state.recoverInterrupted({ windowMs: harness.config.policy.budgetWindowMs });
  const broker = new PublicationBroker({
    config: harness.config,
    state,
    audit: harness.audit,
    backend: harness.backend,
    fetchImpl: harness.node.fetchImpl,
    clock: harness.clock,
    sleep: async () => {}
  });
  const server = createBrokerHttpServer({
    config: harness.config,
    broker,
    keys,
    nonceCache: createNonceCache(),
    clock: harness.clock,
    audit: harness.audit
  });
  const baseUrl = await listen(server);
  return {
    broker,
    state,
    server,
    baseUrl,
    close: () => safeClose(server)
  };
}

test('direct key authentication and replay protection survive a broker restart', async () => {
  const harness = await createTestBroker();
  const http = await startTestHttpServer(harness);
  let restarted = null;
  try {
    const body = makeRequest();
    const timestamp = harness.clock();
    const nonce = 'nonce-restart-replay-01';
    const first = await http.request('POST', '/v1/publications', body, { timestamp, nonce });
    assert.equal(first.status, 200);
    const before = harness.state.snapshot();
    assert.ok(before.budget.spentAtomic > 0);
    assert.ok(Object.keys(before.requestNonces).length > 0);

    await safeClose(http.server);
    restarted = await restartBroker(harness, http.client.keys);

    const replay = await signedFetch(
      restarted.baseUrl, http.client, 'POST', '/v1/publications', body, { timestamp, nonce }
    );
    assert.equal(replay.status, 401);
    assert.equal(replay.body.error.code, 'AUTH_REPLAY');

    const freshBody = makeRequest();
    const fresh = await signedFetch(
      restarted.baseUrl, http.client, 'POST', '/v1/publications', freshBody,
      { timestamp: harness.clock(), nonce: 'nonce-restart-fresh-01' }
    );
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.publication.state, 'remote_verified');

    const after = restarted.state.snapshot();
    assert.equal(after.budget.windowStart, before.budget.windowStart);
    assert.ok(after.budget.spentAtomic > before.budget.spentAtomic);
    assert.deepEqual(after.budget.reservations, {});
    for (const [requestId, entry] of Object.entries(before.idempotency)) {
      assert.deepEqual(after.idempotency[requestId], entry);
    }
    for (const [publicationId, record] of Object.entries(before.publications)) {
      assert.deepEqual(after.publications[publicationId], record);
    }
    assert.ok(Object.keys(after.requestNonces).includes(http.client.keyId + '|' + nonce));
  } finally {
    if (restarted) await restarted.close();
    await safeClose(http.server);
    harness.cleanup();
  }
});

test('credential reload and state reopen preserve budget, reservations, idempotency, locks and key state', async () => {
  const harness = await createTestBroker();
  const http = await startTestHttpServer(harness);
  const cred = credentialCtx();
  let restarted = null;
  try {
    const published = await http.request('POST', '/v1/publications', makeRequest());
    assert.equal(published.status, 200);
    const before = harness.state.snapshot();
    assert.ok(before.budget.spentAtomic > 0);
    assert.ok(Object.keys(before.requestNonces).length > 0);

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
    assert.deepEqual(after.resourceLocks, before.resourceLocks);
    assert.deepEqual(after.revokedKeys, before.revokedKeys);
    assert.deepEqual(after.requestNonces, before.requestNonces);
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

    // Reopening the state file must retain every accounting and auth field.
    const reopened = await BrokerState.open({ path: harness.config.state.path, fsync: false, clock: harness.clock });
    assert.equal(reopened.snapshot().budget.spentAtomic, reserved.budget.spentAtomic);
    assert.deepEqual(reopened.snapshot().budget.reservations, reserved.budget.reservations);
    assert.deepEqual(reopened.snapshot().idempotency, reserved.idempotency);
    assert.deepEqual(reopened.snapshot().resourceLocks, reserved.resourceLocks);
    assert.deepEqual(reopened.snapshot().requestNonces, reserved.requestNonces);
    assert.deepEqual(reopened.snapshot().revokedKeys, reserved.revokedKeys);

    // A revoked key stays revoked across restart, then can be re-enabled.
    const admin = createAdminServer({ config: harness.config, broker: harness.broker, audit: harness.audit, clock: harness.clock });
    await admin.listen();
    try {
      const revoke = await admin.handle(JSON.stringify({ command: 'revoke-key', keyId: http.client.keyId, reason: 'restart test' }));
      assert.equal(revoke.ok, true);
    } finally {
      await admin.close();
    }
    await safeClose(http.server);
    restarted = await restartBroker(harness, http.client.keys);
    const blocked = await signedFetch(
      restarted.baseUrl, http.client, 'POST', '/v1/publications', makeRequest(),
      { timestamp: harness.clock(), nonce: 'nonce-revoked-restart-01' }
    );
    assert.equal(blocked.status, 401);
    assert.equal(blocked.body.error.code, 'AUTH_KEY_REVOKED');
    assert.deepEqual(restarted.state.snapshot().revokedKeys, [http.client.keyId]);
  } finally {
    if (restarted) await restarted.close();
    await safeClose(http.server);
    cred.cleanup();
    harness.cleanup();
  }
});

test('the kill switch blocks publication but health stays available', async () => {
  const harness = await createTestBroker();
  const http = await startTestHttpServer(harness);
  const admin = createAdminServer({ config: harness.config, broker: harness.broker, audit: harness.audit, clock: harness.clock });
  await admin.listen();
  try {
    const disable = await admin.handle(JSON.stringify({ command: 'disable', reason: 'lifecycle test' }));
    assert.equal(disable.ok, true);
    const health = await fetch(http.baseUrl + '/v1/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).disabled, true);
    const publish = await http.request('POST', '/v1/publications', makeRequest());
    assert.equal(publish.status, 503);
    assert.equal(publish.body.error.code, 'DISABLED');

    const enable = await admin.handle(JSON.stringify({ command: 'enable', confirm: 'ENABLE' }));
    assert.equal(enable.ok, true);
    const after = await http.request('POST', '/v1/publications', makeRequest());
    assert.equal(after.status, 200);
  } finally {
    await admin.close();
    await http.close();
    harness.cleanup();
  }
});
