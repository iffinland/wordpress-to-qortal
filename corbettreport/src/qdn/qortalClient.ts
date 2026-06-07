interface QortalRequestPayload {
  action: string;
  list_name?: string;
  items?: string[];
  service?: string;
  name?: string;
  identifier?: string;
  address?: string;
  destinationAddress?: string;
  message?: string;
  data64?: string;
  encoding?: string;
  title?: string;
  description?: string;
  mode?: string;
  prefix?: boolean;
  limit?: number;
  offset?: number;
  reverse?: boolean;
  includeMetadata?: boolean;
  excludeBlocked?: boolean;
}

const QDN_READ_TIMEOUT_MS = 15000;
const QDN_READ_RETRIES = 1;
const QDN_RETRY_DELAY_MS = 350;
const inFlightQdnReads = new Map<string, Promise<unknown>>();

declare global {
  interface Window {
    qortalRequest?: (payload: QortalRequestPayload) => Promise<unknown>;
  }

  // Qortal UI can expose the bridge as an injected global.
  // eslint-disable-next-line no-var
  var qortalRequest: ((payload: QortalRequestPayload) => Promise<unknown>) | undefined;
}

function getInjectedGlobalBridge() {
  try {
    const candidate = Function('return typeof qortalRequest === "function" ? qortalRequest : null')() as unknown;
    return typeof candidate === 'function' ? candidate as (payload: QortalRequestPayload) => Promise<unknown> : null;
  } catch {
    return null;
  }
}

function findQortalRequest() {
  if (typeof window.qortalRequest === 'function') return window.qortalRequest;
  if (typeof globalThis.qortalRequest === 'function') return globalThis.qortalRequest;
  try {
    if (window.parent !== window && typeof window.parent.qortalRequest === 'function') return window.parent.qortalRequest;
  } catch {
    // Parent frame access depends on the Qortal UI context.
  }
  try {
    if (window.top && window.top !== window && typeof window.top.qortalRequest === 'function') return window.top.qortalRequest;
  } catch {
    // Top frame access depends on the Qortal UI context.
  }
  try {
    if (window.opener && typeof window.opener.qortalRequest === 'function') return window.opener.qortalRequest;
  } catch {
    // Opener access depends on the Qortal UI context.
  }
  return getInjectedGlobalBridge();
}

function validateQortalResponse(response: unknown): unknown {
  let parsed = response;
  if (typeof response === 'string') {
    try {
      parsed = JSON.parse(response);
    } catch {
      return response;
    }
  }

  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (record.error) throw new Error(String(record.message || record.error));
  }

  return parsed;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function hasQortalBridge() {
  return Boolean(findQortalRequest());
}

export async function requestQortal<T>(payload: QortalRequestPayload): Promise<T> {
  const bridge = findQortalRequest();
  if (!bridge) {
    throw new Error('Qortal request API is only available when the app is opened inside Qortal UI.');
  }
  return validateQortalResponse(await bridge(payload)) as T;
}

export function toBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

function createQdnResourcePath(service: string, name: string, identifier: string) {
  return `/arbitrary/${encodeURIComponent(service)}/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`;
}

function getQortalNodeUrl() {
  const params = new URLSearchParams(window.location.search);
  return (params.get('node') || import.meta.env.VITE_QORTAL_NODE_URL || 'http://localhost:12391').replace(/\/+$/, '');
}

export function resolveQdnUrl(url: string) {
  return !hasQortalBridge() && url.startsWith('/arbitrary/') ? `${getQortalNodeUrl()}${url}` : url;
}

export function createQdnResourceUrl(service: string, name: string, identifier: string) {
  return resolveQdnUrl(createQdnResourcePath(service, name, identifier));
}

function shouldRetryFetch(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();
  return !message.includes(': 404')
    && !normalized.includes("couldn't find put transaction")
    && !normalized.includes('timed out loading qdn resource');
}

async function fetchQdnResourceOnce<T>(service: string, name: string, identifier: string, timeoutMs: number): Promise<T> {
  const resourceLabel = `${service}/${name}/${identifier}`;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(createQdnResourceUrl(service, name, identifier), { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch QDN resource ${resourceLabel}: ${response.status}`);
    }
    return response.json() as Promise<T>;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Timed out loading QDN resource ${resourceLabel}`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function fetchQdnResource<T>(service: string, name: string, identifier: string, timeoutMs = QDN_READ_TIMEOUT_MS): Promise<T> {
  const key = `${service}::${name}::${identifier}`;
  const existing = inFlightQdnReads.get(key);
  if (existing) return existing as Promise<T>;

  const operation = (async () => {
    let attempt = 0;
    let lastError: unknown = null;
    while (attempt <= QDN_READ_RETRIES) {
      try {
        return await fetchQdnResourceOnce<T>(service, name, identifier, timeoutMs);
      } catch (error) {
        lastError = error;
        if (attempt >= QDN_READ_RETRIES || !shouldRetryFetch(error)) break;
        await wait(QDN_RETRY_DELAY_MS * (attempt + 1));
      }
      attempt += 1;
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'QDN resource fetch failed'));
  })();

  inFlightQdnReads.set(key, operation);
  try {
    return await operation;
  } finally {
    inFlightQdnReads.delete(key);
  }
}
