import { evaluateOwnership, evaluateRevalidation, requireOwner } from './ownership.js';

const DEFAULT_NODE = 'http://localhost:12391';
const READ_TIMEOUT_MS = 15000;
const READ_RETRIES = 1;
const RETRY_DELAY_MS = 350;
const inFlightReads = new Map();

function getInjectedGlobalBridge() {
  try {
    const candidate = Function('return typeof qortalRequest === "function" ? qortalRequest : null')();
    return typeof candidate === 'function' ? candidate : null;
  } catch {
    return null;
  }
}

function parentBridge() {
  try {
    if (window.parent && window.parent !== window && typeof window.parent.qortalRequest === 'function') return window.parent.qortalRequest;
  } catch {
    // Cross-frame access is not always allowed.
  }
  try {
    if (window.top && window.top !== window && typeof window.top.qortalRequest === 'function') return window.top.qortalRequest;
  } catch {
    // Cross-frame access is not always allowed.
  }
  try {
    if (window.opener && typeof window.opener.qortalRequest === 'function') return window.opener.qortalRequest;
  } catch {
    // Cross-frame access is not always allowed.
  }
  return null;
}

export function findQortalRequest() {
  if (typeof window !== 'undefined' && typeof window.qortalRequest === 'function') return window.qortalRequest;
  if (typeof globalThis.qortalRequest === 'function') return globalThis.qortalRequest;
  // Core's /apps/q-apps.js declares qortalRequest as a top-level const. That is
  // a global lexical binding, not a window property, so read it directly before
  // falling back to the Function probe. Hub Android provides it this way.
  try {
    if (typeof qortalRequest === 'function') return qortalRequest;
  } catch {
    // Not declared in this realm.
  }
  return parentBridge() || getInjectedGlobalBridge();
}

export function hasQortalBridge() {
  return Boolean(findQortalRequest());
}

export async function requestQortal(payload, timeoutMs = 60000) {
  const bridge = findQortalRequest();
  if (!bridge) throw new Error('The Qortal request API is only available inside Qortal UI.');
  return await new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('The Qortal request timed out.')), timeoutMs);
    Promise.resolve(bridge(payload))
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

