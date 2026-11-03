import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { verifyResourceOnce } from '../../lib/engine/publication/remote.js';

const payload = Buffer.from('hello from qms live 001', 'utf8');
const resource = {
  id: 'res_readback_fixture',
  service: 'DOCUMENT',
  name: 'developer iffi',
  identifier: 'qms-dev-readback-fixture',
  bytes: payload.length,
  sha256: 'sha256:' + createHash('sha256').update(payload).digest('hex')
};

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      baseUrl: 'http://127.0.0.1:' + server.address().port
    }));
  });
}

function route(req, res, body, type) {
  res.writeHead(200, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

test('properties directory size is diagnostic, not payload size', async (t) => {
  const fixture = await listen((req, res) => {
    const url = req.url || '';
    if (url.startsWith('/arbitrary/resource/properties/DOCUMENT/developer%20iffi/qms-dev-readback-fixture')) {
      return route(req, res, JSON.stringify({ size: 163, filename: 'qms-dev-readback-fixture', mimeType: 'text/plain' }), 'application/json');
    }
    if (url.startsWith('/arbitrary/resource/status/DOCUMENT/developer%20iffi/qms-dev-readback-fixture')) {
      return route(req, res, JSON.stringify({ status: 'READY' }), 'application/json');
    }
    if (url.startsWith('/arbitrary/DOCUMENT/developer%20iffi/qms-dev-readback-fixture')) {
      return route(req, res, payload.toString('base64'), 'text/plain');
    }
    res.writeHead(404); res.end('not found');
  });
  t.after(() => fixture.server.close());
  const result = await verifyResourceOnce({ fetchImpl: fetch, nodeUrl: fixture.baseUrl, resource });
  assert.equal(result.state, 'remote_verified');
  assert.equal(result.evidence.remoteBytes, payload.length);
  assert.equal(result.evidence.properties.size, 163);
  assert.equal(result.evidence.httpStatus, 200);
  assert.equal(result.evidence.contentType, 'text/plain');
});

test('a 163-byte API/HTML response is never treated as document bytes', async (t) => {
  const errorBody = '<html><body>Qortal API error response, not the document</body></html>';
  const fixture = await listen((req, res) => {
    const url = req.url || '';
    if (url.startsWith('/arbitrary/resource/properties/DOCUMENT/developer%20iffi/qms-dev-readback-fixture')) {
      return route(req, res, JSON.stringify({ size: errorBody.length }), 'application/json');
    }
    if (url.startsWith('/arbitrary/resource/status/DOCUMENT/developer%20iffi/qms-dev-readback-fixture')) {
      return route(req, res, JSON.stringify({ status: 'READY' }), 'application/json');
    }
    if (url.startsWith('/arbitrary/DOCUMENT/developer%20iffi/qms-dev-readback-fixture')) {
      return route(req, res, errorBody, 'text/html');
    }
    res.writeHead(404); res.end('not found');
  });
  t.after(() => fixture.server.close());
  const result = await verifyResourceOnce({ fetchImpl: fetch, nodeUrl: fixture.baseUrl, resource });
  assert.equal(result.state, 'ambiguous');
  assert.equal(result.code, 'TRANSPORT_NOT_BYTE_SAFE');
  assert.equal(result.evidence.bodyBytes, Buffer.byteLength(errorBody));
  assert.equal(result.evidence.contentType, 'text/html');
});
