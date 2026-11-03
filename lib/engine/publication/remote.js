import { QmsError, ERROR_CODES } from '../errors.js';
import { checkQortalName } from '../qortal-name.js';
import { sha256Bytes } from './handoff.js';

export const VERIFICATION_SCHEMA = 'qms-qdn-verification@1';
export const DEFAULT_ATTEMPTS = 6;
export const DEFAULT_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 60;
const MAX_INTERVAL_MS = 60000;
const MAX_BYTES = 20 * 1024 * 1024 * 1024;

function fail(code, message, details) {
  throw new QmsError(code, message, { details });
}

export function normalizeNodeUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(ERROR_CODES.PUBLICATION_REMOTE_UNAVAILABLE, 'A Qortal node URL is required for verification.');
  }
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    fail(ERROR_CODES.PUBLICATION_REMOTE_UNAVAILABLE, 'Qortal node URL is not a valid URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    fail(ERROR_CODES.PUBLICATION_REMOTE_UNAVAILABLE, 'Qortal node URL must use http or https.');
  }
  if (parsed.username || parsed.password) {
    fail(ERROR_CODES.PUBLICATION_REMOTE_UNAVAILABLE, 'Qortal node URL must not contain credentials.');
  }
  if (parsed.hash || parsed.search) {
    fail(ERROR_CODES.PUBLICATION_REMOTE_UNAVAILABLE, 'Qortal node URL must not contain a query or fragment.');
  }
  return (parsed.origin + parsed.pathname).replace(/\/+$/, '');
}

function endpoint(nodeUrl, path) {
  return nodeUrl + path;
}

/**
 * Encode one raw QDN path segment. encodeURIComponent produces %20 for a
 * space (never '+') and escapes '%' so a raw value is never double-encoded by
 * treating an already-encoded string as trusted input. Call this exactly once
 * on the registered display name.
 */
export function qdnPathSegment(value) {
  if (typeof value !== 'string' || value === '') {
    fail(ERROR_CODES.INVALID_ARGUMENT, 'A non-empty QDN path segment is required.');
  }
  return encodeURIComponent(value);
}

