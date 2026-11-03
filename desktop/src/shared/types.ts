export interface AdapterInfo {
  id: string;
  displayName: string;
  version: string;
  contract: string;
  contractVersion: number;
  capabilities: {
    contentTypes: string[];
    terms: string[];
    assets: Record<string, boolean>;
    states: string[];
    incremental: Record<string, unknown>;
    authentication: string[];
    limits: Record<string, unknown>;
    unsupported: Record<string, string>;
  };
}

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  profileId: string | null;
  resourcePrefix: string | null;
  siteId: string | null;
  siteNamespace: string | null;
  sourceAdapter: string | null;
  sourceBaseUrl: string | null;
  targetQdnName: string | null;
  siteName: string | null;
  storageRoot: string;
}

export interface ProjectDocument extends ProjectSummary {
  schema: string;
  version: number;
  source: Record<string, unknown>;
  target: Record<string, unknown>;
  settings: Record<string, unknown>;
  template: Record<string, unknown>;
  identity?: { siteId: string; namespace: string; createdAt: string };
}

export interface RunSummary {
  id: string;
  kind: string;
  state: string;
  phase: string;
  startedAt: string;
  endedAt: string | null;
  progress: { completed: number; total: number; bytes: number } | null;
  error?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
}

export interface PlanSummary {
  planId: string;
  status: string;
  batchId: string;
  selectedCount: number;
  pendingPublicationCount?: number;
  conflictCount: number;
  createdAt: string;
  download?: Record<string, unknown> | null;
}

export interface IdentitySummary {
  siteId: string;
  namespace: string;
  target: Record<string, unknown>;
  mappingCount: number;
  pendingPublicationCount: number;
  preparedCount: number;
  publishedCount: number;
  unresolvedConflicts: number;
}

export interface ProjectInspection {
  project: ProjectSummary;
  identity: IdentitySummary | null;
  runs: RunSummary[];
  plans: PlanSummary[];
  lastActivity: string;
  activeRuns: number;
  interruptedRuns: number;
}

export interface EngineInfo {
  apiVersion: string;
  version: string;
  dataRoot: string;
  repoRoot: string;
  sourceContract: string;
  contentSchema: string;
  planSchema: string;
  identitySchema: string;
  eventSchema: string;
  adapters: AdapterInfo[];
}

export interface DesktopSettings {
  dataRoot: string;
  configFile: string;
  keyring: { available: boolean; backend: string; persistentCredentials: boolean };
  appVersion: string;
  platform: string;
  arch: string;
  packaged: boolean;
}

export interface QmsEvent {
  schema: string;
  seq: number;
  id: string;
  timestamp: string;
  project_id: string;
  run_id: string | null;
  item_id: string | null;
  phase: string | null;
  type: string;
  level: string;
  code: string;
  message: string;
  progress: { completed: number; total: number; bytes: number } | null;
  retryable: boolean;
  details: Record<string, unknown>;
}

export interface SourceAuth {
  mode: 'none' | 'application_password' | 'session';
  username?: string;
  appPassword?: string;
  password?: string;
  loginUrl?: string;
}

export interface SourceValidationResult {
  runId: string;
  status: string;
  report?: {
    ok: boolean;
    adapter: string;
    adapterVersion: string;
    site?: { name?: string | null; description?: string | null; url?: string | null; namespaces?: string[] };
    auth?: { mode: string; authenticated: boolean };
    capabilities?: AdapterInfo['capabilities'];
    counts?: Record<string, number>;
    contentTypes?: string[];
    unsupported?: Record<string, unknown>;
    warnings?: Array<{ code: string; message: string }>;
  };
  error?: { code: string; message: string; details?: Record<string, unknown> };
  events?: QmsEvent[];
}

export interface WizardState {
  step: number;
  completedSteps: number[];
  adapterId: string;
  sourceUrl: string;
  authMode: string;
  connection: Record<string, unknown> | null;
  targetQdnName: string;
  siteTitle: string;
  siteDescription: string;
  preferences: Record<string, unknown>;
  planId: string | null;
  updatedAt: string;
}

export interface IdentityMapping {
  sourceKey: string;
  contentType: string;
  service: string;
  name: string;
  identifier: string;
  contentHash: string;
  routeHash: string;
  status: string;
  publicationStatus?: string;
  localPreparation?: string;
  preparedAt?: string | null;
  publishedAt?: string | null;
  remoteVerifiedAt?: string | null;
  pendingPublication?: boolean;
  planId?: string | null;
}

export interface PlanEntry {
  id: string;
  sourceKey: string;
  contentType: string;
  title: string | null;
  slug: string | null;
  status: string;
  publicationStatus?: string;
  localPreparation?: string;
  pendingPublication?: boolean;
  contentHash: string;
  routeHash: string;
  mediaCount: number;
  qdn: { service: string; name: string; identifier: string };
  unsupported?: string[];
  warnings?: string[];
}

