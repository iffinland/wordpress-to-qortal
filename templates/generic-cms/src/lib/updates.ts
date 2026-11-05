import {
  REGISTRY_IDENTITY,
  channelOfVersion,
  createUpdateChecker,
  type UpdateChecker,
  type UpdateCheckerState
} from '../../../../lib/update/registry.js';
import { createQdnResourcePath, findQortalRequest, getNodeUrl, getTrustedNodeUrl, hasQortalBridge, requestQortal } from './qortal.js';

const FETCH_TIMEOUT_MS = 8000;

function bridgeRequest(payload: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  return requestQortal(payload, timeoutMs);
}

/**
 * Read the registry through the supported Qortal Hub QDN API first. The HTTP
 * path is only a development/no-bridge fallback and never leaves the node that
 * already serves this Q-App.
 */
export async function fetchRegistryDocument(): Promise<string> {
  const payload = {
    action: 'FETCH_QDN_RESOURCE',
    service: REGISTRY_IDENTITY.service,
    name: REGISTRY_IDENTITY.name,
    identifier: REGISTRY_IDENTITY.identifier
  };
  if (findQortalRequest()) {
    const result = await bridgeRequest(payload, FETCH_TIMEOUT_MS);
    if (typeof result === 'string') return result;
    return JSON.stringify(result);
  }
  const path = createQdnResourcePath(REGISTRY_IDENTITY.service, REGISTRY_IDENTITY.name, REGISTRY_IDENTITY.identifier);
  const url = hasQortalBridge() ? path : getTrustedNodeUrl() + path;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('Registry request failed with HTTP ' + response.status + '.');
    return await response.text();
  } finally {
    window.clearTimeout(timer);
  }
}

export function createCmsUpdateChecker(installedVersion: string): UpdateChecker {
  return createUpdateChecker({
    componentId: 'cms',
    installedVersion,
    platform: 'qortal-hub',
    dependencies: {},
    fetchRegistry: () => fetchRegistryDocument(),
    timeoutMs: 9000,
    retries: 2,
    cacheMs: 15 * 60 * 1000,
    staleMs: 24 * 60 * 60 * 1000
  });
}

export function installedChannel(installedVersion: string): string {
  return channelOfVersion(installedVersion) ?? 'stable';
}

export function stateLabel(state: UpdateCheckerState): string {
  if (state.status === 'checking') return 'Checking for updates…';
  if (state.status === 'up_to_date') return 'Up to date';
  if (state.status === 'update_available') return state.stale ? 'Update reported (cached)' : 'Update available';
  if (state.status === 'incompatible') return 'Update not compatible';
  if (state.status === 'unverified') return 'Release could not be verified';
  if (state.status === 'unable_to_check') return 'Unable to check for updates';
  return 'Updates';
}
