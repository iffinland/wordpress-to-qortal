import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, validateConfig, REQUIRED_TARGET_NAME, EXPECTED_TEST_OWNER } from '../../../broker/src/config.js';
import { BrokerState } from '../../../broker/src/state.js';
import { AuditLog } from '../../../broker/src/audit.js';
import { PublicationBroker } from '../../../broker/src/service.js';
import { createMockSigningBackend } from '../../../broker/src/signing/mock.js';
import { parseKeysConfig, createNonceCache, signRequest } from '../../../broker/src/auth.js';
import { createBrokerHttpServer } from '../../../broker/src/server.js';
import { sha256Bytes } from '../../../broker/src/util.js';

export const NAME = REQUIRED_TARGET_NAME;
export const OWNER = EXPECTED_TEST_OWNER;

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function deepMerge(base, override) {
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(override ?? {})) {
    if (isPlainObject(value) && isPlainObject(out[key])) out[key] = deepMerge(out[key], value);
    else out[key] = value;
  }
  return out;
}

let resourceCounter = 0;
let requestCounter = 0;

export function makeResource({
  identifier = null,
  content = 'hello qdn test',
  contentType = 'text/plain',
  id = null
} = {}) {
  resourceCounter += 1;
  const resolvedIdentifier = identifier ?? 'qms-dev-hello-' + String(resourceCounter).padStart(3, '0');
  const resolvedId = id ?? 'res_' + String(resourceCounter).padStart(8, '0');
  const bytes = Buffer.from(content, 'utf8');
  return {
    id: resolvedId,
    service: 'DOCUMENT',
    identifier: resolvedIdentifier,
    contentType,
    bytes: bytes.length,
    sha256: sha256Bytes(bytes),
    dataBase64: bytes.toString('base64')
  };
}

export function makeRequest(overrides = {}) {
  requestCounter += 1;
  return {
    schema: 'qms-test-publication-request@2',
    requestId: 'req_' + String(requestCounter).padStart(8, '0'),
    projectId: 'prj_corbett-test',
    target: { name: NAME, ownerAddress: OWNER },
    resources: [makeResource()],
    ...overrides
  };
}

function response(status, body) {
  const contentType = typeof body === 'string'
    ? (body.trim().startsWith('<') ? 'text/html' : 'text/plain')
    : 'application/json';
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? contentType : null;
      }
    },
    async json() {
      return typeof body === 'string' ? JSON.parse(body) : body;
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    }
  };
}

export function createFakeNode({ name = NAME, owner = OWNER } = {}) {
  const resources = new Map();
  const calls = [];
  let forceUnavailable = false;
  let unitFeeAtomic = 1000000;
  let balanceQort = '10.00000000';
  const feeQueue = [];
  const fetchImpl = async (input, init = {}) => {
    if (forceUnavailable) throw new Error('node unavailable');
    const url = new URL(typeof input === 'string' ? input : input.url);
    calls.push(url.pathname + url.search);
    const parts = url.pathname.split('/').slice(1).map((part) => decodeURIComponent(part));
    if (parts[0] === 'names' && parts.length === 2) {
      if (parts[1] !== name) return response(404, { error: 'name not found' });
      return response(200, { name, reducedName: name, owner, data: 'Registered Name on the Qortal Chain' });
    }
    if (parts[0] === 'arbitrary' && parts[1] === 'resource' && parts[2] === 'properties') {
      const [, , , service, resourceName, identifier] = parts;
      if (service !== 'DOCUMENT' || resourceName !== name) return response(404, { error: 'not found' });
      const bytes = resources.get(identifier);
      if (!bytes) return response(404, { error: 'not found' });
      return response(200, { size: bytes.length, status: 'READY' });
    }
    if (parts[0] === 'arbitrary' && parts[1] === 'resource' && parts[2] === 'status') {
      const identifier = parts[5];
      if (!resources.has(identifier)) return response(404, { error: 'not found' });
      return response(200, { status: 'READY' });
    }
    if (parts[0] === 'transactions' && parts[1] === 'unitfee') {
      return response(200, String(unitFeeAtomic));
    }
    if (parts[0] === 'transactions' && parts[1] === 'fee') {
      const fee = feeQueue.length > 0 ? feeQueue.shift() : unitFeeAtomic;
      return response(200, String(fee));
    }
    if (parts[0] === 'addresses' && parts[1] === 'balance') {
      if (!balanceQort) return response(500, { error: 'balance unavailable' });
      return response(200, balanceQort);
    }
    if (parts[0] === 'arbitrary' && parts.length === 4) {
      const [, service, resourceName, identifier] = parts;
      if (service !== 'DOCUMENT' || resourceName !== name) return response(404, { error: 'not found' });
      const bytes = resources.get(identifier);
      if (!bytes) return response(404, { error: 'not found' });
      if (url.searchParams.get('encoding') === 'base64') return response(200, bytes.toString('base64'));
      return response(200, bytes);
    }
    return response(404, { error: 'not found' });
  };
  return {
    fetchImpl,
    calls,
    resources,
    setName(value) { name = value; },
    setOwner(value) { owner = value; },
    put(identifier, bytes) { resources.set(identifier, Buffer.from(bytes)); },
    corrupt(identifier, bytes) { resources.set(identifier, Buffer.from(bytes)); },
    remove(identifier) { resources.delete(identifier); },
    failAll(value = true) { forceUnavailable = value; },
    published() { return [...resources.keys()]; },
    setUnitFee(value) { unitFeeAtomic = value; },
    queueFees(values) { feeQueue.push(...values); },
    setBalanceQort(value) { balanceQort = value; }
  };
}