export async function tryRequestQortal(payload, timeoutMs = 60000) {
  if (!hasQortalBridge()) return null;
  try {
    return await requestQortal(payload, timeoutMs);
  } catch {
    return null;
  }
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function hostedHttpOrigin() {
  if (typeof window === 'undefined' || !window.location) return '';
  if (!/^https?:$/.test(window.location.protocol)) return '';
  return stripTrailingSlash(window.location.origin);
}

function buildTimeNodeUrl() {
  const value = import.meta.env && import.meta.env.VITE_QORTAL_NODE_URL;
  return value ? stripTrailingSlash(value) : '';
}

/**
 * Pure node-URL resolver, exported for tests.
 *
 * A QDN page is served by a node at that node's own origin. In Qortal Hub the
 * page origin is the only address guaranteed to point at a node reachable from
 * the device (on Android there is no localhost node). A build-time default such
 * as http://localhost:12391 must therefore never win over the hosting origin.
 * The env override is used only for local development.
 */
export function resolveNodeBase(options = {}) {
  const origin = stripTrailingSlash(options.origin || '');
  const envUrl = stripTrailingSlash(options.envUrl || '');
  const fallback = stripTrailingSlash(options.fallback || DEFAULT_NODE);
  if (options.isDev) return envUrl || fallback;
  if (origin && /^https?:\/\//i.test(origin)) return origin;
  return envUrl || fallback;
}

export function getNodeUrl() {
  if (typeof window === 'undefined') return buildTimeNodeUrl() || DEFAULT_NODE;
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('node');
  if (fromQuery) return stripTrailingSlash(fromQuery);
  return resolveNodeBase({
    origin: hostedHttpOrigin(),
    envUrl: buildTimeNodeUrl(),
    isDev: Boolean(import.meta.env && import.meta.env.DEV)
  });
}

/**
 * Trusted node for authorization and fee decisions. Never derived from the
 * visitor-controlled ?node= query parameter, which could otherwise point
 * ownership checks at an attacker's fake node.
 */
export function getTrustedNodeUrl() {
  return resolveNodeBase({
    origin: hostedHttpOrigin(),
    envUrl: buildTimeNodeUrl(),
    isDev: Boolean(import.meta.env && import.meta.env.DEV)
  });
}

export function createQdnResourcePath(service, name, identifier) {
  return '/arbitrary/' + encodeURIComponent(service) + '/' + encodeURIComponent(name) + '/' + encodeURIComponent(identifier);
}

export function resolveQdnUrl(url) {
  return !hasQortalBridge() && url.startsWith('/arbitrary/') ? getNodeUrl() + url : url;
}

export function createQdnResourceUrl(service, name, identifier) {
  return resolveQdnUrl(createQdnResourcePath(service, name, identifier));
}

function shouldRetry(error) {
  const message = String(error && error.message ? error.message : error).toLowerCase();
  return !message.includes('404') && !message.includes("couldn't find put transaction") && !message.includes('timed out loading');
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchOnce(url, timeoutMs) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error('Failed to fetch QDN resource: HTTP ' + response.status + ' ' + url);
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Timed out loading QDN resource ' + url);
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchQdnResource(ref, timeoutMs = READ_TIMEOUT_MS) {
  const name = ref && ref.name ? ref.name : '';
  const url = createQdnResourceUrl(ref.service, name, ref.identifier);
  const existing = inFlightReads.get(url);
  if (existing) return existing;
  const operation = (async () => {
    let attempt = 0;
    let lastError = null;
    while (attempt <= READ_RETRIES) {
      try {
        return await fetchOnce(url, timeoutMs);
      } catch (error) {
        lastError = error;
        if (attempt >= READ_RETRIES || !shouldRetry(error)) break;
        await delay(RETRY_DELAY_MS * (attempt + 1));
      }
      attempt += 1;
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'QDN resource fetch failed'));
  })();
  inFlightReads.set(url, operation);
  try {
    return await operation;
  } finally {
    inFlightReads.delete(url);
  }
}

function validNameRecord(record) {
  return Boolean(record && typeof record.name === 'string' && typeof record.owner === 'string');
}

/**
 * Second independent read of the same on-chain fact. Some devices can reach
 * the Hub's connected node through the bridge but not the page origin (for
 * example a proxied Hub web build). The record still comes from a Qortal node,
 * and ownership is granted only when this record agrees exactly with the name
 * and with the active account address.
 */
async function fetchNameRecordThroughBridge(name) {
  if (!hasQortalBridge()) return null;
  const record = await tryRequestQortal({ action: 'GET_NAME_DATA', name }, 15000);
  return validNameRecord(record) ? record : null;
}

export async function fetchNameRecord(name, timeoutMs = 6000) {
  if (!name) return { record: null, error: 'No name was provided.', source: '' };
  let directError = '';
  try {
    const response = await fetch(getTrustedNodeUrl() + '/names/' + encodeURIComponent(name), {
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const record = await response.json();
    if (!validNameRecord(record)) throw new Error('The name record did not include name and owner.');
    return { record, error: null, source: 'node' };
  } catch (error) {
    directError = error && error.message ? error.message : String(error);
  }
  const bridged = await fetchNameRecordThroughBridge(name);
  if (bridged) return { record: bridged, error: null, source: 'bridge' };
  return { record: null, error: directError, source: '' };
}

/**
 * Qortal Hub and gateways hand the QDN name over percent-encoded
 * ("developer%20iffi"), while the node API expects the decoded name
 * ("developer iffi") and encodes it once when building the request URL.
 * Decode idempotently so every caller works with the real name and no
 * request can ever reach the node double-encoded (%2520).
 */
export function safeDecodeQdnName(value) {
  if (typeof value !== 'string') return '';
  let current = value;
  for (let pass = 0; pass < 2; pass += 1) {
    let next = current;
    try {
      next = decodeURIComponent(current.replace(/\+/g, ' '));
    } catch {
      break;
    }
    if (next === current) break;
    current = next;
  }
  return current.trim();
}

export function discoverQdnResource(fallbackName = '', fallbackIdentifier = 'default') {
  if (typeof window === 'undefined') return { name: fallbackName, identifier: fallbackIdentifier };
  try {
    const params = new URLSearchParams(window.location.search);
    const name = safeDecodeQdnName(params.get('name') || params.get('qdnName') || '');
    const identifier = params.get('identifier') || params.get('appIdentifier') || '';
    if (name) return { name, identifier: identifier || fallbackIdentifier };
  } catch {
    // Ignore malformed query strings.
  }
  try {
    const parts = window.location.pathname.split('/').filter(Boolean).map(safeDecodeQdnName);
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index].toUpperCase();
      if ((part === 'APP' || part === 'WEBSITE') && parts[index + 1]) {
        return { name: parts[index + 1], identifier: parts[index + 2] || fallbackIdentifier };
      }
    }
  } catch {
    // Ignore path access errors.
  }
  return { name: safeDecodeQdnName(fallbackName), identifier: fallbackIdentifier };
}

export function discoverQdnName(fallback = '') {
  if (typeof window === 'undefined') return safeDecodeQdnName(fallback);
  // Never read ?name= / ?qdnName= here. Query parameters are visitor-controlled
  // and must not be able to change which name owner authorization is checked
  // against. Only the actual hosting context and the published config count.
  const qortalWindow = window;
  const globals = [
    qortalWindow._qdnName,
    qortalWindow._qdnResource && qortalWindow._qdnResource.name,
    typeof qortalWindow._qdnResourceName === 'string' ? qortalWindow._qdnResourceName : ''
  ];
  for (const candidate of globals) {
    const decoded = safeDecodeQdnName(candidate);
    if (decoded) return decoded;
  }
  if (qortalWindow._qdnBase) {
    const match = String(qortalWindow._qdnBase).match(/\/(?:APP|WEBSITE)\/([^/?#]+)/i);
    if (match) {
      const decoded = safeDecodeQdnName(match[1]);
      if (decoded) return decoded;
    }
  }
  try {
    const parts = window.location.pathname.split('/').filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index].toUpperCase();
      if ((part === 'APP' || part === 'WEBSITE') && parts[index + 1]) {
        const decoded = safeDecodeQdnName(parts[index + 1]);
        if (decoded) return decoded;
      }
    }
  } catch {
    // Ignore path access errors.
  }
  return safeDecodeQdnName(fallback);
}

/**
 * The QDN name this document is actually served under. Query parameters are
 * intentionally ignored; only Host/Path/globals or the published config are
 * allowed. Returns '' when no trustworthy name exists.
 */
export function discoverHostedQdnName(fallback = '') {
  return discoverQdnName(fallback);
}

function accountNameList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === 'string') return entry;
    return (entry && (entry.name || entry.primaryName)) || '';
  }).filter(Boolean);
}

