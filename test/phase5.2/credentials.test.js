import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ExternalAuthCredentialStore,
  createExternalAuthTokenValidator,
  readTokenFile,
  tokenFingerprint
} from '../../broker/src/credentials/store.js';
import { createCredentialSocketServer } from '../../broker/src/credentials/socket.js';
import { ExternalAuthSigningBackend } from '../../broker/src/signing/external-auth.js';

const TOKEN_A = 'valid-token-aaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'valid-token-bbbbbbbbbbbbbbbbbbbb';
const NOW = Date.parse('2026-11-03T10:00:00.000Z');

function tempCtx() {
  const dir = mkdtempSync(join(tmpdir(), 'qms-cred-'));
  const tokenFile = join(dir, 'external-auth-token');
  writeFileSync(tokenFile, TOKEN_A + '\n', { mode: 0o600 });
  chmodSync(tokenFile, 0o600);
  return { dir, tokenFile, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function auditStub() {
  return { events: [], append(event, fields) { this.events.push({ event, fields }); } };
}

test('loads a private token, validates it and never exposes it in status', async () => {
  const ctx = tempCtx();
  try {
    const seen = [];
    const store = new ExternalAuthCredentialStore({
      tokenFile: ctx.tokenFile,
      validateToken: async (token) => { seen.push(token); return true; },
      clock: () => NOW
    });
    await store.open();
    assert.deepEqual(seen, [TOKEN_A]);
    assert.equal(store.current(), TOKEN_A);
    const status = store.status();
    assert.equal(status.present, true);
    assert.equal(status.fingerprint, tokenFingerprint(TOKEN_A));
    assert.equal(JSON.stringify(status).includes(TOKEN_A), false);
  } finally { ctx.cleanup(); }
});

test('refuses a widened token file or a widened directory entry', async () => {
  const ctx = tempCtx();
  try {
    chmodSync(ctx.tokenFile, 0o640);
    assert.throws(() => readTokenFile(ctx.tokenFile), (error) => error.code === 'UNAVAILABLE');
    chmodSync(ctx.tokenFile, 0o600);
    assert.throws(() => readTokenFile(ctx.tokenFile, { expectedUid: process.getuid() + 1 }), (error) => error.code === 'UNAVAILABLE');
  } finally { ctx.cleanup(); }
});

test('validation uses only GET /settings with the bearer token', async () => {
  const calls = [];
  const validate = createExternalAuthTokenValidator({
    baseUrl: 'http://127.0.0.1:3191',
    timeoutMs: 1000,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true };
    }
  });
  assert.equal(await validate(TOKEN_A), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:3191/settings');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.authorization, 'Bearer ' + TOKEN_A);
  assert.equal(calls[0].url.includes('/qdn'), false);
  assert.equal(calls[0].url.includes('/tx'), false);
});

test('accepts a renewed credential atomically and keeps it after reload', async () => {
  const ctx = tempCtx();
  try {
    const audit = auditStub();
    const store = new ExternalAuthCredentialStore({
      tokenFile: ctx.tokenFile,
      validateToken: async () => true,
      clock: () => NOW,
      onEvent: (event, fields) => audit.append(event, fields)
    });
    await store.open();
    await store.accept({ token: TOKEN_B, expiresAt: NOW + 3600000, source: 'socket' });
    assert.equal(store.current(), TOKEN_B);
    assert.equal(readFileSync(ctx.tokenFile, 'utf8').trim(), TOKEN_B);
    assert.equal(statSync(ctx.tokenFile).mode & 0o777, 0o600);
    assert.equal(JSON.stringify(audit.events).includes(TOKEN_B), false);

    const reloaded = new ExternalAuthCredentialStore({
      tokenFile: ctx.tokenFile,
      validateToken: async () => true,
      clock: () => NOW
    });
    await reloaded.open();
    assert.equal(reloaded.current(), TOKEN_B);
  } finally { ctx.cleanup(); }
});

test('a failed or expired renewal keeps the last known-good token and file', async () => {
  const ctx = tempCtx();
  try {
    let allow = true;
    const store = new ExternalAuthCredentialStore({
      tokenFile: ctx.tokenFile,
      validateToken: async (token) => allow && token.startsWith('valid-token-'),
      clock: () => NOW
    });
    await store.open();
    const before = readFileSync(ctx.tokenFile, 'utf8');

    allow = false;
    await assert.rejects(store.accept({ token: TOKEN_B, expiresAt: NOW + 3600000 }), (error) => error.code === 'UNAVAILABLE');
    assert.equal(store.current(), TOKEN_A);
    assert.equal(readFileSync(ctx.tokenFile, 'utf8'), before);

    allow = true;
    await assert.rejects(store.accept({ token: TOKEN_B, expiresAt: NOW + 1000 }), (error) => error.code === 'UNAVAILABLE');
    await assert.rejects(store.accept({ token: TOKEN_B, expiresAt: NOW + 9 * 86400000 }), (error) => error.code === 'UNAVAILABLE');
    assert.equal(store.current(), TOKEN_A);
  } finally { ctx.cleanup(); }
});

test('SIGHUP-style reload fails closed and keeps the old token on invalid input', async () => {
  const ctx = tempCtx();
  try {
    const store = new ExternalAuthCredentialStore({
      tokenFile: ctx.tokenFile,
      validateToken: async () => true,
      clock: () => NOW
    });
    await store.open();
    writeFileSync(ctx.tokenFile, TOKEN_B + '\n', { mode: 0o600 });
    chmodSync(ctx.tokenFile, 0o600);
    await store.reloadFromFile();
    assert.equal(store.current(), TOKEN_B);

    writeFileSync(ctx.tokenFile, 'short\n', { mode: 0o600 });
    chmodSync(ctx.tokenFile, 0o600);
    await assert.rejects(store.reloadFromFile(), (error) => error.code === 'UNAVAILABLE');
    assert.equal(store.current(), TOKEN_B);
  } finally { ctx.cleanup(); }
});

test('the signing backend uses a renewed token on the next publish without restarting', async () => {
  const ctx = tempCtx();
  try {
    const store = new ExternalAuthCredentialStore({
      tokenFile: ctx.tokenFile,
      validateToken: async () => true,
      clock: () => NOW
    });
    await store.open();
    const seen = [];
    const backend = new ExternalAuthSigningBackend({
      baseUrl: 'http://127.0.0.1:3191',
      walletId: 'wallet-test',
      tokenFile: ctx.tokenFile,
      expectedAddress: 'QipPqwJeLtx89dXcSkY7vimMUNT8Gy5k2E',
      credentialStore: store,
      fetchImpl: async (url, init) => {
        seen.push(init.headers.authorization);
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ result: { signature: 'sig-' + seen.length, creatorAddress: 'QipPqwJeLtx89dXcSkY7vimMUNT8Gy5k2E' } });
          }
        };
      }
    });
    await backend.open();
    const request = {
      service: 'DOCUMENT', name: 'developer iffi', identifier: 'qms-dev-reload',
      dataBase64: Buffer.from('reload').toString('base64'), feePerTransaction: 0.001
    };
    assert.equal((await backend.publish(request)).state, 'signed');
    await store.accept({ token: TOKEN_B, expiresAt: NOW + 3600000 });
    assert.equal((await backend.publish(request)).state, 'signed');
    assert.deepEqual(seen, ['Bearer ' + TOKEN_A, 'Bearer ' + TOKEN_B]);
  } finally { ctx.cleanup(); }
});

