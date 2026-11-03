import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BrokerError, BROKER_ERROR } from './errors.js';
import { authenticateRequest, authorizeKeySession } from './auth.js';
import { issueAccessGrant, grantFingerprint, revokeKeyGrants } from './grants.js';

const MAX_ADMIN_LINE = 8192;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  });
  res.end(payload);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > maxBytes) {
        failed = true;
        req.resume();
        reject(new BrokerError(BROKER_ERROR.PAYLOAD_TOO_LARGE, 'The request body exceeds the configured limit.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on('error', (error) => {
      if (!failed) reject(error);
    });
  });
}

function parseJsonBody(bodyBytes) {
  if (bodyBytes.length === 0) {
    throw new BrokerError(BROKER_ERROR.INVALID_REQUEST, 'A JSON request body is required.');
  }
  let parsed;
  try {
    parsed = JSON.parse(bodyBytes.toString('utf8'));
  } catch {
    throw new BrokerError(BROKER_ERROR.INVALID_REQUEST, 'The request body is not valid JSON.');
  }
  return parsed;
}

/**
 * Network-facing broker API. It has exactly four routes and no generic proxy,
 * wallet, signing or admin surface. Admin operations use a separate Unix
 * socket with filesystem permissions.
 */
export function createBrokerHttpServer({ config, broker, keys, nonceCache, clock = () => Date.now(), audit = null }) {
  const server = createHttpServer(async (req, res) => {
    const started = clock();
    const timer = setTimeout(() => {
      req.destroy(new Error('request timeout'));
    }, config.server.requestTimeoutMs);
    timer.unref?.();

    let pathname = null;
    try {
      const url = new URL(req.url ?? '/', 'http://broker.invalid');
      pathname = url.pathname;
      if (url.search) throw new BrokerError(BROKER_ERROR.INVALID_REQUEST, 'Query strings are not supported on broker endpoints.');
      if (req.method === 'GET' && pathname === '/v1/health') {
        return json(res, broker.isDisabled() ? 503 : 200, { status: broker.isDisabled() ? 'disabled' : 'ok' });
      }
      const isRefresh = pathname === '/v1/auth/refresh';
      if (!isRefresh && pathname !== '/v1/publications' &&
          !/^\/v1\/publications\/pub_[a-f0-9]{24}(\/verify)?$/.test(pathname)) {
        return json(res, 404, { error: { code: 'NOT_FOUND', message: 'No such broker endpoint.' } });
      }
      if (isRefresh && req.method !== 'POST') {
        res.setHeader('allow', 'POST');
        return json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } });
      }
      if (!isRefresh && req.method !== 'POST' && req.method !== 'GET') {
        res.setHeader('allow', 'GET, POST');
        return json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } });
      }
      let bodyBytes = Buffer.alloc(0);
      if (req.method === 'POST') {
        bodyBytes = await readBody(req, config.server.maxBodyBytes);
      }
      const now = clock();
      const revokedKeys = new Set(broker.state.snapshot().revokedKeys);
      const keyId = req.headers['x-qms-key-id'];
      if (isRefresh) {
        const session = authorizeKeySession({
          keys,
          keyId,
          revokedKeys,
          now,
          maxAuthorizationLifetimeMs: config.auth.maxAuthorizationLifetimeMs
        });
        authenticateRequest({
          method: req.method,
          path: pathname,
          bodyBytes,
          headers: req.headers,
          keys,
          revokedKeys,
          nonceCache,
          now,
          clockSkewMs: config.auth.clockSkewMs,
          nonceTtlMs: config.auth.nonceTtlMs,
          requireGrant: false
        });
        broker.assertEnabled();
        const issuedAt = now;
        const issued = await broker.state.transact((draft) => {
          if (draft.disabled) {
            throw new BrokerError(BROKER_ERROR.DISABLED, 'The QDN test publisher is disabled.');
          }
          return issueAccessGrant({
            draft,
            keyId: session.keyId,
            now: issuedAt,
            ttlMs: config.auth.accessTtlMs,
            maxGrantsPerKey: config.auth.maxGrantsPerKey
          });
        });
        audit?.append('access_grant_issued', {
          keyId: session.keyId,
          grant: grantFingerprint(issued.hash),
          expiresAt: new Date(issued.grant.expiresAt).toISOString()
        });
        return json(res, 200, {
          schema: 'qms-broker-access@1',
          keyId: session.keyId,
          accessToken: issued.token,
          expiresAt: issued.grant.expiresAt,
          accessTtlMs: config.auth.accessTtlMs,
          keyExpiresAt: new Date(session.expiresAt).toISOString()
        });
      }
      const accessToken = req.headers['x-qms-access-token'] ??
        (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
          ? req.headers.authorization.slice(7)
          : null);
      const auth = authenticateRequest({
        method: req.method,
        path: pathname,
        bodyBytes,
        headers: req.headers,
        keys,
        revokedKeys,
        nonceCache,
        now,
        clockSkewMs: config.auth.clockSkewMs,
        nonceTtlMs: config.auth.nonceTtlMs,
        accessToken,
        grants: broker.state.snapshot().accessGrants,
        requireGrant: true
      });
      broker.assertEnabled();
      audit?.append('api_request', {
        keyId: auth.keyId,
        method: req.method,
        path: pathname,
        remoteAddress: req.socket.remoteAddress ?? null,
        grant: auth.grantHash ? grantFingerprint(auth.grantHash) : null
      });

      if (req.method === 'POST' && pathname === '/v1/publications') {
        const body = parseJsonBody(bodyBytes);
        const record = await broker.publish({ body, rawBody: bodyBytes, keyId: auth.keyId });
        return json(res, 200, { publication: record, requestMs: clock() - started });
      }

      const verifyMatch = /^\/v1\/publications\/(pub_[a-f0-9]{24})\/verify$/.exec(pathname);
      if (req.method === 'POST' && verifyMatch) {
        const record = await broker.revalidate(verifyMatch[1], auth.keyId);
        return json(res, 200, { publication: record, requestMs: clock() - started });
      }

      const statusMatch = /^\/v1\/publications\/(pub_[a-f0-9]{24})$/.exec(pathname);
      if (req.method === 'GET' && statusMatch) {
        const record = await broker.getPublication(statusMatch[1]);
        return json(res, 200, { publication: record, requestMs: clock() - started });
      }

      return json(res, 404, { error: { code: 'NOT_FOUND', message: 'No such broker endpoint.' } });
    } catch (error) {
      const brokerError = error instanceof BrokerError
        ? error
        : new BrokerError(BROKER_ERROR.INTERNAL, 'The broker could not process the request.');
      audit?.append('api_error', {
        path: pathname,
        code: brokerError.code,
        status: brokerError.status,
        message: brokerError.message
      });
      if (!res.headersSent) json(res, brokerError.status, { error: brokerError.toJSON() });
      else res.destroy();
    } finally {
      clearTimeout(timer);
    }
  });
  server.headersTimeout = config.server.headersTimeoutMs;
  server.requestTimeout = config.server.requestTimeoutMs;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 50;
  return server;
}

