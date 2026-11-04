import { evaluateOwnership } from './ownership.js';

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

export function getNodeUrl() {
  if (typeof window === 'undefined') return DEFAULT_NODE;
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('node');
  const fromEnv = import.meta.env && import.meta.env.VITE_QORTAL_NODE_URL;
  return String(fromQuery || fromEnv || DEFAULT_NODE).replace(/\/+$/, '');
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

export async function fetchNameRecord(name, timeoutMs = 6000) {
  if (!name) return { record: null, error: 'No name was provided.' };
  try {
    const response = await fetch(getNodeUrl() + '/names/' + encodeURIComponent(name), {
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const record = await response.json();
    if (!record || typeof record.name !== 'string' || typeof record.owner !== 'string') {
      throw new Error('The name record did not include name and owner.');
    }
    return { record, error: null };
  } catch (error) {
    return { record: null, error: error && error.message ? error.message : String(error) };
  }
}

export function discoverQdnName(fallback = '') {
  if (typeof window === 'undefined') return fallback;
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('name') || params.get('qdnName') || params.get('appName');
    if (fromQuery) return fromQuery;
  } catch {
    // Ignore malformed query strings.
  }
  const qortalWindow = window;
  if (qortalWindow._qdnName) return qortalWindow._qdnName;
  if (qortalWindow._qdnResource && qortalWindow._qdnResource.name) return qortalWindow._qdnResource.name;
  if (qortalWindow._qdnBase) {
    const match = String(qortalWindow._qdnBase).match(/\/(?:APP|WEBSITE)\/([^/?#]+)/i);
    if (match) return decodeURIComponent(match[1]);
  }
  try {
    const parts = window.location.pathname.split('/').filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index].toUpperCase();
      if ((part === 'APP' || part === 'WEBSITE') && parts[index + 1]) return decodeURIComponent(parts[index + 1]);
    }
  } catch {
    // Ignore path access errors.
  }
  return fallback;
}

function accountNameList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === 'string') return entry;
    return (entry && (entry.name || entry.primaryName)) || '';
  }).filter(Boolean);
}

export async function resolveViewerIdentity(options = {}) {
  const qdnName = String(options.qdnName || discoverQdnName('')).trim();
  const bridgeAvailable = hasQortalBridge();
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
  names = Array.from(new Set(names.filter(Boolean)));

  const nameResult = qdnName ? await fetchNameRecord(qdnName) : { record: null, error: null };
  const identity = evaluateOwnership({
    qdnName,
    account: address ? { address } : null,
    accountNames: names,
    nameRecord: nameResult.record,
    bridgeAvailable,
    displayName: primaryName || names[0] || '',
    requireNameRecord: Boolean(options.requireNameRecord)
  });
  if (!bridgeAvailable) {
    return {
      ...identity,
      message: 'Open this site as a Qortal Q-App to sign in. Read-only mode is active.'
    };
  }
  if (!address) {
    return {
      ...identity,
      message: 'Qortal did not return a signed-in account. Read-only mode is active.'
    };
  }
  if (nameResult.error && identity.owner) {
    return {
      ...identity,
      message: identity.message + ' The on-chain name record could not be cross-checked (' + nameResult.error + ').'
    };
  }
  return identity;
}
