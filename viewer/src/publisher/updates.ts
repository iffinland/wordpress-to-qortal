import { REGISTRY_IDENTITY, createUpdateChecker, type UpdateChecker } from '../../../lib/update/registry.js';
import { fetchQdnResource } from '../qortalClient';

export const REGISTRY_REF = {
  service: REGISTRY_IDENTITY.service,
  name: REGISTRY_IDENTITY.name,
  identifier: REGISTRY_IDENTITY.identifier
} as const;

export function createPublisherUpdateChecker(installedVersion: string): UpdateChecker {
  return createUpdateChecker({
    componentId: 'publisher',
    installedVersion,
    platform: 'qortal-hub',
    dependencies: {},
    fetchRegistry: async () => fetchQdnResource<unknown>(REGISTRY_REF),
    timeoutMs: 9000,
    retries: 2,
    cacheMs: 15 * 60 * 1000,
    staleMs: 24 * 60 * 60 * 1000
  });
}
