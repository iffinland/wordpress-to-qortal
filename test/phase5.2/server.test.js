import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { statSync, existsSync } from 'node:fs';
import { createAdminServer } from '../../broker/src/server.js';
import { BrokerClient } from '../../broker/src/client.js';
import { createTestBroker, startTestHttpServer, makeRequest } from './support/harness.js';

function adminRequest(socketPath, message) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(5000, () => reject(new Error('admin timeout')));
    socket.on('connect', () => socket.write(JSON.stringify(message) + '\n'));
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.includes('\n')) {
        socket.end();
        resolve(JSON.parse(buffer.trim()));
      }
    });
    socket.on('error', reject);
  });
}

test('serves health, publishes and reads status over authenticated HTTP', async () => {
  const harness = await createTestBroker();
  const http = await startTestHttpServer(harness);
  try {
    const health = await fetch(http.baseUrl + '/v1/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');

    const body = makeRequest();
    const response = await http.request('POST', '/v1/publications', body);
    assert.equal(response.status, 200);
    assert.equal(response.body.publication.state, 'remote_verified');
    const publicationId = response.body.publication.publicationId;

    const status = await http.request('GET', '/v1/publications/' + publicationId);
    assert.equal(status.status, 200);
    assert.equal(status.body.publication.publicationId, publicationId);
    assert.equal(http.client.keys.size, 1);
  } finally {
    await http.close();
    harness.cleanup();
  }
});

test('agent client publishes, reads status and re-verifies', async () => {
  const harness = await createTestBroker();
  const http = await startTestHttpServer(harness);
  try {
    const client = new BrokerClient({
      baseUrl: http.baseUrl,
      keyId: http.client.keyId,
      privateKey: http.client.privateKey,
      clock: harness.clock
    });
    const published = await client.publish(makeRequest());
    assert.equal(published.publication.state, 'remote_verified');
    const status = await client.getPublication(published.publication.publicationId);
    assert.equal(status.publication.state, 'remote_verified');
    const verified = await client.verifyPublication(published.publication.publicationId);
    assert.equal(verified.publication.state, 'remote_verified');
    assert.equal(harness.backend.calls.length, 1);
  } finally {
    await http.close();
    harness.cleanup();
  }
});

test('rejects unauthenticated requests, replays and forbidden endpoints', async () => {
  const harness = await createTestBroker();
  const http = await startTestHttpServer(harness);
  try {
    const body = makeRequest();
    const unauthenticated = await fetch(http.baseUrl + '/v1/publications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    assert.equal(unauthenticated.status, 401);
    assert.equal((await unauthenticated.json()).error.code, 'AUTH_REQUIRED');

    for (const path of ['/tx/sign', '/wallet/import-seed', '/wallet/unlock', '/node/proxy', '/qortal/request', '/admin/info']) {
      const response = await fetch(http.baseUrl + path, { method: 'POST', body: '{}' });
      assert.equal(response.status, 404, path + ' must not exist');
      assert.equal((await response.json()).error.code, 'NOT_FOUND');
    }

    const first = await http.request('POST', '/v1/publications', makeRequest(), { nonce: 'nonce-replay-0000000001' });
    assert.equal(first.status, 200);
    const replay = await http.request('POST', '/v1/publications', makeRequest(), { nonce: 'nonce-replay-0000000001' });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.error.code, 'AUTH_REPLAY');
  } finally {
    await http.close();
    harness.cleanup();
  }
});

test('enforces the request body limit and rejects query strings', async () => {
  const harness = await createTestBroker({ server: { maxBodyBytes: 2048 } });
  const http = await startTestHttpServer(harness);
  try {
    const large = makeRequest({ resources: [{ ...makeRequest().resources[0], dataBase64: Buffer.alloc(4096, 65).toString('base64'), bytes: 4096 }] });
    const response = await http.request('POST', '/v1/publications', large);
    assert.equal(response.status, 413);
    assert.equal(response.body.error.code, 'PAYLOAD_TOO_LARGE');

    const query = await http.request('GET', '/v1/publications?all=1');
    assert.equal(query.status, 400);
  } finally {
    await http.close();
    harness.cleanup();
  }
});

test('admin socket is private, disables publication and revokes keys', async () => {
  const harness = await createTestBroker();
  const http = await startTestHttpServer(harness);
  const admin = createAdminServer({ config: harness.config, broker: harness.broker, audit: harness.audit, clock: harness.clock });
  await admin.listen();
  try {
    const mode = statSync(harness.config.admin.socketPath).mode & 0o777;
    assert.equal(mode, 0o600);

    const status = await adminRequest(harness.config.admin.socketPath, { command: 'status' });
    assert.equal(status.ok, true);
    assert.equal(status.status.disabled, false);

    const disable = await adminRequest(harness.config.admin.socketPath, { command: 'disable', reason: 'test emergency stop' });
    assert.equal(disable.ok, true);
    assert.equal(existsSync(harness.config.killSwitch.path), true);
    const blocked = await http.request('POST', '/v1/publications', makeRequest());
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.error.code, 'DISABLED');

    const enableWithoutConfirm = await adminRequest(harness.config.admin.socketPath, { command: 'enable' });
    assert.equal(enableWithoutConfirm.ok, false);
    const enable = await adminRequest(harness.config.admin.socketPath, { command: 'enable', confirm: 'ENABLE' });
    assert.equal(enable.ok, true);
    assert.equal(existsSync(harness.config.killSwitch.path), false);

    const revoke = await adminRequest(harness.config.admin.socketPath, { command: 'revoke-key', keyId: http.client.keyId, reason: 'test' });
    assert.equal(revoke.ok, true);
    const rejected = await http.request('POST', '/v1/publications', makeRequest());
    assert.equal(rejected.status, 401);
    assert.equal(rejected.body.error.code, 'AUTH_KEY_REVOKED');

    const unrevoke = await adminRequest(harness.config.admin.socketPath, { command: 'unrevoke-key', keyId: http.client.keyId });
    assert.equal(unrevoke.ok, true);
    const accepted = await http.request('POST', '/v1/publications', makeRequest());
    assert.equal(accepted.status, 200);
  } finally {
    await admin.close();
    await http.close();
    harness.cleanup();
  }
});

test('admin rejects malformed commands', async () => {
  const harness = await createTestBroker();
  const admin = createAdminServer({ config: harness.config, broker: harness.broker, audit: harness.audit, clock: harness.clock });
  await admin.listen();
  try {
    assert.equal((await admin.handle('not json')).ok, false);
    assert.equal((await admin.handle('{}')).error, 'invalid_command');
    assert.equal((await admin.handle(JSON.stringify({ command: 'unknown' }))).error, 'unknown_command');
    assert.equal((await admin.handle(JSON.stringify({ command: 'disable', reason: 'x' }))).error, 'reason_required');
  } finally {
    await admin.close();
    harness.cleanup();
  }
});
