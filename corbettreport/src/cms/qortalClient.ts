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
  coin?: string;
  recipient?: string;
  amount?: number;
  mode?: string;
  prefix?: boolean;
  limit?: number;
  offset?: number;
  reverse?: boolean;
  includeMetadata?: boolean;
  excludeBlocked?: boolean;
  resources?: Array<{
    service: string;
    name?: string;
    identifier: string;
    data64?: string;
    encoding?: string;
    file?: File;
    filename?: string;
    title?: string;
    description?: string;
  }>;
}

type QortalBridge = (payload: QortalRequestPayload) => Promise<unknown>;

const OPTIONAL_REQUEST_TIMEOUT_MS = 5_000;
const QDN_READ_TIMEOUT_MS = 12_000;

function getInjectedGlobalBridge(): QortalBridge | null {
  try {
    const candidate = Function('return typeof qortalRequest === "function" ? qortalRequest : null')() as unknown;
    return typeof candidate === 'function' ? candidate as QortalBridge : null;
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

function findQortalRequest(): QortalBridge | null {
  if (typeof window === 'undefined') return null;

  const currentWindow = window as Window & { qortalRequest?: QortalBridge };
  const globalScope = globalThis as typeof globalThis & { qortalRequest?: QortalBridge };

  if (typeof currentWindow.qortalRequest === 'function') return currentWindow.qortalRequest;
  if (typeof globalScope.qortalRequest === 'function') return globalScope.qortalRequest;

  try {
    const parentWindow = window.parent as Window & { qortalRequest?: QortalBridge };
    if (parentWindow && parentWindow !== window && typeof parentWindow.qortalRequest === 'function') {
      return parentWindow.qortalRequest;
    }
  } catch {
    // Continue with other Qortal UI bridge locations.
  }

  try {
    const topWindow = window.top as (Window & { qortalRequest?: QortalBridge }) | null;
    if (topWindow && topWindow !== window && typeof topWindow.qortalRequest === 'function') {
      return topWindow.qortalRequest;
    }
  } catch {
    // Continue with other Qortal UI bridge locations.
  }

  try {
    const openerWindow = window.opener as (Window & { qortalRequest?: QortalBridge }) | null;
    if (openerWindow && typeof openerWindow.qortalRequest === 'function') {
      return openerWindow.qortalRequest;
    }
  } catch {
    // Continue with injected globals.
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
    if (record.error) {
      throw new Error(String(record.message || record.error));
    }
  }

  return parsed;
}

export function getQortalBridgeDiagnostics() {
  const diagnostics = {
    window: false,
    globalThis: false,
    parent: false,
    top: false,
    opener: false,
    injectedGlobal: false
  };

  if (typeof window === 'undefined') return diagnostics;

  const currentWindow = window as Window & { qortalRequest?: QortalBridge };
  const globalScope = globalThis as typeof globalThis & { qortalRequest?: QortalBridge };

  diagnostics.window = typeof currentWindow.qortalRequest === 'function';
  diagnostics.globalThis = typeof globalScope.qortalRequest === 'function';

  try {
    const parentWindow = window.parent as Window & { qortalRequest?: QortalBridge };
    diagnostics.parent = Boolean(parentWindow && parentWindow !== window) && typeof parentWindow.qortalRequest === 'function';
  } catch {
    diagnostics.parent = false;
  }

  try {
    const topWindow = window.top as (Window & { qortalRequest?: QortalBridge }) | null;
    diagnostics.top = Boolean(topWindow && topWindow !== window && typeof topWindow.qortalRequest === 'function');
  } catch {
    diagnostics.top = false;
  }

  try {
    const openerWindow = window.opener as (Window & { qortalRequest?: QortalBridge }) | null;
    diagnostics.opener = Boolean(openerWindow && typeof openerWindow.qortalRequest === 'function');
  } catch {
    diagnostics.opener = false;
  }

  diagnostics.injectedGlobal = Boolean(getInjectedGlobalBridge());
  return diagnostics;
}

export function hasQortalBridge() {
  return Boolean(findQortalRequest());
}

export async function requestQortal(payload: QortalRequestPayload) {
  const bridge = findQortalRequest();
  if (!bridge) {
    throw new Error('Qortal request API is not available.');
  }
  return validateQortalResponse(await bridge(payload));
}

export async function tryRequestQortal<T>(payload: QortalRequestPayload, timeoutMs = OPTIONAL_REQUEST_TIMEOUT_MS): Promise<T | null> {
  const bridge = findQortalRequest();
  if (!bridge) return null;

  try {
    return validateQortalResponse(await withTimeout(
      bridge(payload) as Promise<T>,
      timeoutMs,
      `Qortal request timed out: ${payload.action}`
    )) as T;
  } catch {
    return null;
  }
}

export async function fetchQdnResource<T>(service: string, name: string, identifier: string, timeoutMs = QDN_READ_TIMEOUT_MS): Promise<T> {
  const bridge = findQortalRequest();
  const resourceLabel = `${service}/${name}/${identifier}`;

  if (bridge) {
    const response = validateQortalResponse(await withTimeout(
      bridge({
        action: 'FETCH_QDN_RESOURCE',
        service,
        name,
        identifier
      }),
      timeoutMs,
      `Timed out loading QDN resource ${resourceLabel}`
    ));
    return typeof response === 'string' ? (JSON.parse(response) as T) : (response as T);
  }

  const nodeUrl = (import.meta.env.VITE_QORTAL_NODE_URL || 'http://localhost:12391').replace(/\/+$/, '');
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${nodeUrl}/arbitrary/${encodeURIComponent(service)}/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`,
      { signal: controller.signal }
    );
    if (!response.ok) {
      throw new Error(`Unable to fetch QDN resource ${resourceLabel}: ${response.status}`);
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
