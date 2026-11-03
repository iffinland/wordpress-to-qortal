import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExternalAuthSigningBackend } from '../../broker/src/signing/external-auth.js';
import { OWNER } from './support/harness.js';

const TOKEN = 'contract-test-token-0123456789';

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
 * A minimal Core stand-in for the one contract that matters here: Core binds
 * the /arbitrary?fee= query parameter to a Java Long in atomic units.
 */
async function startCore() {
  const requests = [];
  const { server, url } = await listen(async (req, res) => {
    const body = await readBody(req);
    requests.push({ method: req.method, url: req.url, body });
    const parsed = new URL(req.url, 'http://core.test');
    const fee = parsed.searchParams.get('fee');
    if (!/^[1-9][0-9]*$/.test(fee ?? '')) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Bad query parameter [fee]: ' + String(fee));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('UnsignedBytesBase58');
  });
  return { server, url, requests };
}

/**
 * Emulates the exact path construction in External Auth 0.2.0
 * publishQdnResource(): raw registeredName, fee forwarded verbatim.
 */
async function startExternalAuth(coreUrl) {
  const received = [];
  const { server, url } = await listen(async (req, res) => {
    const raw = await readBody(req);
    const payload = JSON.parse(raw);
    received.push(payload);
    let basePath = `/arbitrary/${payload.service}/${payload.registeredName}`;
    if (payload.identifier) basePath += `/${payload.identifier}`;
    basePath += '/base64';
    const query = new URLSearchParams({ fee: String(payload.fee) }).toString();
    const coreResponse = await fetch(coreUrl + basePath + '?' + query, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: payload.data
    });
    const text = await coreResponse.text();
    if (!coreResponse.ok) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: text }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ result: { signature: 'ContractSignature', creatorAddress: OWNER } }));
  });
  return { server, url, received };
}

test('atomic fee + space-containing name produce exactly one safe Core path', async () => {
  const core = await startCore();
  const externalAuth = await startExternalAuth(core.url);
  const dir = mkdtempSync(join(tmpdir(), 'qms-contract-'));
  const tokenFile = join(dir, 'token');
  writeFileSync(tokenFile, TOKEN);
  chmodSync(tokenFile, 0o600);
  try {
    const backend = new ExternalAuthSigningBackend({
      baseUrl: externalAuth.url,
      walletId: 'wallet-contract',
      tokenFile,
      expectedAddress: OWNER,
      timeoutMs: 5000
    });
    await backend.open();
    const outcome = await backend.publish({
      service: 'DOCUMENT',
      name: 'developer iffi',
      identifier: 'qms-dev-hello-003',
      dataBase64: Buffer.from('hello from qms').toString('base64'),
      feeAtomic: 1000000
    });
    assert.equal(outcome.state, 'signed');
    assert.equal(outcome.signature, 'ContractSignature');
    assert.equal(externalAuth.received.length, 1);
    assert.equal(externalAuth.received[0].fee, 1000000);
    assert.equal(externalAuth.received[0].identifier, 'qms-dev-hello-003');
    assert.equal(core.requests.length, 1);
    assert.equal(core.requests[0].method, 'POST');
    // Node fetch percent-encodes the internal space; %20 is decoded by Core
    // back to the exact registered display name.
    assert.equal(
      core.requests[0].url,
      '/arbitrary/DOCUMENT/developer%20iffi/qms-dev-hello-003/base64?fee=1000000'
    );
  } finally {
    core.server.close();
    externalAuth.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the legacy QORT decimal fee is rejected by the Core parameter contract', async () => {
  const core = await startCore();
  try {
    // Before the fix the broker converted 1000000 atomic to 0.01 QORT and
    // External Auth 0.2.0 forwarded fee=0.01 verbatim.
    const legacy = '/arbitrary/DOCUMENT/' + encodeURIComponent('developer iffi') + '/base64?fee=0.01';
    const response = await fetch(core.url + legacy, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: 'aGVsbG8gZnJvbSBxbXM='
    });
    assert.equal(response.status, 404);
    const text = await response.text();
    assert.match(text, /Bad query parameter \[fee\]: 0\.01/);
    assert.equal(core.requests[0].url, legacy);
  } finally {
    core.server.close();
  }
});

test('the broker never sends a fractional QORT fee to External Auth', async () => {
  const core = await startCore();
  const externalAuth = await startExternalAuth(core.url);
  const dir = mkdtempSync(join(tmpdir(), 'qms-contract-'));
  const tokenFile = join(dir, 'token');
  writeFileSync(tokenFile, TOKEN);
  chmodSync(tokenFile, 0o600);
  try {
    const backend = new ExternalAuthSigningBackend({
      baseUrl: externalAuth.url,
      walletId: 'wallet-contract',
      tokenFile,
      expectedAddress: OWNER,
      timeoutMs: 5000
    });
    await backend.open();
    await assert.rejects(
      backend.publish({
        service: 'DOCUMENT',
        name: 'developer iffi',
        identifier: 'qms-dev-hello-004',
        dataBase64: 'eA==',
        feeAtomic: 0.01
      }),
      (error) => error.code === 'FEE_INVALID'
    );
    assert.equal(externalAuth.received.length, 0);
    assert.equal(core.requests.length, 0);
  } finally {
    core.server.close();
    externalAuth.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
