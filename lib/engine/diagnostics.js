import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stableStringify } from '../model/content.js';
import { QmsError, ERROR_CODES } from './errors.js';

/**
 * Phase 8 diagnostics and support bundle.
 *
 * A support bundle is metadata-only: app and project health, run/recovery
 * state, cleanup records and a bounded audit timeline. It never contains
 * content bodies, credentials, authorization headers, cookies, session data,
 * wallet secrets or wallet addresses. Redaction is applied twice: while
 * building the document and again as a final assertion on the serialized
 * output. A bundle that fails the assertion is not written.
 */
export const SUPPORT_BUNDLE_SCHEMA = 'qms-support-bundle@1';
export const SUPPORT_BUNDLE_VERSION = 1;
export const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
export const MAX_BUNDLE_ARRAY = 2000;
export const MAX_BUNDLE_DEPTH = 8;

const SECRET_KEY = /(password|passwd|secret|token|apikey|api_key|seed|privatekey|private_key|wallet|authorization|cookie|session|credential|mnemonic|bearer)/i;
const ADDRESS_KEY = /^(address|accountAddress|ownerAddress|recipient|walletAddress)$/i;
const CONTENT_BODY_KEYS = new Set([
  'content', 'body', 'html', 'markdown', 'excerpt', 'raw', 'payload', 'text', 'rendered', 'blocks'
]);

const VALUE_PATTERNS = Object.freeze([
  /bearer\s+[a-z0-9._~+/=-]{8,}/i,
  /eyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}/i,
  /(?:password|passwd|secret|token|api[_-]?key|seed|private[_-]?key)\s*[:=]\s*\S+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /Q[1-9A-HJ-NP-Za-km-z]{40,60}/
]);

function fail(code, message, details) {
  throw new QmsError(code, message, { details });
}

function looksSecret(value) {
  if (typeof value !== 'string') return false;
  return VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

export function sanitizeDiagnostics(value, depth = 0) {
  if (depth > MAX_BUNDLE_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_BUNDLE_ARRAY).map((entry) => sanitizeDiagnostics(entry, depth + 1));
  }
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) {
        output[key] = '[redacted]';
        continue;
      }
      if (ADDRESS_KEY.test(key)) {
        output[key] = '[redacted-address]';
        continue;
      }
      if (CONTENT_BODY_KEYS.has(key.toLowerCase())) {
        output[key] = '[content-body-excluded]';
        continue;
      }
      output[key] = sanitizeDiagnostics(entry, depth + 1);
    }
    return output;
  }
  if (typeof value === 'string') {
    if (looksSecret(value)) return '[redacted]';
    return value.length > 4000 ? value.slice(0, 4000) + '...' : value;
  }
  return value;
}

/** Final defense-in-depth check on the serialized bundle. */
export function assertSafeBundle(bundle, { canaries = [] } = {}) {
  const serialized = stableStringify(bundle);
  for (const canary of canaries) {
    if (typeof canary === 'string' && canary.length >= 4 && serialized.includes(canary)) {
      fail(ERROR_CODES.DIAGNOSTICS_UNSAFE, 'The support bundle contains a secret canary and was refused.', {
        canaryIndex: canaries.indexOf(canary)
      });
    }
  }
  for (const pattern of VALUE_PATTERNS) {
    if (pattern.test(serialized)) {
      fail(ERROR_CODES.DIAGNOSTICS_UNSAFE, 'The support bundle contains credential-like text and was refused.');
    }
  }
  for (const key of CONTENT_BODY_KEYS) {
    if (new RegExp('"' + key + '"\\s*:').test(serialized) && !serialized.includes('"' + key + '":"[content-body-excluded]"')) {
      fail(ERROR_CODES.DIAGNOSTICS_UNSAFE, 'The support bundle contains a content body and was refused.', { key });
    }
  }
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > MAX_BUNDLE_BYTES) {
    fail(ERROR_CODES.INVALID_ARGUMENT, 'The support bundle exceeds the maximum size.', { bytes, max: MAX_BUNDLE_BYTES });
  }
  return { bytes, serialized };
}

export async function buildBundleDocument({
  handle,
  projectId,
  appInfo = {},
  settings = {},
  keyring = {},
  logLines = [],
  limits = {}
} = {}) {
  const createdAt = new Date().toISOString();
  const document = await handle.store.state;
  const snapshot = handle.snapshot();
  const recovery = await handle.recovery.status();
  const history = handle.history
    ? { summary: await handle.history.summary(), timeline: await handle.history.timeline({ limit: limits.history ?? 100 }) }
    : null;
  const cleanup = handle.cleanup ? handle.cleanup.list({ limit: limits.cleanup ?? 20 }) : [];
  const media = handle.media ? await handle.media.inspect() : null;
  const project = handle.project;
  const bundle = {
    schema: SUPPORT_BUNDLE_SCHEMA,
    version: SUPPORT_BUNDLE_VERSION,
    createdAt,
    product: 'Qortal Migration Studio',
    app: appInfo,
    settings,
    keyring,
    notes: [
      'Metadata only: credentials, authorization headers, cookies, session data, wallet secrets and addresses are redacted.',
      'Content bodies (HTML, Markdown, raw payloads) are excluded by key before this file is written.',
      'reserved means planned or prepared locally and never published.',
      'remote_verified requires exact Phase 5 QDN read-back and is never inferred from local files.'
    ],
    project: {
      id: projectId,
      name: project?.name ?? null,
      createdAt: project?.createdAt ?? null,
      updatedAt: project?.updatedAt ?? null,
      source: {
        adapter: project?.source?.adapter ?? null,
        baseUrl: project?.source?.baseUrl ?? null
      },
      target: project?.target ?? null,
      template: project?.template ?? null,
      schema: project?.schema ?? null,
      version: project?.version ?? null
    },
    stateHealth: {
      storeVersion: handle.store.storeVersion,
      lastTxnSeq: handle.store.lastTxnSeq,
      lastEventSeq: document.lastEventSeq,
      journalBytes: handle.store.journalBytes,
      recovery: handle.store.recovery ?? null,
      schema: document.schema
    },
    snapshot,
    recovery,
    history,
    cleanup,
    media,
    limits: {
      history: limits.history ?? 100,
      cleanup: limits.cleanup ?? 20,
      logLines: 100
    },
    engineLog: Array.isArray(logLines) ? logLines.slice(-100) : []
  };
  return { bundle: sanitizeDiagnostics(bundle), createdAt };
}

export async function writeSupportBundle({
  handle,
  projectId,
  dataRoot,
  appInfo = {},
  settings = {},
  keyring = {},
  logLines = [],
  canaries = [],
  limits = {}
} = {}) {
  const { bundle, createdAt } = await buildBundleDocument({
    handle, projectId, appInfo, settings, keyring, logLines, limits
  });
  const safe = assertSafeBundle(bundle, { canaries });
  const directory = path.join(dataRoot, 'exports');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const safeProject = String(projectId).replace(/[^a-z0-9-]/g, '');
  const file = path.join(directory, 'support-' + safeProject + '-' + createdAt.replace(/[:.]/g, '-') + '.json');
  await writeFile(file, safe.serialized + '\n', { mode: 0o600 });
  return {
    schema: SUPPORT_BUNDLE_SCHEMA,
    path: file,
    relativePath: path.relative(dataRoot, file).split(path.sep).join('/'),
    bytes: safe.bytes,
    createdAt,
    sections: ['app', 'settings', 'keyring', 'project', 'stateHealth', 'snapshot', 'recovery', 'history', 'cleanup', 'media', 'engineLog']
  };
}

