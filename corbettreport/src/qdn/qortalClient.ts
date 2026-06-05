interface QortalRequestPayload {
  action: string;
  list_name?: string;
  items?: string[];
  service?: string;
  name?: string;
  identifier?: string;
}

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

export async function fetchQdnResource<T>(service: string, name: string, identifier: string): Promise<T> {
  const bridge = findQortalRequest();
  if (bridge) {
    const result = validateQortalResponse(await bridge({ action: 'FETCH_QDN_RESOURCE', service, name, identifier }));
    return (typeof result === 'string' ? JSON.parse(result) : result) as T;
  }

  const response = await fetch(createQdnResourceUrl(service, name, identifier));
  if (!response.ok) {
    throw new Error(`Failed to fetch QDN resource ${service}/${name}/${identifier}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}