test('private credential socket accepts renewal, reports status and rejects bad schemas', async () => {
  const ctx = tempCtx();
  const socketPath = join(ctx.dir, 'credential.sock');
  try {
    const audit = auditStub();
    const store = new ExternalAuthCredentialStore({
      tokenFile: ctx.tokenFile,
      validateToken: async () => true,
      clock: () => NOW,
      onEvent: (event, fields) => audit.append(event, fields)
    });
    await store.open();
    const server = createCredentialSocketServer({
      socketPath, mode: 0o660, store, audit, clock: () => NOW
    });
    await server.listen();
    assert.equal(statSync(socketPath).mode & 0o777, 0o660);

    const statusResponse = await server.handleLine(JSON.stringify({
      schema: 'qms-auth-credential@1', op: 'status'
    }));
    assert.equal(statusResponse.ok, true);

    const bad = await server.handleLine(JSON.stringify({ schema: 'wrong', op: 'renew' }));
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'invalid_schema');

    const response = await new Promise((resolve, reject) => {
      const socket = createConnection(socketPath);
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.write(JSON.stringify({
        schema: 'qms-auth-credential@1', op: 'renew', token: TOKEN_B, expiresAt: NOW + 3600000
      }) + '\n'));
      socket.on('data', (chunk) => {
        buffer += chunk;
        if (!buffer.includes('\n')) return;
        socket.end();
        resolve(JSON.parse(buffer.trim()));
      });
      socket.on('error', reject);
    });
    assert.equal(response.ok, true);
    assert.equal(response.credential.fingerprint, tokenFingerprint(TOKEN_B));
    assert.equal(JSON.stringify(response).includes(TOKEN_B), false);
    assert.equal(JSON.stringify(audit.events).includes(TOKEN_B), false);
    await server.close();
  } finally { ctx.cleanup(); }
});

test('credential socket refuses a group- or world-writable parent directory', async () => {
  const ctx = tempCtx();
  try {
    chmodSync(ctx.dir, 0o777);
    const store = new ExternalAuthCredentialStore({
      tokenFile: ctx.tokenFile,
      validateToken: async () => true,
      clock: () => NOW
    });
    await store.open();
    const server = createCredentialSocketServer({ socketPath: join(ctx.dir, 'credential.sock'), store });
    await assert.rejects(server.listen(), (error) => error.code === 'UNAVAILABLE');
  } finally { ctx.cleanup(); }
});
