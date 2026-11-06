#!/usr/bin/env node
/**
 * Durable completion notification.
 *
 * A finished run writes its real final report to an atomic outbox entry first.
 * Delivery is attempted only when Telegram credentials are configured through
 * the environment (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) or an explicit
 * SecretRef-style env file passed with --secrets-env. Tokens and chat ids are
 * never printed, never committed and never embedded in the report.
 *
 * The outbox is retry-safe: the dedupe key identifies one report, so repeated
 * dispatches and retries cannot send the same completion twice.
 *
 * Usage:
 *   node scripts/notify/telegram-notify.mjs --report=release/report.json --status=success
 *   node scripts/notify/telegram-notify.mjs --retry
 *   node scripts/notify/telegram-notify.mjs --report=... --status=blocked --dry-run
 *
 * Exit code is 0 when the report is durably recorded, even if delivery is
 * pending. A broken notification path must not fail the build.
 */
import { createHash } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const OUTBOX_SCHEMA = 'qms-completion-notification@1';
export const NOTIFICATION_STATUSES = Object.freeze(['success', 'failure', 'timeout', 'cancelled', 'blocked']);
const DEFAULT_TIMEOUT_MS = 10_000;
const TELEGRAM_LIMIT = 3900;

function repoRootFromModule() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function redactSecrets(value) {
  return String(value == null ? '' : value)
    .replace(/bot\d{6,}:[A-Za-z0-9_-]{20,}/g, 'bot<redacted>')
    .replace(/(?:TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID|BOT_TOKEN|CHAT_ID)\s*[=:]\s*\S+/gi, '$1=<redacted>');
}

export function composeCompletionMessage(report = {}, status = 'success') {
  const state = NOTIFICATION_STATUSES.includes(status) ? status : 'failure';
  const lines = [];
  lines.push('[QMS ' + state + '] ' + (report.title || 'Qortal Migration Studio run'));
  if (report.summary) lines.push(String(report.summary));
  if (report.branch) lines.push('Branch: ' + report.branch);
  if (report.remoteSha) lines.push('Remote main: ' + report.remoteSha);
  if (report.pr) lines.push('PR: ' + report.pr);
  if (report.releaseUrl) lines.push('Release: ' + report.releaseUrl);
  if (Array.isArray(report.artifacts) && report.artifacts.length > 0) {
    lines.push('Artifacts:');
    for (const artifact of report.artifacts) {
      const bytes = Number(artifact.bytes);
      lines.push('- ' + (artifact.name || 'artifact') + (Number.isFinite(bytes) ? ' (' + bytes + ' bytes)' : '') + (artifact.sha256 ? ' sha256 ' + artifact.sha256 : ''));
    }
  }
  if (report.registry && report.registry.path) {
    lines.push('Registry handoff: ' + report.registry.path + (report.registry.sha256 ? ' sha256 ' + report.registry.sha256 : ''));
  }
  if (Array.isArray(report.limitations) && report.limitations.length > 0) {
    lines.push('Limitations:');
    for (const limitation of report.limitations) lines.push('- ' + limitation);
  }
  if (report.details && typeof report.details === 'string') {
    lines.push('');
    lines.push(report.details);
  }
  const text = redactSecrets(lines.join('\n'));
  return text.length > TELEGRAM_LIMIT ? text.slice(0, TELEGRAM_LIMIT - 20) + '\n… (truncated)' : text;
}

export function dedupeKeyFor(report = {}, explicit = '') {
  if (explicit) return createHash('sha256').update(String(explicit)).digest('hex').slice(0, 32);
  const seed = [
    report.runId || '',
    report.branch || '',
    report.remoteSha || '',
    report.title || '',
    report.status || '',
    JSON.stringify(report.artifacts || [])
  ].join('|');
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

async function atomicWriteJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp-' + process.pid + '-' + Date.now();
  const handle = await open(temporary, 'w');
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

export function createNotificationStore(outboxDir) {
  const inbox = path.join(outboxDir, 'inbox');
  const sent = path.join(outboxDir, 'sent');
  return {
    outboxDir,
    inbox,
    sent,
    async enqueue(entry) {
      const file = path.join(inbox, entry.dedupeKey + '.json');
      const existing = await readJson(file);
      if (existing) {
        if (existing.state === 'sent') return { ok: true, duplicate: true, entry: existing };
        return { ok: true, duplicate: true, entry: existing };
      }
      await atomicWriteJson(file, entry);
      return { ok: true, duplicate: false, entry };
    },
    async pending() {
      let names = [];
      try { names = await readdir(inbox); } catch { return []; }
      const entries = [];
      for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
        const entry = await readJson(path.join(inbox, name));
        if (entry && entry.state !== 'sent') entries.push(entry);
      }
      return entries;
    },
    async markSent(entry, sentAt) {
      const file = path.join(inbox, entry.dedupeKey + '.json');
      const next = { ...entry, state: 'sent', sentAt, attempts: Number(entry.attempts || 0) + 1 };
      await atomicWriteJson(file, next);
      await mkdir(sent, { recursive: true });
      await atomicWriteJson(path.join(sent, entry.dedupeKey + '.json'), next);
      return next;
    },
    async markFailed(entry, error, attemptedAt) {
      const file = path.join(inbox, entry.dedupeKey + '.json');
      const next = {
        ...entry,
        state: 'pending',
        attempts: Number(entry.attempts || 0) + 1,
        lastAttemptAt: attemptedAt,
        lastError: redactSecrets(error).slice(0, 500)
      };
      await atomicWriteJson(file, next);
      return next;
    }
  };
}

