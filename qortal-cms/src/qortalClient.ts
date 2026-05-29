interface QortalRequestPayload {
  action: string;
  service?: string;
  name?: string;
  identifier?: string;
  address?: string;
  data64?: string;
  encoding?: string;
  file?: File;
  filename?: string;
  title?: string;
  description?: string;
  build?: boolean;
  path?: string;
  resources?: Array<{
    service: string;
    name?: string;
    identifier: string;
    data64?: string;
    file?: File;
    filename?: string;
    title?: string;
    description?: string;
  }>;
}

declare global {
  interface Window {
    qortalRequest?: (payload: QortalRequestPayload) => Promise<unknown>;
  }

  var qortalRequest: ((payload: QortalRequestPayload) => Promise<unknown>) | undefined;
}

function findQortalRequest(): ((payload: QortalRequestPayload) => Promise<unknown>) | null {
  if (typeof window === 'undefined') return null;

  if (typeof window.qortalRequest === 'function') return window.qortalRequest;
  if (typeof globalThis.qortalRequest === 'function') return globalThis.qortalRequest;

  try {
    if (window.parent && window.parent !== window && typeof window.parent.qortalRequest === 'function') {
      return window.parent.qortalRequest;
    }
  } catch {
    // Continue with other Qortal UI bridge locations.
  }

  try {
    const topWindow = window.top;
    if (topWindow && topWindow !== window && typeof topWindow.qortalRequest === 'function') {
      return topWindow.qortalRequest;
    }
  } catch {
    // Continue with other Qortal UI bridge locations.
  }

  if (typeof qortalRequest === 'function') return qortalRequest;
  return null;
}

export function hasQortalBridge() {
  return Boolean(findQortalRequest());
}

export async function requestQortal(payload: QortalRequestPayload) {
  const bridge = findQortalRequest();
  if (!bridge) {
    throw new Error('Qortal request API is not available.');
  }
  return bridge(payload);
}

export async function tryRequestQortal<T>(payload: QortalRequestPayload): Promise<T | null> {
  const bridge = findQortalRequest();
  if (!bridge) return null;

  try {
    return await bridge(payload) as T;
  } catch {
    return null;
  }
}

export async function fetchQdnResource<T>(service: string, name: string, identifier: string): Promise<T> {
  const bridge = findQortalRequest();

  if (bridge) {
    const response = await bridge({
      action: 'FETCH_QDN_RESOURCE',
      service,
      name,
      identifier
    });
    return typeof response === 'string' ? (JSON.parse(response) as T) : (response as T);
  }

  const nodeUrl = (import.meta.env.VITE_QORTAL_NODE_URL || 'http://localhost:12391').replace(/\/+$/, '');
  const response = await fetch(`${nodeUrl}/arbitrary/${encodeURIComponent(service)}/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`);
  if (!response.ok) {
    throw new Error(`Unable to fetch QDN resource ${service}/${name}/${identifier}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function toBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

export function createQdnUrl(service: string, name: string, identifier: string) {
  return `/arbitrary/${encodeURIComponent(service)}/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`;
}

export async function getQdnResourceUrl(service: string, name: string, identifier: string, path?: string): Promise<string> {
  const response = await tryRequestQortal<string>({
    action: 'GET_QDN_RESOURCE_URL',
    service,
    name,
    identifier,
    path
  });

  if (response) return response;
  return createQdnUrl(service, name, identifier);
}

export interface QdnResourceStatus {
  status: string;
  localChunkCount?: number;
  totalChunkCount?: number;
  percentLoaded?: number;
}

export async function getQdnResourceStatus(service: string, name: string, identifier: string, build = false): Promise<QdnResourceStatus | null> {
  const response = await tryRequestQortal<QdnResourceStatus | string>({
    action: 'GET_QDN_RESOURCE_STATUS',
    service,
    name,
    identifier,
    build
  });

  if (!response) return null;
  if (typeof response === 'string') return { status: response };
  return response;
}
