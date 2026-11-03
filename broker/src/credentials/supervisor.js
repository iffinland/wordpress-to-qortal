#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeSync
} from 'node:fs';
import { dirname } from 'node:path';
import { CREDENTIAL_SOCKET_SCHEMA } from './socket.js';

export const SUPERVISOR_SCHEMA = 'qms-auth-credential-supervisor@1';
const TOKEN = /^[A-Za-z0-9._~+\/-]{20,4096}$/;

function log(message) {
  process.stderr.write('[qms-auth-credential] ' + message + '\n');
}

function readPrivateJson(file, label) {
  let info;
  try {
    info = statSync(file);
  } catch (error) {
    throw new Error('Unable to stat ' + label + ': ' + error.message);
  }
  if (!info.isFile()) throw new Error(label + ' is not a regular file.');
  if ((info.mode & 0o077) !== 0) throw new Error(label + ' must not be readable by group or other users.');
  if (process.getuid && info.uid !== process.getuid()) throw new Error(label + ' must be owned by the supervisor user.');
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error(label + ' is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error(label + ' is not an object.');
  return parsed;
}

function writePrivateJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.tmp-' + process.pid + '-' + randomBytes(6).toString('hex');
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, JSON.stringify(value, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

export function loadSupervisorConfig(file) {
  const cfg = readPrivateJson(file, 'supervisor config');
  if (cfg.schema !== SUPERVISOR_SCHEMA) throw new Error('Unsupported supervisor config schema.');
  for (const field of ['baseUrl', 'appSecretFile', 'socketPath', 'statePath']) {
    if (typeof cfg[field] !== 'string' || cfg[field].length === 0) throw new Error('supervisor config ' + field + ' is required.');
  }
  if (!cfg.baseUrl.startsWith('http://127.0.0.1:') && !cfg.baseUrl.startsWith('http://localhost:')) {
    throw new Error('External Auth baseUrl must be loopback.');
  }
  return {
    schema: SUPERVISOR_SCHEMA,
    baseUrl: cfg.baseUrl.replace(/\/+$/, ''),
    appSecretFile: cfg.appSecretFile,
    socketPath: cfg.socketPath,
    statePath: cfg.statePath,
    renewBeforeMs: Number.isInteger(cfg.renewBeforeMs) ? cfg.renewBeforeMs : 20 * 60 * 1000,
    timeoutMs: Number.isInteger(cfg.timeoutMs) ? cfg.timeoutMs : 15000
  };
}

export function readAppCredentials(file) {
  const app = readPrivateJson(file, 'External Auth app credentials');
  if (typeof app.appId !== 'string' || !/^[0-9a-f-]{20,64}$/i.test(app.appId)) {
    throw new Error('appId is missing or malformed.');
  }
  if (typeof app.appSecret !== 'string' || !/^[0-9a-f-]{20,64}$/i.test(app.appSecret)) {
    throw new Error('appSecret is missing or malformed.');
  }
  return { appId: app.appId, appSecret: app.appSecret };
}

export function readSupervisorState(file) {
  if (!existsSync(file)) return null;
  const state = readPrivateJson(file, 'supervisor state');
  if (!Number.isSafeInteger(state.expiresAt)) return null;
  return state;
}

export async function createSession({ baseUrl, appId, appSecret, timeoutMs = 15000, fetchImpl = globalThis.fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(baseUrl + '/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId, appSecret }),
      signal: controller.signal,
      redirect: 'error'
    });
  } catch (error) {
    throw new Error('External Auth session request failed: ' + (error instanceof Error ? error.message : String(error)));
  } finally {
    clearTimeout(timer);
  }
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    throw new Error('External Auth refused the session request with status ' + response.status + '.');
  }
  if (!parsed || typeof parsed.token !== 'string' || !TOKEN.test(parsed.token)) {
    throw new Error('External Auth returned no plausible session token.');
  }
  if (!Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Date.now()) {
    throw new Error('External Auth returned an invalid session expiry.');
  }
  return { token: parsed.token, expiresAt: parsed.expiresAt };
}

export function pushCredential({ socketPath, token, expiresAt, timeoutMs = 10000 }) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error('credential socket timeout'));
    });
    socket.on('connect', () => {
      socket.write(JSON.stringify({
        schema: CREDENTIAL_SOCKET_SCHEMA,
        op: 'renew',
        token,
        expiresAt
      }) + '\n');
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      socket.end();
      let parsed;
      try {
        parsed = JSON.parse(buffer.trim());
      } catch {
        reject(new Error('credential socket returned invalid JSON'));
        return;
      }
      if (!parsed || parsed.ok !== true) {
        reject(new Error('credential socket rejected the renewal: ' + (parsed?.error ?? 'unknown')));
        return;
      }
      resolve(parsed.credential);
    });
    socket.on('error', (error) => reject(new Error('credential socket error: ' + error.message)));
  });
}

function fingerprint(token) {
  return 'sha256:' + createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 16);
}

export async function runOnce({ configFile, force = false, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  const config = loadSupervisorConfig(configFile);
  const app = readAppCredentials(config.appSecretFile);
  const state = readSupervisorState(config.statePath);
  const at = now();
  if (!force && state && Number.isSafeInteger(state.expiresAt) && state.expiresAt - at > config.renewBeforeMs) {
    log('credential is valid for another ' + Math.round((state.expiresAt - at) / 1000) + 's; no renewal needed');
    return { renewed: false, expiresAt: state.expiresAt };
  }

  const session = await createSession({
    baseUrl: config.baseUrl,
    appId: app.appId,
    appSecret: app.appSecret,
    timeoutMs: config.timeoutMs,
    fetchImpl
  });
  const credential = await pushCredential({
    socketPath: config.socketPath,
    token: session.token,
    expiresAt: session.expiresAt,
    timeoutMs: config.timeoutMs
  });
  const next = {
    schema: 'qms-auth-credential-state@1',
    renewedAt: new Date(at).toISOString(),
    expiresAt: session.expiresAt,
    fingerprint: fingerprint(session.token),
    brokerFingerprint: credential?.fingerprint ?? null,
    socketPath: config.socketPath
  };
  writePrivateJsonAtomic(config.statePath, next);
  log('credential renewed; expires ' + new Date(session.expiresAt).toISOString() + '; fingerprint ' + next.fingerprint);
  return { renewed: true, expiresAt: session.expiresAt, fingerprint: next.fingerprint };
}

function parseArgs(argv) {
  const args = { configFile: process.env.QMS_AUTH_SUPERVISOR_CONFIG || '/etc/qms-qdn-auth-credential/supervisor.json', force: false, status: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') args.configFile = argv[++i];
    else if (arg === '--force') args.force = true;
    else if (arg === '--status') args.status = true;
    else if (arg === '--once') { /* default */ }
    else throw new Error('Unknown argument: ' + arg);
  }
  return args;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.status) {
      const state = readSupervisorState(loadSupervisorConfig(args.configFile).statePath);
      process.stdout.write(JSON.stringify(state ?? { schema: 'qms-auth-credential-state@1', present: false }) + '\n');
      process.exit(0);
    }
    const result = await runOnce({ configFile: args.configFile, force: args.force });
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(0);
  } catch (error) {
    log('renewal failed: ' + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
