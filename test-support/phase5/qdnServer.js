import http from 'node:http';
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';

function key(service, name, identifier) {
  return service + '|' + name + '|' + identifier;
}

/**
 * Minimal read-only QDN fixture. It implements the exact endpoints used by
 * verification, including encoding=base64, so binary hash comparisons are
 * tested without a live Qortal node.
 */
export async function startQdnServer({ resources = [], names = [], status = 'READY' } = {}) {
  const store = new Map();
  const nameStore = new Map();
  const requests = [];
  for (const record of names) nameStore.set(record.lookupName ?? record.name, record);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const sendJson = (code, body) => {
      response.writeHead(code, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    requests.push(request.url);
    if (parts[0] === 'names' && parts.length === 2) {
      const requested = decodeURIComponent(parts[1]);
      const record = nameStore.get(requested);
      if (!record) return sendJson(404, { error: 'name unknown' });
      return sendJson(200, record);
    }
    if (parts[0] === 'arbitrary' && parts[1] === 'resource' && parts[2] === 'properties') {
      const record = store.get(key(parts[3], parts[4], parts[5]));
      if (!record) return sendJson(404, { error: 'not found' });
      return sendJson(200, {
        filename: record.filename ?? null,
        mimeType: record.contentType ?? null,
        size: record.bytes.length
      });
    }
    if (parts[0] === 'arbitrary' && parts[1] === 'resource' && parts[2] === 'status') {
      const record = store.get(key(parts[3], parts[4], parts[5]));
      if (!record) return sendJson(404, { error: 'not found' });
      return sendJson(200, { status: record.status ?? status, title: record.status ?? status });
    }
    if (parts[0] === 'arbitrary' && parts.length === 4) {
      const record = store.get(key(parts[1], parts[2], parts[3]));
      if (!record) {
        response.writeHead(404);
        response.end('missing');
        return;
      }
      let payload = record.bytes;
      if (url.searchParams.has('filepath')) {
        const member = unzipSync(payload)[url.searchParams.get('filepath')];
        if (!member) return sendJson(404, { error: 'member missing' });
        payload = Buffer.from(member);
      }
      if (url.searchParams.get('encoding') === 'base64') {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end(payload.toString('base64'));
        return;
      }
      response.writeHead(200, { 'content-type': record.contentType ?? 'application/octet-stream' });
      response.end(payload);
      return;
    }
    sendJson(404, { error: 'not found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = 'http://127.0.0.1:' + address.port;
  return {
    url: baseUrl,
    requests,
    setName(record) {
      nameStore.set(record.lookupName ?? record.name, record);
      return record;
    },
    removeName(name) {
      nameStore.delete(name);
    },
    set(record) {
      store.set(key(record.service, record.name, record.identifier), {
        ...record,
        bytes: Buffer.isBuffer(record.bytes) ? record.bytes : Buffer.from(record.bytes)
      });
    },
    remove(service, name, identifier) {
      store.delete(key(service, name, identifier));
    },
    get(service, name, identifier) {
      return store.get(key(service, name, identifier));
    },
    sha256(service, name, identifier) {
      const record = store.get(key(service, name, identifier));
      return record ? 'sha256:' + createHash('sha256').update(record.bytes).digest('hex') : null;
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    }
  };
}