export function createClientKey({
  keyId = 'agent-test',
  createdAt = Date.now() - 1000,
  enabled
} = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const keys = parseKeysConfig({
    schema: 'qms-broker-client-keys@2',
    keys: [{
      keyId,
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
      createdAt: new Date(createdAt).toISOString(),
      ...(enabled === undefined ? {} : { enabled })
    }]
  });
  return { keyId, privateKey, keys };
}

export function createLegacyClientKey({
  keyId = 'agent-legacy',
  issuedAt = Date.now() - 1000,
  expiresAt = Date.now() + 3600000
} = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const keys = parseKeysConfig({
    keys: [{
      keyId,
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString()
    }]
  });
  return { keyId, privateKey, keys };
}

export function makeConfig(overrides = {}, tmp = mkdtempSync(join(tmpdir(), 'qms-broker-'))) {
  const base = defaultConfig();
  base.server.port = 3199;
  base.qortal.nodeUrl = 'http://node.test';
  base.qortal.nameCheckTtlMs = 0;
  base.signing.backend = 'mock';
  base.policy.walletReserveQort = '0.001';
  base.signing.externalAuth.walletId = 'mock-wallet';
  base.readback.attempts = 2;
  base.readback.intervalMs = 0;
  base.readback.timeoutMs = 2000;
  base.auth.keysFile = join(tmp, 'clients.json');
  base.admin.socketPath = join(tmp, 'admin.sock');
  base.state.path = join(tmp, 'state.json');
  base.state.fsync = false;
  base.audit.path = join(tmp, 'audit.jsonl');
  base.killSwitch.path = join(tmp, 'DISABLED');
  return validateConfig(deepMerge(base, overrides));
}

export async function createTestBroker(overrides = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'qms-broker-'));
  let now = Date.parse('2026-11-03T10:00:00.000Z');
  const clock = () => now;
  const { backendResults, fakeNode, ...configOverrides } = overrides;
  const config = makeConfig(configOverrides, tmp);
  const node = createFakeNode(fakeNode ?? {});
  const backend = createMockSigningBackend({
    results: backendResults ?? [],
    onSigned: (request, outcome) => {
      if (outcome.remote === false) return;
      if (outcome.corruptRemote === true) {
        const intended = Buffer.from(request.dataBase64, 'base64');
        node.put(request.identifier, Buffer.alloc(intended.length, 0xff));
        return;
      }
      node.put(request.identifier, Buffer.from(request.dataBase64, 'base64'));
    }
  });
  const state = await BrokerState.open({ path: config.state.path, fsync: false, clock });
  const audit = AuditLog.open({ path: config.audit.path, clock, fsync: false });
  const broker = new PublicationBroker({
    config,
    state,
    audit,
    backend,
    fetchImpl: node.fetchImpl,
    clock,
    sleep: async () => {}
  });
  return {
    tmp,
    config,
    node,
    backend,
    state,
    audit,
    broker,
    clock,
    advance(ms) { now += ms; },
    setNow(value) { now = value; },
    cleanup() {
      audit.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  };
}

export async function startTestHttpServer(harness, { keyId = 'agent-test', keys = null } = {}) {
  const client = createClientKey({ keyId, createdAt: harness.clock() - 1000 });
  const nonceCache = createNonceCache();
  const server = createBrokerHttpServer({
    config: harness.config,
    broker: harness.broker,
    keys: keys ?? client.keys,
    nonceCache,
    clock: harness.clock,
    audit: harness.audit
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const baseUrl = 'http://127.0.0.1:' + port;
  let nonceCounter = 0;
  const nextNonce = () => 'nonce-' + String(++nonceCounter).padStart(20, '0');

  return {
    server,
    client,
    baseUrl,
    async request(method, path, body = null, {
      key = client,
      timestamp = harness.clock(),
      nonce = nextNonce(),
      headers: headerOverrides = null
    } = {}) {
      const bodyBytes = body === null ? Buffer.alloc(0) : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
      const headers = { ...signRequest({ method, path, bodyBytes, keyId: key.keyId, privateKey: key.privateKey, timestamp, nonce }), ...(headerOverrides ?? {}) };
      if (body !== null) headers['content-type'] = 'application/json';
      const response = await fetch(baseUrl + path, { method, headers, body: body === null ? undefined : bodyBytes });
      const text = await response.text();
      let parsed;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
      return { status: response.status, body: parsed };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

export function writeTokenFile(path, token) {
  writeFileSync(path, token + '\n', { mode: 0o600 });
}