function writeKillSwitch(config, reason) {
  mkdirSync(dirname(config.killSwitch.path), { recursive: true, mode: 0o700 });
  writeFileSync(config.killSwitch.path, 'disabled at ' + new Date().toISOString() + ': ' + (reason || 'operator action') + '\n', { mode: 0o600 });
}

/**
 * Operator-only control plane over a Unix socket. It is intentionally not
 * reachable over TCP. The socket directory must be 0700 and owned by the
 * operator/broker account; the development agent has no account on this host.
 */
export function createAdminServer({ config, broker, audit, clock = () => Date.now() }) {
  const socketPath = config.admin.socketPath;
  let server = null;
  const handle = async (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return { ok: false, error: 'invalid_json' };
    }
    if (!message || typeof message.command !== 'string') return { ok: false, error: 'invalid_command' };
    switch (message.command) {
      case 'status':
        return { ok: true, status: await broker.status() };
      case 'disable': {
        if (typeof message.reason !== 'string' || message.reason.length < 3 || message.reason.length > 200) {
          return { ok: false, error: 'reason_required' };
        }
        await broker.state.transact((draft) => {
          draft.disabled = true;
          draft.disabledAt = new Date(clock()).toISOString();
          draft.disabledReason = message.reason;
        });
        writeKillSwitch(config, message.reason);
        audit?.append('emergency_disable', { reason: message.reason, at: new Date(clock()).toISOString() });
        return { ok: true, disabled: true };
      }
      case 'enable': {
        if (message.confirm !== 'ENABLE') return { ok: false, error: 'confirm_ENABLE_required' };
        await broker.state.transact((draft) => {
          draft.disabled = false;
          draft.disabledAt = null;
          draft.disabledReason = null;
        });
        if (existsSync(config.killSwitch.path)) rmSync(config.killSwitch.path, { force: true });
        audit?.append('emergency_enable', { at: new Date(clock()).toISOString() });
        return { ok: true, disabled: false };
      }
      case 'revoke-key': {
        if (typeof message.keyId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(message.keyId)) {
          return { ok: false, error: 'invalid_key_id' };
        }
        let revokedGrants = 0;
        await broker.state.transact((draft) => {
          if (!draft.revokedKeys.includes(message.keyId)) draft.revokedKeys.push(message.keyId);
          revokedGrants = revokeKeyGrants(draft, message.keyId);
        });
        audit?.append('key_revoked', {
          keyId: message.keyId,
          reason: message.reason ?? null,
          revokedGrants
        });
        return { ok: true, keyId: message.keyId, revoked: true, revokedGrants };
      }
      case 'unrevoke-key': {
        if (typeof message.keyId !== 'string') return { ok: false, error: 'invalid_key_id' };
        await broker.state.transact((draft) => {
          draft.revokedKeys = draft.revokedKeys.filter((key) => key !== message.keyId);
        });
        audit?.append('key_unrevoked', { keyId: message.keyId });
        return { ok: true, keyId: message.keyId, revoked: false };
      }
      default:
        return { ok: false, error: 'unknown_command' };
    }
  };

  return {
    handle,
    async listen() {
      mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
      if (existsSync(socketPath)) rmSync(socketPath, { force: true });
      server = createNetServer((socket) => {
        let buffer = '';
        socket.setEncoding('utf8');
        socket.setTimeout(10000, () => socket.destroy());
        socket.on('data', async (chunk) => {
          buffer += chunk;
          if (buffer.length > MAX_ADMIN_LINE) {
            socket.end(JSON.stringify({ ok: false, error: 'line_too_long' }) + '\n');
            return;
          }
          const newline = buffer.indexOf('\n');
          if (newline === -1) return;
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          let response;
          try {
            response = await handle(line);
          } catch {
            response = { ok: false, error: 'admin_operation_failed' };
          }
          socket.end(JSON.stringify(response) + '\n');
        });
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, () => {
          chmodSync(socketPath, 0o600);
          resolve();
        });
      });
      return this;
    },
    async close() {
      if (!server) return;
      await new Promise((resolve) => server.close(resolve));
      if (existsSync(socketPath)) rmSync(socketPath, { force: true });
      server = null;
    }
  };
}

export async function startHttpServer(server, config) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.server.port, config.server.host, resolve);
  });
  return server;
}
