export interface QortalRequestPayload {
  action: string;
  service?: string;
  name?: string;
  identifier?: string;
  filepath?: string;
  build?: boolean;
  encoding?: string;
  data64?: string;
  file?: File;
  filename?: string;
  title?: string;
  description?: string;
  resources?: Array<Record<string, unknown>>;
  blob?: Blob;
  mimeType?: string;
  address?: string;
}

type QortalRequest = (payload: QortalRequestPayload) => Promise<unknown>;

// Core's q-apps.js declares qortalRequest as a top-level const. In a classic
// script that is a global lexical binding, not a window property. The legacy
// viewer's qortalClient.ts already declares the global for TypeScript.

export interface BridgeDiagnostics {
  injectedGlobal: boolean;
  windowProperty: boolean;
  secureContext: boolean;
  locationOrigin: string;
}

/**
 * Qortal Hub/Core injects qortalRequest into the Q-App document. It is a global
 * lexical binding, not a property of window.parent or window.top. We therefore
 * look only at the current document's global binding and window property, and
 * never assume the bridge is reachable through a parent/top frame.
 */
export function getQortalRequest(): QortalRequest | null {
  try {
    if (typeof qortalRequest === 'function') return qortalRequest as QortalRequest;
  } catch {
    // A bare global binding may be unavailable in non-Qortal builds.
  }
  const windowBridge = typeof window !== 'undefined'
    ? (window as unknown as { qortalRequest?: QortalRequest }).qortalRequest
    : undefined;
  if (typeof windowBridge === 'function') return windowBridge;
  const globalBridge = (globalThis as unknown as { qortalRequest?: QortalRequest }).qortalRequest;
  if (typeof globalBridge === 'function') return globalBridge;
  return null;
}

export function bridgeDiagnostics(): BridgeDiagnostics {
  return {
    injectedGlobal: Boolean(getQortalRequest()),
    windowProperty: typeof window !== 'undefined' && typeof (window as unknown as { qortalRequest?: unknown }).qortalRequest === 'function',
    secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
    locationOrigin: typeof window !== 'undefined' ? window.location.origin : ''
  };
}

export async function requestQortal(payload: QortalRequestPayload): Promise<unknown> {
  const bridge = getQortalRequest();
  if (!bridge) {
    throw new Error('Qortal request API is not available. Open this Q-App in Qortal Hub, not in a plain browser.');
  }
  const response = await bridge(payload);
  let parsed: unknown = response;
  if (typeof response === 'string') {
    try {
      parsed = JSON.parse(response);
    } catch {
      parsed = response;
    }
  }
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (record.error) {
      const error = record.error;
      if (typeof error === 'string') throw new Error(error);
      const message = (error as Record<string, unknown>).message
        ?? (error as Record<string, unknown>).error
        ?? JSON.stringify(error);
      throw new Error(String(message));
    }
  }
  return parsed;
}

export async function getActiveAccount(): Promise<{ address: string; publicKey?: string } > {
  const account = await requestQortal({ action: 'GET_USER_ACCOUNT' });
  if (!account || typeof account !== 'object') throw new Error('Qortal Hub did not return an account.');
  const record = account as Record<string, unknown>;
  if (typeof record.address !== 'string' || !/^Q[1-9A-HJ-NP-Za-km-z]{20,50}$/.test(record.address)) {
    throw new Error('Qortal Hub returned an invalid account address.');
  }
  return { address: record.address, publicKey: typeof record.publicKey === 'string' ? record.publicKey : undefined };
}

export async function getOwnedNames(address: string): Promise<Array<{ name: string; owner: string }>> {
  const result = await requestQortal({ action: 'GET_ACCOUNT_NAMES', address });
  if (!Array.isArray(result)) throw new Error('Qortal Hub returned an invalid name list.');
  return result
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({ name: String(entry.name ?? ''), owner: String(entry.owner ?? '') }))
    .filter((entry) => entry.name.length > 0);
}

export async function getResourceStatus(service: string, name: string, identifier: string): Promise<unknown> {
  return requestQortal({ action: 'GET_QDN_RESOURCE_STATUS', service, name, identifier, build: false });
}

export async function getResourceProperties(service: string, name: string, identifier: string): Promise<{ size?: number; mimeType?: string } | null> {
  try {
    const result = await requestQortal({ action: 'GET_QDN_RESOURCE_PROPERTIES', service, name, identifier });
    return result && typeof result === 'object' ? result as { size?: number; mimeType?: string } : null;
  } catch {
    return null;
  }
}

/**
 * Exact byte read. Core returns base64 text for encoding=base64, including for
 * binary resources. If the host parses it as JSON instead, this function fails
 * rather than claiming a hash comparison from a lossy object.
 */
export async function fetchQdnBase64(service: string, name: string, identifier: string): Promise<Uint8Array> {
  const result = await requestQortal({
    action: 'FETCH_QDN_RESOURCE',
    service,
    name,
    identifier,
    encoding: 'base64'
  });
  if (typeof result !== 'string') {
    throw new Error('Qortal returned a parsed object instead of base64 bytes; exact hash comparison is not possible.');
  }
  const compact = result.replace(/\s+/g, '');
  if (compact !== '' && (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0)) {
    throw new Error('Qortal returned a non-base64 body; exact hash comparison is not possible.');
  }
  const binary = atob(compact);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
