export type UpdateChannel = 'alpha' | 'beta' | 'rc' | 'stable';
export type ComponentId = 'desktop' | 'publisher' | 'cms';
export type UpdateStatus = 'idle' | 'checking' | 'up_to_date' | 'update_available' | 'incompatible' | 'unverified' | 'unable_to_check';

export interface RegistryIdentity {
  service: 'DOCUMENT';
  name: 'developer iffi';
  identifier: 'qms-update-registry';
}

export interface RegistryArtifact {
  platform: string;
  format: 'deb' | 'zip';
  name: string;
  bytes: number;
  sha256: string;
  url: string;
}

export interface RegistryComponent {
  id: ComponentId;
  displayName: string;
  version: string;
  channel: UpdateChannel;
  releaseTag: string;
  releaseDate: string;
  releaseUrl: string;
  changelog: { summary: string; url?: string };
  supportedPlatforms: string[];
  minimumDependencies: Record<string, string>;
  install: { kind: 'debian-package' | 'qapp-zip'; instructions: string };
  artifacts: RegistryArtifact[];
}

export interface RegistryDocument {
  schema: 'qms-update-registry@1';
  registry: RegistryIdentity;
  product: string;
  generatedAt: string;
  sequence: number;
  components: Partial<Record<ComponentId, RegistryComponent>> & Record<string, RegistryComponent>;
}

export interface ParsedRegistry {
  ok: boolean;
  code?: string;
  registry?: RegistryDocument;
  document?: RegistryDocument;
  errors: string[];
  warnings: string[];
  migrations: string[];
  sequence?: number;
  generatedAt?: string;
}

export interface UpdateAssessment {
  status: UpdateStatus;
  reasonCode?: string;
  reason: string;
  component?: RegistryComponent;
  artifact?: RegistryArtifact;
  artifacts?: RegistryArtifact[];
  installedVersion?: string;
  latestVersion?: string;
  installedChannel?: UpdateChannel;
  latestChannel?: UpdateChannel;
  installedNewer?: boolean;
  failures?: string[];
  errors?: string[];
  showBadge: boolean;
  registrySequence?: number;
}

export interface UpdateCheckerState extends UpdateAssessment {
  componentId: ComponentId;
  installedVersion: string;
  checkedAt: number | null;
  stale: boolean;
  networkError?: string;
}

export interface UpdateCheckerOptions {
  componentId: ComponentId;
  installedVersion: string;
  platform?: string | null;
  dependencies?: Record<string, string | undefined>;
  fetchRegistry: (options: { signal: AbortSignal | null }) => Promise<unknown>;
  cacheMs?: number;
  staleMs?: number;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface UpdateChecker {
  getState(): UpdateCheckerState;
  subscribe(listener: (state: UpdateCheckerState) => void): () => void;
  check(force?: boolean): Promise<UpdateCheckerState>;
  seed(document: unknown, checkedAt?: number): boolean;
  getDocument(): RegistryDocument | null;
  assessCached(document: unknown, checkedAt?: number, stale?: boolean): boolean;
}

export const REGISTRY_SCHEMA: 'qms-update-registry@1';
export const REGISTRY_MIGRATIONS: Readonly<Record<string, string>>;
export const REGISTRY_IDENTITY: RegistryIdentity;
export const COMPONENT_IDS: readonly ComponentId[];
export const CHANNELS: readonly UpdateChannel[];
export const UPDATE_STATES: readonly UpdateStatus[];

export function parseSemver(value: unknown): { major: number; minor: number; patch: number; prerelease: string[]; build: string[]; raw: string } | null;
export function isValidSemver(value: unknown): boolean;
export function compareSemver(left: string, right: string): -1 | 0 | 1;
export function channelOfVersion(version: string): UpdateChannel | null;
export function channelRank(channel: string): number;
export function isChannelAllowed(installedChannel: string, candidateChannel: string): boolean;
export function migrateRegistryDocument(raw: unknown): { ok: boolean; document?: unknown; migrations: string[]; code?: string; error?: string };
export function parseRegistryDocument(input: unknown): ParsedRegistry;
export function pickArtifact(component: RegistryComponent | null | undefined, platform?: string | null): RegistryArtifact | null;
export function assessUpdate(options: {
  registry: unknown;
  componentId: ComponentId;
  installedVersion: string;
  platform?: string | null;
  dependencies?: Record<string, string | undefined>;
}): UpdateAssessment;
export function createUpdateChecker(options: UpdateCheckerOptions): UpdateChecker;
export function formatBytes(bytes: number): string;