async function readIdentityFacts() {
  const account = await tryRequestQortal({ action: 'GET_USER_ACCOUNT' });
  const address = account && account.address ? String(account.address) : '';
  let names = [];
  let primaryName = '';
  if (address) {
    const [nameResult, primaryResult] = await Promise.all([
      tryRequestQortal({ action: 'GET_ACCOUNT_NAMES', address }),
      tryRequestQortal({ action: 'GET_PRIMARY_NAME', address })
    ]);
    names = accountNameList(nameResult);
    primaryName = typeof primaryResult === 'string' ? primaryResult : (primaryResult && primaryResult.name) || '';
  }
  if (account && account.name) names.push(account.name);
  if (account && account.primaryName) names.push(account.primaryName);
  if (primaryName) names.push(primaryName);
  return { account: address ? { address } : null, names: Array.from(new Set(names.filter(Boolean))), primaryName };
}

export async function resolveViewerIdentity(options = {}) {
  const qdnName = String(options.qdnName || discoverHostedQdnName('')).trim();
  const bridgeAvailable = hasQortalBridge();
  const facts = await readIdentityFacts();
  const nameResult = qdnName ? await fetchNameRecord(qdnName) : { record: null, error: null, source: '' };
  const identity = evaluateOwnership({
    qdnName,
    account: facts.account,
    accountNames: facts.names,
    nameRecord: nameResult.record,
    nameRecordSource: nameResult.source,
    nameRecordError: nameResult.error || '',
    bridgeAvailable,
    displayName: facts.primaryName || facts.names[0] || ''
  });
  if (nameResult.error && identity.nameRecordStatus !== 'verified') {
    return {
      ...identity,
      message: identity.message + ' Registry detail: ' + nameResult.error
    };
  }
  return identity;
}

