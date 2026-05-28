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
}

function findQortalRequest(): ((payload: QortalRequestPayload) => Promise<unknown>) | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (typeof window.qortalRequest === 'function') {
    return window.qortalRequest;
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

  return null;
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

  const response = await fetch(
    `/arbitrary/${encodeURIComponent(service)}/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch QDN resource ${service}/${name}/${identifier}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}
