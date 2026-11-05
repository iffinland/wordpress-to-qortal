import type { RegistryArtifact, RegistryComponent, RegistryDocument } from '../../../lib/update/registry.js';

export const TAG: string;
export function artifactFor(component: string, version?: string): RegistryArtifact;
export function componentFor(component: string, version?: string, overrides?: Partial<RegistryComponent>): RegistryComponent;
export function registryFixture(options?: {
  sequence?: number;
  versions?: Record<string, string>;
  components?: string[];
  generatedAt?: string;
}): RegistryDocument;
