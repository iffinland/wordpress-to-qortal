import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  composeCompletionMessage,
  createNotificationStore,
  notifyCompletion,
  redactSecrets,
  resolveNotificationConfig,
  retryPending,
  sendTelegram
} from '../../scripts/notify/telegram-notify.mjs';

const REPORT = {
  runId: 'run-42',
  title: 'CMS links, search, publishing and release',
  summary: 'All gates passed.',
  branch: 'agent/cms-links-search-release',
  remoteSha: 'abc123def456',
  releaseUrl: 'https://github.com/iffinland/wordpress-to-qortal/releases/tag/v0.8.0-alpha.6',
  pr: '#21',
  artifacts: [
    { name: 'qortal-migration-studio_0.8.0-alpha.6_amd64.deb', bytes: 1234, sha256: 'a'.repeat(64) },
    { name: 'qortal-migration-generic-cms-v0.8.0-alpha.4.zip', bytes: 5678, sha256: 'b'.repeat(64) }
  ],
  limitations: ['No signed mainnet publish was attempted.'],
  registry: { path: 'release/qms-update-registry-handoff.zip', sha256: 'c'.repeat(64) }
};

const ENV = { TELEGRAM_BOT_TOKEN: 'bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ', TELEGRAM_CHAT_ID: '42' };

async function tempOutbox() {
  return await mkdtemp(path.join(tmpdir(), 'qms-notify-'));
}

function okFetch() {
  return async () => ({ ok: true, status: 200, text: async () => '' });
}

test('delivers the actual final report and records it durably', async () => {
  const dir = await tempOutbox();
  try {
    const calls = [];
    const result = await notifyCompletion({
      report: REPORT, status: 'success', outboxDir: dir, env: ENV,
      fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => '' }; }
    });
    assert.equal(result.delivered, true);
    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0].init.body);
    assert.match(body.text, /\[QMS success\]/);
    assert.match(body.text, /Remote main: abc123def456/);
    assert.match(body.text, /qortal-migration-generic-cms-v0\.8\.0-alpha\.4\.zip \(5678 bytes\) sha256 b{64}/);
    assert.match(body.text, /No signed mainnet publish was attempted/);
    assert.doesNotMatch(body.text, new RegExp(ENV.TELEGRAM_BOT_TOKEN));
    const sent = JSON.parse(await readFile(path.join(dir, 'sent', result.dedupeKey + '.json'), 'utf8'));
    assert.equal(sent.state, 'sent');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('is idempotent for the same report and dedupe key', async () => {
  const dir = await tempOutbox();
  try {
    let calls = 0;
    const options = {
      report: REPORT, status: 'success', outboxDir: dir, env: ENV, dedupe: 'run-42',
      fetchImpl: async () => { calls += 1; return { ok: true, status: 200, text: async () => '' }; }
    };
    const first = await notifyCompletion(options);
    const second = await notifyCompletion(options);
    assert.equal(first.delivered, true);
    assert.equal(second.duplicate, true);
    assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('records a pending report when credentials are not configured', async () => {
  const dir = await tempOutbox();
  try {
    const result = await notifyCompletion({ report: REPORT, status: 'success', outboxDir: dir, env: {} });
    assert.equal(result.ok, true);
    assert.equal(result.pending, true);
    const store = createNotificationStore(dir);
    const pending = await store.pending();
    assert.equal(pending.length, 1);
    assert.match(pending[0].message, /Remote main: abc123def456/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('composes status-specific reports for failure, timeout and blocked', () => {
  for (const [status, marker] of [['failure', '[QMS failure]'], ['timeout', '[QMS timeout]'], ['cancelled', '[QMS cancelled]'], ['blocked', '[QMS blocked]']]) {
    const message = composeCompletionMessage(REPORT, status);
    assert.ok(message.startsWith(marker), status);
    assert.match(message, /Release: https:\/\/github\.com/);
  }
});

test('retains the report when the Telegram API fails and delivers on retry', async () => {
  const dir = await tempOutbox();
  try {
    const failing = await notifyCompletion({
      report: REPORT, status: 'failure', outboxDir: dir, env: ENV,
      fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'internal error' })
    });
    assert.equal(failing.ok, false);
    assert.equal(failing.pending, true);
    const pending = await createNotificationStore(dir).pending();
    assert.equal(pending.length, 1);
    assert.match(pending[0].lastError, /HTTP 500/);
    assert.equal(pending[0].attempts, 1);

    const delivered = await retryPending({ outboxDir: dir, env: ENV, fetchImpl: okFetch() });
    assert.equal(delivered.delivered, 1);
    assert.equal(delivered.pending, 0);
    const after = await createNotificationStore(dir).pending();
    assert.equal(after.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('treats a slow Telegram endpoint as a timeout without throwing', async () => {
  const dir = await tempOutbox();
  try {
    const result = await notifyCompletion({
      report: REPORT, status: 'timeout', outboxDir: dir, env: ENV, timeoutMs: 5,
      fetchImpl: (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })
    });
    assert.equal(result.ok, false);
    assert.equal(result.pending, true);
    assert.match(result.error, /timed out/);
    const pending = await createNotificationStore(dir).pending();
    assert.equal(pending.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('redacts bot tokens and chat ids from errors and messages', async () => {
  const secret = ENV.TELEGRAM_BOT_TOKEN;
  assert.doesNotMatch(redactSecrets('failed with ' + secret), new RegExp(secret));
  const config = resolveNotificationConfig({ TELEGRAM_BOT_TOKEN: secret, TELEGRAM_CHAT_ID: '42' });
  assert.equal(config.configured, true);
  const result = await sendTelegram('hello', config, {
    fetchImpl: async () => { throw new Error('request for bot' + secret.replace(/^bot/, '') + ' failed'); }
  });
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, new RegExp(secret.split(':')[1]));
});

test('refuses an unsupported notification status', async () => {
  const dir = await tempOutbox();
  try {
    const result = await notifyCompletion({ report: REPORT, status: 'started', outboxDir: dir, env: {} });
    assert.equal(result.ok, false);
    assert.match(result.error, /Unsupported notification status/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
