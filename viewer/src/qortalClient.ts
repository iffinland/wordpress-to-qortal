interface QortalRequestPayload {
  action: string;
  service?: string;
  name?: string;
  identifier?: string;
  build?: boolean;
  data64?: string;
  encoding?: string;
  file?: File;
  filename?: string;
  title?: string;
  description?: string;
}

declare global {
  interface Window {
    qortalRequest?: (payload: QortalRequestPayload) => Promise<unknown>;
  }

  // Some Qortal UI contexts expose qortalRequest as an injected global rather
  // than as a normal window property.
  // eslint-disable-next-line no-var
  var qortalRequest: ((payload: QortalRequestPayload) => Promise<unknown>) | undefined;
}

function findQortalRequest(): ((payload: QortalRequestPayload) => Promise<unknown>) | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (typeof window.qortalRequest === 'function') {
    return window.qortalRequest;
  }

  if (typeof globalThis !== 'undefined' && typeof globalThis.qortalRequest === 'function') {
    return globalThis.qortalRequest;
  }

  try {
    const parentWindow = window.parent;
    if (parentWindow && parentWindow !== window && typeof parentWindow.qortalRequest === 'function') {
      return parentWindow.qortalRequest;
    }
  } catch {
    // Parent window access can fail depending on Qortal UI framing.
  }

  try {
    const topWindow = window.top;
    if (topWindow && topWindow !== window && typeof topWindow.qortalRequest === 'function') {
      return topWindow.qortalRequest;
    }
  } catch {
    // Top window access can fail depending on Qortal UI framing.
  }

  try {
    const openerWindow = window.opener;
    if (openerWindow && typeof openerWindow.qortalRequest === 'function') {
      return openerWindow.qortalRequest;
    }
  } catch {
    // Opener access can fail depending on browser security boundaries.
  }

  if (typeof qortalRequest !== 'undefined' && typeof qortalRequest === 'function') {
    return qortalRequest;
  }

  return null;
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

  if (typeof window === 'undefined') {
    return diagnostics;
  }

  diagnostics.window = typeof window.qortalRequest === 'function';
  diagnostics.globalThis =
    typeof globalThis !== 'undefined' && typeof globalThis.qortalRequest === 'function';

  try {
    diagnostics.parent =
      Boolean(window.parent && window.parent !== window) &&
      typeof window.parent.qortalRequest === 'function';
  } catch {
    diagnostics.parent = false;
  }

  try {
    const topWindow = window.top;
    diagnostics.top =
      Boolean(topWindow && topWindow !== window) &&
      typeof topWindow?.qortalRequest === 'function';
  } catch {
    diagnostics.top = false;
  }

  try {
    diagnostics.opener =
      Boolean(window.opener) && typeof window.opener.qortalRequest === 'function';
  } catch {
    diagnostics.opener = false;
  }

  diagnostics.injectedGlobal =
    typeof qortalRequest !== 'undefined' && typeof qortalRequest === 'function';

  return diagnostics;
}

function getRouteParams(): URLSearchParams {
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash || '';
  const hashQueryIndex = hash.indexOf('?');

  if (hashQueryIndex >= 0) {
    const hashParams = new URLSearchParams(hash.slice(hashQueryIndex + 1));
    for (const [key, value] of hashParams.entries()) {
      if (!params.has(key)) {
        params.set(key, value);
      }
    }
  }

  return params;
}

export function hasQortalBridge(): boolean {
  return Boolean(findQortalRequest());
}

export async function requestQortal(payload: QortalRequestPayload): Promise<unknown> {
  const bridge = findQortalRequest();
  if (!bridge) {
    throw new Error('Qortal request API is not available.');
  }
  return bridge(payload);
}

export async function fetchQdnResource<T>({
  service,
  name,
  identifier
}: {
  service: string;
  name: string;
  identifier: string;
}): Promise<T> {
  const bridge = findQortalRequest();

  if (bridge) {
    const result = await bridge({
      action: 'FETCH_QDN_RESOURCE',
      service,
      name,
      identifier
    });

    if (typeof result === 'string') {
      return JSON.parse(result) as T;
    }

    return result as T;
  }

  const params = getRouteParams();
  const nodeUrl = (params.get('node') || import.meta.env.VITE_QORTAL_NODE_URL || 'http://localhost:12391').replace(/\/+$/, '');
  const response = await fetch(
    `${nodeUrl}/arbitrary/${encodeURIComponent(service)}/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch QDN resource ${service}/${name}/${identifier}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}