async function parseEnvFile(file) {
  if (!file) return {};
  try {
    const raw = await readFile(file, 'utf8');
    const env = {};
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
    return env;
  } catch {
    return {};
  }
}

export function resolveNotificationConfig(env = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN || '';
  const chatId = env.TELEGRAM_CHAT_ID || '';
  return {
    configured: Boolean(token && chatId),
    token,
    chatId,
    apiBase: env.TELEGRAM_API_BASE || 'https://api.telegram.org'
  };
}

export async function sendTelegram(message, config, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!config.configured) return { ok: false, skipped: true, error: 'Telegram credentials are not configured.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(config.apiBase + '/bot' + config.token + '/sendMessage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chatId, text: message, disable_web_page_preview: true }),
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { ok: false, error: 'Telegram API returned HTTP ' + response.status + (detail ? ': ' + redactSecrets(detail).slice(0, 200) : '') };
    }
    return { ok: true };
  } catch (error) {
    const messageText = error && error.name === 'AbortError' ? 'Telegram request timed out.' : (error && error.message) || String(error);
    return { ok: false, error: redactSecrets(messageText) };
  } finally {
    clearTimeout(timer);
  }
}

export async function notifyCompletion({
  report = {},
  status = 'success',
  outboxDir = path.resolve(repoRootFromModule(), '.notify-outbox'),
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  dedupe = '',
  now = () => new Date().toISOString(),
  dryRun = false,
  log = () => undefined
} = {}) {
  if (!NOTIFICATION_STATUSES.includes(status)) {
    return { ok: false, error: 'Unsupported notification status: ' + status };
  }
  const store = createNotificationStore(outboxDir);
  const message = composeCompletionMessage(report, status);
  const dedupeKey = dedupeKeyFor({ ...report, status }, dedupe);
  const entry = {
    schema: OUTBOX_SCHEMA,
    dedupeKey,
    status,
    report,
    message,
    state: 'pending',
    attempts: 0,
    createdAt: now(),
    lastAttemptAt: null,
    lastError: null
  };
  const queued = await store.enqueue(entry);
  if (queued.duplicate && queued.entry.state === 'sent') {
    log('Notification already delivered for ' + dedupeKey + '.');
    return { ok: true, duplicate: true, delivered: true, dedupeKey, outboxDir };
  }
  if (dryRun) return { ok: true, dryRun: true, dedupeKey, outboxDir, message };

  const config = resolveNotificationConfig(env);
  if (!config.configured) {
    log('Telegram credentials are not configured; report kept in the durable outbox.');
    return { ok: true, pending: true, dedupeKey, outboxDir, message };
  }
  const result = await sendTelegram(message, config, { fetchImpl, timeoutMs });
  if (result.ok) {
    await store.markSent(queued.entry, now());
    return { ok: true, delivered: true, dedupeKey, outboxDir };
  }
  await store.markFailed(queued.entry, result.error, now());
  log('Telegram delivery failed; report retained for retry: ' + result.error);
  return { ok: false, pending: true, error: result.error, dedupeKey, outboxDir };
}

export async function retryPending({ outboxDir = path.resolve(repoRootFromModule(), '.notify-outbox'), env = process.env, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, now = () => new Date().toISOString() } = {}) {
  const store = createNotificationStore(outboxDir);
  const config = resolveNotificationConfig(env);
  const pending = await store.pending();
  if (pending.length === 0) return { ok: true, attempted: 0, delivered: 0, pending: 0 };
  if (!config.configured) return { ok: true, attempted: 0, delivered: 0, pending: pending.length, skipped: true };
  let delivered = 0;
  for (const entry of pending) {
    const result = await sendTelegram(entry.message, config, { fetchImpl, timeoutMs });
    if (result.ok) {
      await store.markSent(entry, now());
      delivered += 1;
    } else {
      await store.markFailed(entry, result.error, now());
    }
  }
  return { ok: delivered === pending.length, attempted: pending.length, delivered, pending: pending.length - delivered };
}

function argument(argv, name) {
  const prefix = '--' + name + '=';
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? '';
}

async function main(argv = process.argv.slice(2)) {
  const reportPath = argument(argv, 'report');
  const status = argument(argv, 'status') || 'success';
  const outboxDir = argument(argv, 'outbox') || path.resolve(repoRootFromModule(), '.notify-outbox');
  const dedupe = argument(argv, 'dedupe');
  const secretsEnv = argument(argv, 'secrets-env');
  const dryRun = argv.includes('--dry-run');
  const retry = argv.includes('--retry');
  const envFromFile = await parseEnvFile(secretsEnv);
  const env = { ...process.env, ...envFromFile };

  if (retry) {
    const result = await retryPending({ outboxDir, env });
    console.log('Notification retry: ' + result.delivered + ' delivered, ' + result.pending + ' pending.');
    return 0;
  }

  let report = {};
  if (reportPath) {
    try {
      report = JSON.parse(await readFile(reportPath, 'utf8'));
    } catch (error) {
      console.error('Could not read the completion report: ' + redactSecrets(error.message));
      return 0;
    }
  }
  const result = await notifyCompletion({
    report,
    status,
    outboxDir,
    env,
    dedupe,
    dryRun,
    log: (message) => console.log(redactSecrets(message))
  });
  if (result.delivered) console.log('Completion notification delivered.');
  else if (result.pending) console.log('Completion notification queued; dispatch is pending.');
  else if (result.dryRun) console.log(result.message);
  else if (result.error) console.error(redactSecrets(result.error));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => { process.exitCode = code; });
}