/**
 * Ask Qortal Hub for the active account. This is the only supported way to
 * trigger the account permission prompt from a user gesture. It returns the
 * address for display/diagnostics; ownership is still decided by
 * resolveViewerIdentity against the node's name record and the account's name
 * list. Nothing here is persisted or trusted across a mutation.
 */
export async function requestActiveAccount(timeoutMs = 300000) {
  if (!hasQortalBridge()) {
    return { ok: false, address: '', error: 'bridge-unavailable', message: 'Open this site inside Qortal Hub to connect an owner account.' };
  }
  try {
    const account = await requestQortal({ action: 'GET_USER_ACCOUNT' }, timeoutMs);
    const address = account && account.address ? String(account.address) : '';
    if (!address) {
      return { ok: false, address: '', error: 'no-account', message: 'Qortal Hub did not return an active account. Unlock a wallet account in Hub and try again.' };
    }
    return { ok: true, address, error: '', message: '' };
  } catch (error) {
    return {
      ok: false,
      address: '',
      error: 'account-request-failed',
      message: 'Qortal Hub did not return an active account: ' + (error && error.message ? error.message : String(error))
    };
  }
}

/**
 * Explicit "Connect owner account" action. Requests the active account through
 * the supported bridge (user gesture), then re-runs the complete ownership
 * verification. It never grants owner mode directly.
 */
export async function connectOwnerAccount(qdnName) {
  const name = String(qdnName || discoverHostedQdnName('')).trim();
  if (!hasQortalBridge()) {
    return evaluateOwnership({ qdnName: name, bridgeAvailable: false });
  }
  const account = await requestActiveAccount();
  if (!account.ok) {
    return {
      role: 'reader',
      owner: false,
      reason: 'no-account',
      message: account.message || 'The owner account was not connected. Approve the request in Qortal Hub and try again.',
      address: '',
      name: '',
      names: [],
      qdnName: name,
      bridgeAvailable: true,
      nameRecordStatus: 'none',
      nameRecordSource: '',
      nameRecordError: '',
      action: 'connect'
    };
  }
  return resolveViewerIdentity({ qdnName: name });
}

/**
 * Revalidate ownership immediately before any mutation. Fetches the active
 * account and name record again; a cached identity is never sufficient.
 */
export async function revalidateViewerIdentity(identity) {
  const guard = requireOwner(identity, 'publishing changes');
  if (!guard.ok) return { ok: false, error: guard.error, message: guard.message, identity: null };
  if (!hasQortalBridge()) {
    return { ok: false, error: 'bridge-unavailable', message: 'Qortal Hub is unavailable. Publishing was cancelled.', identity: null };
  }
  const facts = await readIdentityFacts();
  const nameResult = await fetchNameRecord(identity.qdnName);
  const result = evaluateRevalidation(identity, {
    account: facts.account,
    accountNames: facts.names,
    nameRecord: nameResult.record,
    nameRecordSource: nameResult.source,
    nameRecordError: nameResult.error || ''
  });
  if (!result.ok && nameResult.error) {
    return { ...result, message: result.message + ' Registry detail: ' + nameResult.error };
  }
  return result;
}

