import { createHash, randomBytes } from 'node:crypto';
import {
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
import { BrokerError, BROKER_ERROR, fail } from '../errors.js';

export const CREDENTIAL_SCHEMA = 'qms-external-auth-credential@1';
const TOKEN = /^[A-Za-z0-9._~+\/-]{20,4096}$/;
const VALIDATION_PATH = '/settings';

export function tokenFingerprint(token) {
  return 'sha256:' + createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 16);
}

function assertTokenShape(token) {
  if (typeof token !== 'string' || !TOKEN.test(token)) {
    fail(BROKER_ERROR.UNAVAILABLE, 'The External Auth token is not a plausible bearer token.');
  }
  return token;
}

/**
 * The token file is the broker's durable last-known-good credential. It must be
 * a regular file owned by the broker service user and unreadable by group and
 * other users. Refusing anything else avoids silently trusting a widened file.
 */
export function readTokenFile(file, { expectedUid = process.getuid?.() } = {}) {
  let info;
  try {
    info = statSync(file);
  } catch (error) {
    fail(BROKER_ERROR.UNAVAILABLE, 'Unable to stat the External Auth token file.', { cause: error.message });
  }
  if (!info.isFile()) fail(BROKER_ERROR.UNAVAILABLE, 'The External Auth token path is not a regular file.');
  if ((info.mode & 0o077) !== 0) {
    fail(BROKER_ERROR.UNAVAILABLE, 'The External Auth token file must not be readable by group or other users.');
  }
  if (Number.isInteger(expectedUid) && info.uid !== expectedUid) {
    fail(BROKER_ERROR.UNAVAILABLE, 'The External Auth token file must be owned by the broker service user.');
  }
  let token;
  try {
    token = readFileSync(file, 'utf8').trim();
  } catch (error) {
    fail(BROKER_ERROR.UNAVAILABLE, 'Unable to read the External Auth token file.', { cause: error.message });
  }
  return assertTokenShape(token);
}

export function writeTokenFileAtomic(file, token) {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = file + '.tmp-' + process.pid + '-' + randomBytes(6).toString('hex');
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, token + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
}

/**
 * Credential state shared by the signing backend, the private credential
 * socket and the operator status surface. A failed reload never clears the
 * last known-good token and never touches broker state.
 */
export class ExternalAuthCredentialStore {
  constructor({
    tokenFile,
    validateToken,
    clock = () => Date.now(),
    onEvent = () => {},
    expectedUid = process.getuid?.()
  }) {
    this.tokenFile = tokenFile;
    this.validateToken = validateToken;
    this.clock = clock;
    this.onEvent = onEvent;
    this.expectedUid = expectedUid;
    this.token = null;
    this.loadedAt = null;
    this.expiresAt = null;
    this.fingerprint = null;
    this.source = null;
  }

  async open() {
    const token = readTokenFile(this.tokenFile, { expectedUid: this.expectedUid });
    await this.validate(token);
    this.#install(token, { source: 'startup', expiresAt: null });
    return this;
  }

  current() {
    if (!this.token) throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'The External Auth credential is not initialized.');
    return this.token;
  }

  async validate(token) {
    assertTokenShape(token);
    let ok = false;
    try {
      ok = await this.validateToken(token);
    } catch (error) {
      fail(BROKER_ERROR.UNAVAILABLE, 'The External Auth credential could not be validated.', {
        cause: error instanceof Error ? error.message : String(error)
      });
    }
    if (!ok) fail(BROKER_ERROR.UNAVAILABLE, 'External Auth rejected the credential during validation.');
    return true;
  }

  /**
   * Accept a renewed token from the signing-host-local supervisor. The new
   * token must validate against External Auth before it replaces the current
   * one; on any failure the old token remains in force.
   */
  async accept({ token, expiresAt = null, source = 'socket' }) {
    assertTokenShape(token);
    const now = this.clock();
    if (expiresAt !== null) {
      if (!Number.isFinite(expiresAt) || expiresAt <= now + 30000) {
        fail(BROKER_ERROR.UNAVAILABLE, 'The renewed External Auth credential is already expired or too short-lived.');
      }
      if (expiresAt > now + 8 * 86400000) {
        fail(BROKER_ERROR.UNAVAILABLE, 'The renewed External Auth credential lifetime is implausibly long.');
      }
    }
    await this.validate(token);
    writeTokenFileAtomic(this.tokenFile, token);
    this.#install(token, { source, expiresAt });
    return this.status();
  }

  async reloadFromFile() {
    const token = readTokenFile(this.tokenFile, { expectedUid: this.expectedUid });
    if (token === this.token) {
      this.onEvent('credential_reload_noop', { fingerprint: this.fingerprint });
      return this.status();
    }
    await this.validate(token);
    this.#install(token, { source: 'sighup', expiresAt: null });
    return this.status();
  }

  #install(token, { source, expiresAt }) {
    this.token = token;
    this.fingerprint = tokenFingerprint(token);
    this.loadedAt = new Date(this.clock()).toISOString();
    this.expiresAt = expiresAt;
    this.source = source;
    this.onEvent('credential_loaded', {
      fingerprint: this.fingerprint,
      source,
      expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString()
    });
  }

  status() {
    return {
      schema: CREDENTIAL_SCHEMA,
      present: Boolean(this.token),
      fingerprint: this.fingerprint,
      loadedAt: this.loadedAt,
      expiresAt: this.expiresAt === null ? null : new Date(this.expiresAt).toISOString(),
      source: this.source
    };
  }
}

/**
 * Validate a bearer token without any signing authority. GET /settings only
 * requires a live session; it never reads a wallet, asks for approval or
 * submits a transaction.
 */
export function createExternalAuthTokenValidator({
  baseUrl,
  timeoutMs = 10000,
  fetchImpl = globalThis.fetch
}) {
  const url = baseUrl.replace(/\/+$/, '') + VALIDATION_PATH;
  return async function validateToken(token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { authorization: 'Bearer ' + token },
        signal: controller.signal,
        redirect: 'error'
      });
      return response.ok;
    } finally {
      clearTimeout(timer);
    }
  };
}

export function credentialFileExists(file) {
  return existsSync(file);
}
