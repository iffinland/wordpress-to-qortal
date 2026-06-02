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
  return null;
}

export function hasQortalBridge() {
  return Boolean(findQortalRequest());
}

export async function requestQortal<T>(payload: QortalRequestPayload): Promise<T> {
  const bridge = findQortalRequest();
  if (!bridge) {
    throw new Error('Qortal request API is only available when the app is opened inside Qortal UI.');
  }
  return bridge(payload) as Promise<T>;
}

function createQdnResourcePath(service: string, name: string, identifier: string) {
  return `/arbitrary/${encodeURIComponent(service)}/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`;
}

function getQortalNodeUrl() {
  const params = new URLSearchParams(window.location.search);
  return (params.get('node') || import.meta.env.VITE_QORTAL_NODE_URL || 'http://localhost:12391').replace(/\/+$/, '');
}

export function createQdnResourceUrl(service: string, name: string, identifier: string) {
  const path = createQdnResourcePath(service, name, identifier);
  return hasQortalBridge() ? path : `${getQortalNodeUrl()}${path}`;
}

export async function fetchQdnResource<T>(service: string, name: string, identifier: string): Promise<T> {
  const bridge = findQortalRequest();
  if (bridge) {
    const result = await bridge({ action: 'FETCH_QDN_RESOURCE', service, name, identifier });
    return (typeof result === 'string' ? JSON.parse(result) : result) as T;
  }

  const response = await fetch(createQdnResourceUrl(service, name, identifier));
  if (!response.ok) {
    throw new Error(`Failed to fetch QDN resource ${service}/${name}/${identifier}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}