export function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < view.length; index += chunk) {
    binary += String.fromCharCode.apply(null, view.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(value) {
  const binary = atob(String(value || '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function sha256Hex(bytes) {
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', body);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createQdnHttpUrl(service, name, identifier) {
  return getNodeUrl() + createQdnResourcePath(service, name, identifier);
}

export async function fetchUnitFee(txType = 'ARBITRARY', timeoutMs = 6000) {
  try {
    const response = await fetch(getTrustedNodeUrl() + '/transactions/unitfee?txType=' + encodeURIComponent(txType), {
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const value = Number(await response.text());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export async function publishQdnResource(payload) {
  return requestQortal({
    action: 'PUBLISH_QDN_RESOURCE',
    service: payload.service,
    name: payload.name,
    identifier: payload.identifier,
    data64: payload.data64,
    filename: payload.filename,
    title: payload.title,
    description: payload.description,
    ...(payload.file ? { file: payload.file } : {})
  }, payload.timeoutMs || 180000);
}

export async function fetchQdnBytes(service, name, identifier) {
  const result = await requestQortal({
    action: 'FETCH_QDN_RESOURCE',
    service,
    name,
    identifier,
    encoding: 'base64'
  });
  if (typeof result !== 'string') throw new Error('Qortal returned a parsed value instead of exact bytes.');
  return base64ToBytes(result);
}

/**
 * Verify exact published bytes. Returns { ok, actualSha256 } and never claims
 * success from a submitted transaction alone.
 */
export async function verifyPublishedBytes({ service, name, identifier, expectedBytes, timeoutMs = 45000 }) {
  const expected = await sha256Hex(expectedBytes);
  const started = Date.now();
  let lastError = null;
  let delayMs = 700;
  while (Date.now() - started < timeoutMs) {
    try {
      const actual = await fetchQdnBytes(service, name, identifier);
      const actualSha256 = await sha256Hex(actual);
      if (actualSha256 === expected) return { ok: true, actualSha256, expectedSha256: expected, error: null };
      lastError = 'Published bytes do not match yet.';
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(4000, Math.round(delayMs * 1.6));
  }
  return { ok: false, actualSha256: null, expectedSha256: expected, error: lastError || 'Timed out waiting for QDN read-back.' };
}

export async function getQdnResourceStatus(service, name, identifier) {
  try {
    return await requestQortal({ action: 'GET_QDN_RESOURCE_STATUS', service, name, identifier, build: false });
  } catch {
    return null;
  }
}

export async function searchQdnResources(options = {}) {
  try {
    const result = await requestQortal({
      action: 'SEARCH_QDN_RESOURCES',
      service: options.service,
      name: options.name,
      query: options.query || '',
      limit: Math.min(50, Math.max(1, Number(options.limit) || 20)),
      includeStatus: false,
      includeMetadata: true
    });
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

/**
 * Open a qortal:// link in a new Qortal Hub tab. Hub supports OPEN_NEW_TAB
 * with a qortalLink field. Outside Hub the caller gets a graceful false and
 * may show the destination so it can be pasted manually.
 */
export async function openQortalLink(qortalLink) {
  if (!hasQortalBridge()) return { ok: false, message: 'Open this link inside Qortal Hub.' };
  try {
    await requestQortal({ action: 'OPEN_NEW_TAB', qortalLink }, 15000);
    return { ok: true, message: '' };
  } catch (error) {
    return { ok: false, message: error && error.message ? error.message : 'Qortal Hub could not open the link.' };
  }
}
