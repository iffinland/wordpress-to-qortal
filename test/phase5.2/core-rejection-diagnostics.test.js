import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExternalAuthSigningBackend } from '../../broker/src/signing/external-auth.js';
import { OWNER } from './support/harness.js';

const TOKEN = 'core-gate-token-0123456789abcdef';
const CORE_API_KEY = 'core-api-key-fixture-0123456789';
const IDENTIFIER = 'qms-dev-final-002';

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      url: 'http://127.0.0.1:' + server.address().port
    }));
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

/**
 * Qortal Core 6.1.9 stand-in for the first gate after parameter binding:
 * ArbitraryResource.postBase64EncodedData() calls Security.checkApiCallAllowed
 * before it looks up the registered name. localAuthBypassEnabled defaults to
 * false, so a loopback POST without X-API-KEY gets 401 UNAUTHORIZED.
 */
async function startCore({ apiKey = CORE_API_KEY } = {}) {
  const requests = [];
  const { server, url } = await listen(async (req, res) => {
    const body = await readBody(req);
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    const key = req.headers['x-api-key'];
    if (!apiKey) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 401, message: 'API key not generated', timestamp: 1 }));
      return;
    }
    if (!key) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 401, message: "Missing 'X-API-KEY' header", timestamp: 1 }));
      return;
    }
    if (key !== apiKey) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 401, message: 'API key invalid', timestamp: 1 }));
      return;
    }
    const parsed = new URL(req.url, 'http://core.test');
    const fee = parsed.searchParams.get('fee');
    if (!/^[1-9][0-9]*$/.test(fee ?? '')) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 400, message: 'Bad query parameter [fee]: ' + fee, timestamp: 1 }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('UnsignedBytesBase58');
  });
  return { server, url, requests };
}

/**
 * Emulates patched External Auth 0.2.0: exact atomic fee, encoded path
 * segments, identifier forwarding, optional Core API key, and the sanitized
 * structured diagnostic for a non-2xx Core publish response.
 */
async function startExternalAuth(coreUrl, { nodeApiKey = null } = {}) {
  const received = [];
  const { server, url } = await listen(async (req, res) => {
    const payload = JSON.parse(await readBody(req));
    received.push(payload);
    let path = '/arbitrary/' + encodeURIComponent(payload.service) + '/' + encodeURIComponent(payload.registeredName);
    if (payload.identifier) path += '/' + encodeURIComponent(payload.identifier);
    path += '/base64';
    const query = new URLSearchParams({ fee: String(payload.fee) }).toString();
    const headers = { 'content-type': 'application/octet-stream' };
    if (nodeApiKey) headers['x-api-key'] = nodeApiKey;
    const response = await fetch(coreUrl + path + '?' + query, {
      method: 'POST',
      headers,
      body: payload.data
    });
    const text = await response.text();
    if (!response.ok) {
      let message = text;
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed.message === 'string') message = parsed.message;
      } catch {}
      const code = /missing\s+['"]?x-api-key['"]?/i.test(message)
        ? 'CORE_API_KEY_MISSING'
        : /api key not generated/i.test(message)
          ? 'CORE_API_KEY_NOT_GENERATED'
          : /api key invalid/i.test(message)
            ? 'CORE_API_KEY_INVALID'
            : 'CORE_REQUEST_REJECTED';
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        error: 'publish_failed',
        diagnostic: {
          stage: 'upload',
          coreStatus: response.status,
          coreErrorCode: code,
          coreMessage: message
        }
      }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ result: { signature: 'MockSignature', creatorAddress: OWNER } }));
  });
  return { server, url, received };
}

function setupBackend(externalAuthUrl) {
  const dir = mkdtempSync(join(tmpdir(), 'qms-core-gate-'));
  const tokenFile = join(dir, 'token');
  writeFileSync(tokenFile, TOKEN);
  chmodSync(tokenFile, 0o600);
  const backend = new ExternalAuthSigningBackend({
    baseUrl: externalAuthUrl,
    walletId: 'wallet-core-gate',
    tokenFile,
    expectedAddress: OWNER,
    timeoutMs: 5000
  });
  return { dir, backend };
}

async function publish(backend) {
  await backend.open();
  return backend.publish({
    service: 'DOCUMENT',
    name: 'developer iffi',
    identifier: IDENTIFIER,
    dataBase64: Buffer.from('hello from qms final').toString('base64'),
    feeAtomic: 1000000
  });
}

test('without a Core API key the exact rejection is exposed as CORE_API_KEY_MISSING', async () => {
  const core = await startCore();
  const externalAuth = await startExternalAuth(core.url, { nodeApiKey: null });
  const { dir, backend } = setupBackend(externalAuth.url);
  try {
    const outcome = await publish(backend);
    assert.equal(outcome.state, 'failed');
    assert.equal(outcome.code, 'SIGNING_FAILED');
    assert.deepEqual(outcome.diagnostic, {
      httpStatus: 400,
      errorClass: 'REQUEST',
      errorCode: 'CORE_API_KEY_MISSING',
      stage: 'upload',
      coreStatus: 401,
      coreMessage: "Missing 'X-API-KEY' header"
    });
    assert.equal(core.requests.length, 1);
    // Exact Core contract: encoded name, forwarded identifier, atomic fee.
    assert.equal(
      core.requests[0].url,
      '/arbitrary/DOCUMENT/developer%20iffi/' + IDENTIFIER + '/base64?fee=1000000'
    );
    assert.equal(core.requests[0].headers['x-api-key'], undefined);
    assert.equal(externalAuth.received[0].fee, 1000000);
    assert.equal(externalAuth.received[0].identifier, IDENTIFIER);
  } finally {
    core.server.close();
    externalAuth.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('with the configured Core API key the same request reaches the signed path', async () => {
  const core = await startCore();
  const externalAuth = await startExternalAuth(core.url, { nodeApiKey: CORE_API_KEY });
  const { dir, backend } = setupBackend(externalAuth.url);
  try {
    const outcome = await publish(backend);
    assert.equal(outcome.state, 'signed');
    assert.equal(outcome.signature, 'MockSignature');
    assert.equal(core.requests.length, 1);
    assert.equal(core.requests[0].headers['x-api-key'], CORE_API_KEY);
    assert.equal(
      core.requests[0].url,
      '/arbitrary/DOCUMENT/developer%20iffi/' + IDENTIFIER + '/base64?fee=1000000'
    );
    assert.equal(core.requests[0].body, Buffer.from('hello from qms final').toString('base64'));
  } finally {
    core.server.close();
    externalAuth.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a Core "API key not generated" rejection is distinguishable from a missing header', async () => {
  const core = await startCore({ apiKey: null });
  const externalAuth = await startExternalAuth(core.url, { nodeApiKey: null });
  const { dir, backend } = setupBackend(externalAuth.url);
  try {
    const outcome = await publish(backend);
    assert.equal(outcome.diagnostic.errorCode, 'CORE_API_KEY_NOT_GENERATED');
    assert.equal(outcome.diagnostic.coreStatus, 401);
  } finally {
    core.server.close();
    externalAuth.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