async function fetchWithTimeout(fetchImpl, url, { timeoutMs = 30000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal, headers, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

export function decodeBase64Payload(text) {
  if (typeof text !== 'string') {
    return null;
  }
  const compact = text.replace(/\s+/g, '');
  if (compact.length === 0) {
    return Buffer.alloc(0);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    return null;
  }
  try {
    return Buffer.from(compact, 'base64');
  } catch {
    return null;
  }
}

function statusString(status) {
  if (!status) return null;
  if (typeof status === 'string') return status;
  if (typeof status.status === 'string') return status.status;
  if (typeof status.status === 'number') {
    const names = {
      1: 'PUBLISHED',
      2: 'NOT_PUBLISHED',
      3: 'DOWNLOADING',
      4: 'DOWNLOADED',
      5: 'BUILDING',
      6: 'READY',
      7: 'MISSING_DATA',
      8: 'BUILD_FAILED',
      9: 'UNSUPPORTED',
      10: 'BLOCKED'
    };
    return names[status.status] ?? String(status.status);
  }
  return null;
}

/**
 * Verify that the exact registered display name is owned by the expected
 * address. Core's GET /names/{name} sanitizes the lookup key to reducedName and
 * returns the exact display name plus owner; reducedName is never accepted as
 * identity. Every non-verified outcome is 'blocked', including an unreachable
 * node, a missing name, a display-name mismatch or an owner mismatch.
 */
export async function verifyNameOwnership({
  fetchImpl = globalThis.fetch,
  nodeUrl,
  name,
  ownerAddress,
  timeoutMs = 30000
} = {}) {
  const base = normalizeNodeUrl(nodeUrl);
  const checked = checkQortalName(name);
  if (!checked.ok) {
    return { state: 'blocked', code: checked.code, message: checked.message, name: name ?? null };
  }
  if (typeof ownerAddress !== 'string' || !/^Q[1-9A-HJ-NP-Za-km-z]{20,50}$/.test(ownerAddress)) {
    return { state: 'blocked', code: 'OWNER_ADDRESS_INVALID', message: 'A valid Qortal owner address is required.', name: checked.name };
  }
  const url = endpoint(base, '/names/' + qdnPathSegment(checked.name));
  let response;
  try {
    response = await fetchWithTimeout(fetchImpl, url, { timeoutMs });
  } catch (error) {
    return { state: 'blocked', code: 'NODE_UNREACHABLE', message: error.message, name: checked.name, ownerAddress };
  }
  if (response.status === 401 || response.status === 403) {
    return { state: 'blocked', code: 'READ_NOT_AUTHORIZED', message: 'The node refused read access.', name: checked.name, ownerAddress };
  }
  if (response.status === 404) {
    return { state: 'blocked', code: 'NAME_NOT_FOUND', message: 'The name is not registered on this node.', name: checked.name, ownerAddress };
  }
  if (!response.ok) {
    return { state: 'blocked', code: 'NAME_LOOKUP_FAILED', message: 'Name lookup failed with HTTP ' + response.status + '.', name: checked.name, ownerAddress };
  }
  let record;
  try {
    record = await response.json();
  } catch {
    return { state: 'blocked', code: 'NAME_LOOKUP_INVALID', message: 'The node returned a non-JSON name record.', name: checked.name, ownerAddress };
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { state: 'blocked', code: 'NAME_LOOKUP_INVALID', message: 'The node returned an invalid name record.', name: checked.name, ownerAddress };
  }
  if (record.name !== checked.name) {
    return {
      state: 'blocked',
      code: 'NAME_MISMATCH',
      message: 'The node resolved a different display name; reducedName is not accepted as identity.',
      name: checked.name,
      ownerAddress,
      evidence: { requestedName: checked.name, resolvedName: record.name ?? null, reducedName: record.reducedName ?? null }
    };
  }
  if (record.owner !== ownerAddress) {
    return {
      state: 'blocked',
      code: 'OWNER_MISMATCH',
      message: 'The registered name is owned by a different address.',
      name: checked.name,
      ownerAddress,
      evidence: { requestedOwner: ownerAddress, actualOwner: record.owner ?? null }
    };
  }
  return {
    state: 'verified',
    code: 'NAME_OWNERSHIP_VERIFIED',
    message: 'The exact registered display name is owned by the expected address.',
    name: record.name,
    ownerAddress: record.owner,
    reducedName: record.reducedName ?? null,
    evidence: { url, requestedName: checked.name, resolvedName: record.name, owner: record.owner, reducedName: record.reducedName ?? null }
  };
}

/**
 * Read one QDN resource back through the supported Core HTTP API. The
 * encoding=base64 query is the transport-safe path: it preserves exact bytes
 * for binary and JSON resources. READY or a transaction signature alone is
 * never evidence; only the SHA-256 comparison is.
 */
export async function verifyResourceOnce({ fetchImpl = globalThis.fetch, nodeUrl, resource, timeoutMs = 30000 }) {
  const base = normalizeNodeUrl(nodeUrl);
  const service = encodeURIComponent(resource.service);
  const name = encodeURIComponent(resource.name);
  const identifier = encodeURIComponent(resource.identifier);
  const propertiesPath = '/arbitrary/resource/properties/' + service + '/' + name + '/' + identifier;
  let propertiesResponse;
  try {
    propertiesResponse = await fetchWithTimeout(fetchImpl, endpoint(base, propertiesPath), { timeoutMs });
  } catch (error) {
    return { state: 'unavailable', code: 'NODE_UNREACHABLE', message: error.message, transport: 'qdn-http' };
  }
  if (propertiesResponse.status === 401 || propertiesResponse.status === 403) {
    return { state: 'blocked', code: 'READ_NOT_AUTHORIZED', message: 'The node refused read access. Configure QDNAuthBypass or a public read-only node.', transport: 'qdn-http' };
  }
  if (propertiesResponse.status === 404) {
    return { state: 'pending', code: 'NOT_PUBLISHED', message: 'Resource is not present yet.', transport: 'qdn-http' };
  }
  if (!propertiesResponse.ok) {
    return { state: 'unavailable', code: 'PROPERTIES_FAILED', message: 'Properties request failed with HTTP ' + propertiesResponse.status + '.', transport: 'qdn-http' };
  }
  let properties = null;
  try {
    properties = await propertiesResponse.json();
  } catch {
    properties = null;
  }
  // Qortal Core getFileProperties() sets size to FileUtils.sizeOfDirectory(),
  // which includes the .qortal metadata directory and is not the payload size.
  // Properties are diagnostic only; the exact Base64 payload is authoritative.
  const propertiesDiagnostic = {
    httpStatus: propertiesResponse.status,
    contentType: propertiesResponse.headers.get('content-type') || null,
    size: properties && Number.isInteger(properties.size) ? properties.size : null,
    filename: properties?.filename ?? null,
    mimeType: properties?.mimeType ?? null
  };
  const statusPath = '/arbitrary/resource/status/' + service + '/' + name + '/' + identifier + '?build=true';
  try {
    const statusResponse = await fetchWithTimeout(fetchImpl, endpoint(base, statusPath), { timeoutMs });
    if (statusResponse.ok) {
      const status = statusString(await statusResponse.json().catch(() => null));
      if (status === 'NOT_PUBLISHED' || status === 'DOWNLOADING' || status === 'BUILDING') {
        return { state: 'pending', code: status, message: 'Resource is ' + status.toLowerCase() + '.', transport: 'qdn-http', evidence: { status } };
      }
      if (status === 'UNSUPPORTED' || status === 'BUILD_FAILED') {
        return { state: 'failed', code: status, message: 'Qortal reports ' + status + '.', transport: 'qdn-http', evidence: { status } };
      }
      if (status === 'BLOCKED') {
        return { state: 'blocked', code: status, message: 'The name is blocked by Qortal.', transport: 'qdn-http', evidence: { status } };
      }
      // READY, DOWNLOADED and PUBLISHED are hints only; bytes are still required.
    }
  } catch {
    // Status is advisory. Continue to the exact byte read.
  }
  let payloadResponse;
  try {
    payloadResponse = await fetchWithTimeout(
      fetchImpl,
      endpoint(base, '/arbitrary/' + service + '/' + name + '/' + identifier + '?encoding=base64'),
      { timeoutMs: Math.max(timeoutMs, 60000) }
    );
  } catch (error) {
    return { state: 'unavailable', code: 'NODE_UNREACHABLE', message: error.message, transport: 'qdn-http' };
  }
  if (payloadResponse.status === 401 || payloadResponse.status === 403) {
    return { state: 'blocked', code: 'READ_NOT_AUTHORIZED', message: 'The node refused read access.', transport: 'qdn-http' };
  }
  if (payloadResponse.status === 404) {
    return { state: 'pending', code: 'NOT_PUBLISHED', message: 'Resource bytes are not available yet.', transport: 'qdn-http' };
  }
  if (!payloadResponse.ok) {
    return { state: 'unavailable', code: 'READ_FAILED', message: 'Byte read failed with HTTP ' + payloadResponse.status + '.', transport: 'qdn-http' };
  }
  const text = await payloadResponse.text();
  const payloadContentType = payloadResponse.headers.get('content-type') || null;
  const payloadBodyBytes = Buffer.byteLength(text, 'utf8');
  if (text.length > MAX_BYTES * 2) {
    return { state: 'blocked', code: 'RESPONSE_TOO_LARGE', message: 'Read-back exceeds the verification size cap.', transport: 'qdn-http' };
  }
  const bytes = decodeBase64Payload(text);
  if (!bytes) {
    return {
      state: 'ambiguous',
      code: 'TRANSPORT_NOT_BYTE_SAFE',
      message: 'The node returned a non-base64 body; exact hash comparison is impossible.',
      transport: 'qdn-http-parsed',
      evidence: { httpStatus: payloadResponse.status, contentType: payloadContentType, bodyBytes: payloadBodyBytes, properties: propertiesDiagnostic }
    };
  }
  const actualHash = sha256Bytes(bytes);
  if (bytes.length !== resource.bytes || actualHash !== resource.sha256) {
    return {
      state: 'ambiguous',
      code: 'READBACK_MISMATCH',
      message: 'Remote bytes do not match the intended payload.',
      transport: 'qdn-http-base64',
      evidence: {
        expectedBytes: resource.bytes,
        remoteBytes: bytes.length,
        expectedHash: resource.sha256,
        remoteHash: actualHash,
        checkedAt: new Date().toISOString(),
        httpStatus: payloadResponse.status,
        contentType: payloadContentType,
        bodyBytes: payloadBodyBytes,
        properties: propertiesDiagnostic
      }
    };
  }
  return {
    state: 'remote_verified',
    code: 'EXACT_READBACK_VERIFIED',
    message: 'Exact QDN bytes match the intended SHA-256.',
    transport: 'qdn-http-base64',
    evidence: {
      expectedBytes: resource.bytes,
      remoteBytes: bytes.length,
      expectedHash: resource.sha256,
      remoteHash: actualHash,
      checkedAt: new Date().toISOString(),
      httpStatus: payloadResponse.status,
      contentType: payloadContentType,
      bodyBytes: payloadBodyBytes,
      properties: propertiesDiagnostic,
      service: resource.service,
      name: resource.name,
      identifier: resource.identifier
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bounded polling. Pending/unavailable results remain unverified; they are
 * never promoted to success. Ambiguous stays ambiguous for reconciliation.
 */
export async function verifyResources({
  fetchImpl = globalThis.fetch,
  nodeUrl,
  resources,
  attempts = DEFAULT_ATTEMPTS,
  intervalMs = DEFAULT_INTERVAL_MS,
  timeoutMs = 30000
}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS) {
    fail(ERROR_CODES.INVALID_ARGUMENT, 'attempts must be an integer between 1 and ' + MAX_ATTEMPTS + '.');
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > MAX_INTERVAL_MS) {
    fail(ERROR_CODES.INVALID_ARGUMENT, 'intervalMs is invalid.');
  }
  const normalized = normalizeNodeUrl(nodeUrl);
  const results = new Map();
  let pending = resources.slice();
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const next = [];
    for (const resource of pending) {
      const result = await verifyResourceOnce({ fetchImpl, nodeUrl: normalized, resource, timeoutMs });
      results.set(resource.id, { ...result, attempts: attempt });
      if (result.state === 'pending' || result.state === 'unavailable') {
        next.push(resource);
      }
    }
    pending = next;
    if (pending.length === 0) break;
    if (attempt < attempts) await sleep(intervalMs);
  }
  for (const resource of pending) {
    const last = results.get(resource.id);
    results.set(resource.id, {
      ...(last ?? {}),
      state: last?.state === 'pending' ? 'pending' : 'unavailable',
      code: last?.code ?? 'VERIFICATION_INCONCLUSIVE',
      message: last?.message ?? 'Verification did not complete.',
      attempts: last?.attempts ?? attempts
    });
  }
  const values = resources.map((resource) => ({ resourceId: resource.id, ...results.get(resource.id) }));
  const counts = {};
  for (const value of values) counts[value.state] = (counts[value.state] ?? 0) + 1;
  return {
    schema: VERIFICATION_SCHEMA,
    version: 1,
    nodeUrl: normalized,
    checkedAt: new Date().toISOString(),
    counts,
    results: values
  };
}
