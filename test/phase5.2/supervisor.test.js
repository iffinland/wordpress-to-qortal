import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExternalAuthCredentialStore } from '../../broker/src/credentials/store.js';
import { createCredentialSocketServer } from '../../broker/src/credentials/socket.js';
import { runOnce, readSupervisorState } from '../../broker/src/credentials/supervisor.js';

const TOKEN_A = 'valid-token-aaaaaaaaaaaaaaaaaaaa';
const APP_ID = '11111111-1111-4111-8111-111111111111';
const APP_SECRET = '22222222-2222-4222-8222-222222222222';

function supervisorCtx() {
  const dir = mkdtempSync(join(tmpdir(), 'qms-supervisor-'));
  const tokenFile = join(dir, 'external-auth-token');
  const appFile = join(dir, 'app.json');
  const configFile = join(dir, 'supervisor.json');
  const statePath = join(dir, 'state.json');
  const socketPath = join(dir, 'credential.sock');
  writeFileSync(tokenFile, TOKEN_A + '\n', { mode: 0o600 });
  chmodSync(tokenFile, 0o600);
  writeFileSync(appFile, JSON.stringify({ appId: APP_ID, appSecret: APP_SECRET }) + '\n', { mode: 0o600 });
  chmodSync(appFile, 0o600);
  writeFileSync(configFile, JSON.stringify({
    schema: 'qms-auth-credential-supervisor@1',
    baseUrl: 'http://127.0.0.1:3191',
    appSecretFile: appFile,
    socketPath,
    statePath,
    renewBeforeMs: 1200000,
    timeoutMs: 5000
  }) + '\n', { mode: 0o600 });
  chmodSync(configFile, 0o600);
  return { dir, tokenFile, appFile, configFile, statePath, socketPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function mutableClock(start = Date.now()) {
  let now = start;
  return { now: () => now, advance(ms) { now += ms; } };
}

async function setupStore(ctx, clock) {
  const store = new ExternalAuthCredentialStore({
    tokenFile: ctx.tokenFile,
    validateToken: async () => true,
    clock: clock.now
  });
  await store.open();
  const server = createCredentialSocketServer({
    socketPath: ctx.socketPath,
    mode: 0o660,
    store,
    clock: clock.now
  });
  await server.listen();
  return { store, server };
}

function fakeExternalAuth({ fail = false } = {}) {
  const calls = [];
  let counter = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (fail) {
      return { ok: false, status: 401, async json() { return { error: 'invalid credentials' }; } };
    }
    counter += 1;
    const expiresAt = Date.now() + 3600000;
    return {
      ok: true,
      status: 200,
      async json() { return { token: 'session-token-' + String(counter).padStart(4, '0') + '-abcdefghijklmnop', expiresAt }; }
    };
  };
  return { fetchImpl, calls };
}

test('renews through POST /sessions and pushes the credential over the private socket', async () => {
  const ctx = supervisorCtx();
  const clock = mutableClock();
  try {
    const { store, server } = await setupStore(ctx, clock);
    const ea = fakeExternalAuth();
    const result = await runOnce({ configFile: ctx.configFile, force: true, fetchImpl: ea.fetchImpl, now: clock.now });
    assert.equal(result.renewed, true);
    assert.equal(ea.calls.length, 1);
    assert.equal(ea.calls[0].url, 'http://127.0.0.1:3191/sessions');
    const body = JSON.parse(ea.calls[0].init.body);
    assert.deepEqual(body, { appId: APP_ID, appSecret: APP_SECRET });
    assert.equal(store.current(), 'session-token-0001-abcdefghijklmnop');
    const state = readSupervisorState(ctx.statePath);
    assert.equal(state.expiresAt, result.expiresAt);
    assert.equal(JSON.stringify(state).includes('session-token'), false);
    assert.equal(JSON.stringify(result).includes('session-token'), false);
    await server.close();
  } finally { ctx.cleanup(); }
});

test('skips renewal while the stored session has enough remaining lifetime', async () => {
  const ctx = supervisorCtx();
  const clock = mutableClock();
  try {
    const { server } = await setupStore(ctx, clock);
    try {
      const ea = fakeExternalAuth();
      await runOnce({ configFile: ctx.configFile, force: true, fetchImpl: ea.fetchImpl, now: clock.now });
      const second = await runOnce({ configFile: ctx.configFile, fetchImpl: ea.fetchImpl, now: clock.now });
      assert.equal(second.renewed, false);
      assert.equal(ea.calls.length, 1);

      clock.advance(3000000);
      const third = await runOnce({ configFile: ctx.configFile, fetchImpl: ea.fetchImpl, now: clock.now });
      assert.equal(third.renewed, true);
      assert.equal(ea.calls.length, 2);
    } finally {
      await server.close();
    }
  } finally { ctx.cleanup(); }
});

test('renewal failure does not write state or replace the broker credential', async () => {
  const ctx = supervisorCtx();
  const clock = mutableClock();
  try {
    const { store, server } = await setupStore(ctx, clock);
    const ea = fakeExternalAuth({ fail: true });
    await assert.rejects(
      runOnce({ configFile: ctx.configFile, force: true, fetchImpl: ea.fetchImpl, now: clock.now }),
      /refused the session request/
    );
    assert.equal(store.current(), TOKEN_A);
    assert.equal(readSupervisorState(ctx.statePath), null);
    await server.close();
  } finally { ctx.cleanup(); }
});

test('a missing broker credential socket is a hard failure', async () => {
  const ctx = supervisorCtx();
  const clock = mutableClock();
  try {
    const ea = fakeExternalAuth();
    await assert.rejects(
      runOnce({ configFile: ctx.configFile, force: true, fetchImpl: ea.fetchImpl, now: clock.now }),
      /socket error|ENOENT/
    );
    assert.equal(readSupervisorState(ctx.statePath), null);
  } finally { ctx.cleanup(); }
});

test('refuses an app credential file readable by other users', async () => {
  const ctx = supervisorCtx();
  const clock = mutableClock();
  try {
    chmodSync(ctx.appFile, 0o644);
    const ea = fakeExternalAuth();
    await assert.rejects(
      runOnce({ configFile: ctx.configFile, force: true, fetchImpl: ea.fetchImpl, now: clock.now }),
      /must not be readable/
    );
    assert.equal(ea.calls.length, 0);
  } finally { ctx.cleanup(); }
});

test('concurrent renewals remain consistent and never corrupt the token file', async () => {
  const ctx = supervisorCtx();
  const clock = mutableClock();
  try {
    const { store, server } = await setupStore(ctx, clock);
    const ea = fakeExternalAuth();
    const results = await Promise.all([
      runOnce({ configFile: ctx.configFile, force: true, fetchImpl: ea.fetchImpl, now: clock.now }),
      runOnce({ configFile: ctx.configFile, force: true, fetchImpl: ea.fetchImpl, now: clock.now }),
      runOnce({ configFile: ctx.configFile, force: true, fetchImpl: ea.fetchImpl, now: clock.now })
    ]);
    assert.equal(results.every((entry) => entry.renewed === true), true);
    assert.equal(ea.calls.length, 3);
    const current = store.current();
    assert.match(current, /^session-token-/);
    assert.equal(readFileSync(ctx.tokenFile, 'utf8').trim(), current);
    assert.equal(statSync(ctx.tokenFile).mode & 0o777, 0o600);
    assert.ok(readSupervisorState(ctx.statePath).expiresAt > clock.now());
    await server.close();
  } finally { ctx.cleanup(); }
});