export interface PlanDocument {
  schema: string;
  planId: string;
  projectId: string;
  siteId: string;
  namespace: string;
  target: { qdnName: string; resourcePrefix: string };
  status: string;
  batchId: string;
  runId: string;
  filters: Record<string, unknown>;
  config: Record<string, unknown>;
  selection: Record<string, unknown>;
  stats: Record<string, number>;
  entries: PlanEntry[];
  media: Array<Record<string, unknown>>;
  mediaSummary: Record<string, number>;
  pendingPublication: {
    count: number;
    prepared: number;
    reserved: number;
    entries: Array<Record<string, unknown>>;
    note: string;
  };
  estimates: {
    contentResources: number;
    mediaResources: number;
    totalResources: number;
    feePerResource: number;
    estimatedFee: number;
    feeCurrency: string;
    note: string;
  };
  disk: Record<string, unknown>;
  conflicts: Array<Record<string, unknown>>;
  warnings: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
  errors: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
  download?: Record<string, unknown> | null;
  createdAt: string;
}

export interface PlanRecord extends PlanSummary {}

export interface PlanCreateResult {
  runId: string;
  status: string;
  planId?: string;
  plan?: PlanDocument;
  record?: PlanRecord | null;
  stats?: Record<string, number>;
  media?: Record<string, number>;
  disk?: Record<string, unknown>;
  warnings?: Array<{ code: string; message: string }>;
  errors?: Array<{ code: string; message: string }>;
  error?: Record<string, unknown>;
}

export interface MediaDownloadResult {
  runId: string;
  status: string;
  planId: string;
  counts?: Record<string, number>;
  bytes?: number;
  receipts?: Array<Record<string, unknown>>;
  errors?: Array<{ code: string; message: string }>;
  warnings?: Array<{ code: string; message: string }>;
}

export interface MediaInspection {
  assets: Array<Record<string, unknown>>;
  totals: { assets: number; bytes: number; itemRefs: number; referencedAssets: number };
  downloads: Record<string, number>;
  receipts: Array<Record<string, unknown>>;
  parts: { count: number; bytes: number };
}

export interface DiagnosticsExport {
  path: string;
  bytes: number;
  createdAt: string;
}

export interface QmsApi {
  app: {
    info(): Promise<EngineInfo>;
    settings(): Promise<DesktopSettings>;
    setDataRoot(path: string): Promise<DesktopSettings>;
    openPath(path: string): Promise<Record<string, unknown>>;
  };
  projects: {
    list(includeArchived?: boolean): Promise<ProjectSummary[]>;
    inspect(projectId: string): Promise<ProjectInspection>;
    create(input: Record<string, unknown>): Promise<ProjectSummary>;
    open(projectId: string, recoverStaleLock?: boolean): Promise<{ project: ProjectDocument; snapshot: Record<string, unknown> }>;
    snapshot(projectId: string): Promise<Record<string, unknown>>;
    archive(projectId: string, deleteLocalData?: boolean): Promise<Record<string, unknown>>;
    update(projectId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
    saveWizard(projectId: string, wizard: WizardState): Promise<Record<string, unknown>>;
  };
  sources: {
    list(): Promise<AdapterInfo[]>;
    capabilities(adapterId: string): Promise<AdapterInfo>;
    validate(projectId: string, input: Record<string, unknown>): Promise<SourceValidationResult>;
    discover(projectId: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  identity: {
    get(projectId: string): Promise<{ identity: Record<string, unknown>; mappings: IdentityMapping[]; conflicts: Array<Record<string, unknown>> }>;
    validateTarget(target: Record<string, unknown>): Promise<{ qdnName: string; resourcePrefix: string }>;
    migrationPreview(projectId: string, target: Record<string, unknown>): Promise<Record<string, unknown>>;
    applyMigration(projectId: string, token: string): Promise<Record<string, unknown>>;
    resolveConflict(projectId: string, conflictId: string, resolution: string): Promise<Record<string, unknown>>;
  };
  plans: {
    list(projectId: string, limit?: number): Promise<PlanRecord[]>;
    create(projectId: string, options: Record<string, unknown>): Promise<PlanCreateResult>;
    get(projectId: string, planId: string): Promise<{ plan: PlanDocument; record: PlanRecord; planFile: string }>;
  };
  media: {
    download(projectId: string, planId: string, options?: Record<string, unknown>): Promise<MediaDownloadResult>;
    inspect(projectId: string): Promise<MediaInspection>;
  };
  disk: {
    check(projectId: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  runs: {
    list(projectId: string): Promise<RunSummary[]>;
    get(projectId: string, runId: string): Promise<Record<string, unknown>>;
    events(projectId: string, options?: Record<string, unknown>): Promise<QmsEvent[]>;
    cancel(projectId: string, runId: string): Promise<Record<string, unknown>>;
  };
  credentials: {
    status(): Promise<Record<string, unknown>>;
    forget(projectId: string): Promise<Record<string, unknown>>;
  };
  diagnostics: {
    export(projectId: string): Promise<DiagnosticsExport>;
  };
  events: {
    on(listener: (event: QmsEvent) => void): () => void;
  };
}

declare global {
  interface Window {
    qms: QmsApi;
  }
}

