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
  sync?: {
    revision: number;
    scanCount: number;
    conflictCount: number;
    withdrawalCount: number;
    adoptionCount: number;
    latestScan: {
      scanId: string;
      status: string;
      mode: string;
      startedAt: string;
      completedAt: string | null;
      counts: SyncCounts | null;
    } | null;
  } | null;
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
  syncSchema: string;
  syncScanSchema: string;
  syncConflictSchema: string;
  withdrawalSchema: string;
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

export interface PublicationResource {
  id: string;
  kind: 'media' | 'content' | 'index' | 'manifest';
  service: string;
  name: string;
  identifier: string;
  relativePath: string;
  contentType: string;
  bytes: number;
  sha256: string;
  order: number;
  dependsOn: string[];
  sourceKey?: string | null;
  status: string;
  publisherReportedStatus?: string | null;
  reason?: string | null;
  txSignature?: string | null;
  remoteVerifiedAt?: string | null;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface PublicationHandoffSummary {
  handoffId: string;
  publicationBatchId: string;
  planId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  target: { qdnName: string; resourcePrefix: string };
  estimate: { resourceCount: number; feePerResource: number; estimatedFee: number; currency: string; label: string; batches: number };
  counts: Record<string, number>;
  resourceCount: number;
  handoffPath: string;
}

export interface PublicationHandoffDetail {
  handoff: PublicationHandoffSummary & { resources: PublicationResource[]; siteId: string; projectId: string };
  resources: PublicationResource[];
  absolutePath: string;
  packageValid: boolean;
  validation: { filesVerified: number; summary: Record<string, unknown> } | null;
}

export interface PublicationPrepareResult {
  handoffId: string;
  publicationBatchId: string;
  planId: string;
  status: string;
  handoffPath: string;
  absolutePath: string;
  resources: PublicationResource[];
  counts: Record<string, number>;
  estimate: Record<string, unknown>;
  packageValidated: boolean;
  message: string;
}

export interface PublicationVerifyResult {
  handoffId: string;
  status: string;
  counts: Record<string, number>;
  results: Array<{ resourceId: string; state: string; code?: string; message?: string; evidence?: Record<string, unknown> | null; transport?: string }>;
  resources: PublicationResource[];
  evidencePath: string;
  pendingOrUnverified: number;
}

export interface SyncCounts {
  scanned: number;
  new: number;
  modified: number;
  unchanged: number;
  unpublished: number;
  withdrawn: number;
  conflicts: number;
  notScanned: number;
  ignored: number;
  unsupported: number;
  failed: number;
}

export interface SyncDeltaEntry {
  sourceKey: string;
  contentType: string;
  title?: string | null;
  slug?: string | null;
  contentHash?: string;
  routeHash?: string | null;
  classification?: string;
  reason?: string | null;
  previousHash?: string | null;
  publicationStatus?: string | null;
  qdn?: { service: string; name: string; identifier: string } | null;
}

export interface SyncScanScope {
  schema: string;
  mode: string;
  coverage: 'full-site' | 'scoped';
  scoped: boolean;
  withdrawalEligible: boolean;
  watermarkEligible: boolean;
  truncated?: boolean;
  reasons: Array<{
    code: string;
    field?: string;
    missing?: string[];
    maxItems?: number;
  }>;
  query: Record<string, unknown>;
  contentTypes: string[] | null;
  maxItems: number | null;
}

export interface SyncScanSummary {
  schema: string;
  scanId: string;
  runId: string;
  adapterId: string;
  mode: 'full' | 'incremental';
  status: string;
  complete: boolean;
  planningAllowed: boolean;
  recoverable: boolean;
  truncated: boolean;
  startedAt: string;
  completedAt?: string | null;
  updatedAt?: string | null;
  batchId?: string | null;
  counts: SyncCounts;
  deltaCounts: Record<string, number>;
  delta: {
    new: SyncDeltaEntry[];
    modified: SyncDeltaEntry[];
    withdrawn: SyncDeltaEntry[];
    conflicts: SyncDeltaEntry[];
    unpublished: SyncDeltaEntry[];
  };
  failure?: { code: string; message: string; details?: Record<string, unknown> } | null;
  warnings: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
  reportPath?: string | null;
  catalogPath?: string | null;
  planId?: string | null;
  query: Record<string, unknown>;
  scope?: SyncScanScope | null;
  withdrawalEligible?: boolean;
  watermarkEligible?: boolean;
  withdrawals?: SyncWithdrawalSummary | null;
  checkpoint?: Record<string, unknown> | null;
}

export interface SyncWatermark {
  schema: string;
  adapterId: string;
  scanId: string | null;
  mode: string;
  lastCompletedAt: string | null;
  fullCompletedAt: string | null;
  updatedAt?: string;
  requiresFullScan?: boolean;
}

export interface SyncStatus {
  schema: string;
  revision: number;
  adapterId: string | null;
  watermarks: Record<string, SyncWatermark>;
  latestScan: SyncScanSummary | null;
  counts: {
    mappings: number;
    active: number;
    withdrawn: number;
    conflicts: number;
    identityConflicts: number;
    withdrawals: number;
  };
  adoptionRequired: boolean;
  adoptionCount: number;
  scans: SyncScanSummary[];
  hasCompletedFullScan: boolean;
  preferences: Record<string, unknown>;
}

export interface SyncWithdrawalSummary {
  applied: Array<{ withdrawalId: string; sourceKey: string; policy: string; networkDeleted: boolean; qdnDataPreserved: boolean }>;
  appliedCount: number;
  pending: number;
  blockedByScope?: number;
  withdrawalEligible?: boolean;
  scopeCoverage?: 'full-site' | 'scoped' | null;
  policy?: string;
  networkDeleted: boolean;
  qdnDataPreserved: boolean;
  message?: string;
}

export interface SyncCheckResult {
  runId: string;
  scanId: string;
  status: string;
  complete: boolean;
  planningAllowed: boolean;
  recoverable?: boolean;
  noChanges: boolean;
  counts: SyncCounts | null;
  delta?: SyncScanSummary['delta'];
  withdrawals?: SyncWithdrawalSummary;
  conflicts?: string[];
  reportPath?: string | null;
  catalogPath?: string | null;
  query?: Record<string, unknown>;
  scope?: SyncScanScope | null;
  withdrawalEligible?: boolean;
  watermarkAdvanced?: boolean;
  warnings?: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
  error?: { code: string; message: string; details?: Record<string, unknown> } | null;
  message?: string;
}

export interface SyncPlanResult {
  scanId: string;
  runId?: string;
  status: string;
  planId: string | null;
  plan?: PlanDocument | null;
  record?: PlanRecord | null;
  stats?: Record<string, number>;
  media?: Record<string, number>;
  disk?: Record<string, unknown>;
  warnings?: Array<{ code: string; message: string }>;
  errors?: Array<{ code: string; message: string }>;
  error?: Record<string, unknown>;
  noChanges?: boolean;
  message?: string;
}

export interface SyncConflict {
  id: string;
  kind: string;
  sourceKey: string;
  scanId: string | null;
  status: 'open' | 'resolved';
  severity: string;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  resolutionNote: string | null;
  automatic: boolean;
  evidence: {
    source?: Record<string, unknown> | null;
    local?: Record<string, unknown> | null;
    qdn?: Record<string, unknown> | null;
  };
  history: Array<Record<string, unknown>>;
  authorization?: Record<string, unknown>;
}

export interface SyncAdoptionReport {
  schema: string;
  projectId: string;
  siteId: string;
  adoptedAt: string;
  note: string | null;
  mappingCount: number;
  activeMappingCount: number;
  withdrawnMappingCount: number;
  verifiedResourceCount: number;
  handoffCount: number;
  issues: Array<{ code: string; sourceKey?: string; message: string }>;
  changedIdentities: boolean;
  message: string;
  required?: boolean;
  adopted?: boolean;
}

export interface SyncTombstoneResult {
  scanId: string;
  prepared: Array<{ sourceKey: string; withdrawalId: string; relativePath: string; sha256: string; bytes: number; published: boolean; networkDeleted: boolean }>;
  preparedCount: number;
  published: boolean;
  networkDeleted: boolean;
  message: string;
}

export interface RecoveryCandidate {
  runId: string | null;
  stageId?: string;
  kind: string;
  state: string;
  phase: string | null;
  step: string | null;
  cursor: number;
  total: number;
  resumable: boolean;
  action: { service: string; method: string; params: Record<string, unknown> } | null;
  resumeHint: string;
  startedAt: string | null;
  endedAt: string | null;
  error: { code?: string; message?: string } | null;
}

export interface AmbiguousResource {
  handoffId: string;
  resourceId: string;
  service: string;
  name: string;
  identifier: string;
  sha256: string | null;
  bytes: number | null;
  reason: string | null;
  txSignature: string | null;
  requiresReconciliation: boolean;
}

export interface RecoveryStatus {
  schema: string;
  projectId: string;
  checkedAt: string;
  recovery: {
    interruptedRuns: number;
    resumableRuns: number;
    interruptedStages?: number;
    ambiguousResources: number;
    corruptCheckpoints: number;
  };
  candidates: RecoveryCandidate[];
  ambiguousResources: AmbiguousResource[];
  corruptCheckpoints: Array<{ runId?: string; stageId?: string; file: string; error: string }>;
  cleanups: Array<{
    cleanupId: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    restoreBy: string | null;
    files: number;
    bytesQuarantined: number;
    bytesReclaimed: number;
  }>;
}

export interface RecoveryResumeResult {
  runId: string | null;
  stageId?: string | null;
  state: string;
  resumedFrom: Record<string, unknown>;
  result: Record<string, unknown> | null;
}

export interface CleanupItem {
  relativePath: string;
  category: string;
  bytes: number;
  hash: string | null;
  refCount?: number;
  eligible: boolean;
  reason: string | null;
  handoffId?: string | null;
  moved?: boolean;
  missing?: boolean;
  failed?: { code: string; message?: string } | null;
}

export interface CleanupPreview {
  schema: string;
  previewId: string;
  projectId: string;
  createdAt: string;
  scope: Record<string, unknown>;
  eligibleHandoffs: Array<{ handoffId: string; status: string; resources: number }>;
  refusedHandoffs: Array<{ handoffId: string; status: string; reason: string; resourceStatuses: Record<string, number> }>;
  items: CleanupItem[];
  totals: {
    files: number;
    bytes: number;
    eligibleFiles: number;
    eligibleBytes: number;
    protectedFiles: number;
    protectedBytes: number;
    unsafeFiles: number;
  };
  disk: { freeBytesBefore: number | null };
  protected: string[];
  warnings: Array<{ code: string; message: string }>;
  truncated?: boolean;
  eligible: boolean;
}

export interface CleanupRecord {
  schema: string;
  cleanupId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  retentionDays: number;
  restoreBy: string;
  scope: Record<string, unknown>;
  receiptPath: string;
  historySnapshotPath: string | null;
  fileCount: number;
  movedCount: number;
  bytesQuarantined: number;
  bytesReclaimed: number;
  bytesRestored?: number;
  failedItems: Array<{ relativePath: string; code: string; message?: string }>;
  disk: Record<string, number | null>;
  freed: Record<string, number | null>;
  items: CleanupItem[];
  filesDeleted?: number;
  diskFreeDeltaBytes?: number | null;
}

export interface HistoryEntry {
  schema: string;
  id: string;
  seq: number | null;
  at: string;
  type: string;
  runId: string | null;
  handoffId: string | null;
  resourceId: string | null;
  sourceKey: string | null;
  status: string | null;
  txSignature: string | null;
  contentHash: string | null;
  bytes: number | null;
  details: Record<string, unknown>;
  checksum?: string;
  source?: string;
}

export interface SupportBundleExport {
  schema: string;
  path: string;
  relativePath: string;
  bytes: number;
  createdAt: string;
  sections: string[];
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
  publication: {
    list(projectId: string): Promise<PublicationHandoffSummary[]>;
    prepare(projectId: string, planId: string, selection: string[], options?: Record<string, unknown>): Promise<PublicationPrepareResult>;
    get(projectId: string, handoffId: string, validate?: boolean): Promise<PublicationHandoffDetail>;
    importReceipt(projectId: string, handoffId: string, receipt: Record<string, unknown>): Promise<Record<string, unknown>>;
    verify(projectId: string, handoffId: string, nodeUrl: string, options?: Record<string, unknown>): Promise<PublicationVerifyResult>;
    history(projectId: string): Promise<Array<Record<string, unknown>>>;
    resources(projectId: string, handoffId?: string | null): Promise<PublicationResource[]>;
    batches(projectId: string, handoffId: string): Promise<PublicationResource[][]>;
  };
  sync: {
    status(projectId: string): Promise<SyncStatus>;
    check(projectId: string, options?: Record<string, unknown>): Promise<SyncCheckResult>;
    resume(projectId: string, scanId: string): Promise<SyncCheckResult>;
    get(projectId: string, scanId: string): Promise<SyncScanSummary>;
    history(projectId: string, limit?: number): Promise<SyncScanSummary[]>;
    plan(projectId: string, scanId: string, options?: Record<string, unknown>): Promise<SyncPlanResult>;
    conflicts(projectId: string, includeResolved?: boolean): Promise<SyncConflict[]>;
    resolveConflict(projectId: string, conflictId: string, resolution: string, note?: string | null): Promise<SyncConflict>;
    withdraw(projectId: string, scanId: string, options?: Record<string, unknown>): Promise<SyncWithdrawalSummary>;
    prepareTombstones(projectId: string, scanId: string, options?: Record<string, unknown>): Promise<SyncTombstoneResult>;
    adopt(projectId: string, note?: string | null): Promise<SyncAdoptionReport>;
    adoptions(projectId: string): Promise<SyncAdoptionReport[]>;
    withdrawals(projectId: string): Promise<Array<Record<string, unknown>>>;
    catalog(projectId: string, includeWithdrawn?: boolean): Promise<Array<Record<string, unknown>>>;
    writeCatalog(projectId: string, scanId?: string | null): Promise<Record<string, unknown>>;
    recordEvidence(projectId: string, evidence: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  runs: {
    list(projectId: string): Promise<RunSummary[]>;
    get(projectId: string, runId: string): Promise<Record<string, unknown>>;
    events(projectId: string, options?: Record<string, unknown>): Promise<QmsEvent[]>;
    cancel(projectId: string, runId: string): Promise<Record<string, unknown>>;
    pause(projectId: string, runId: string): Promise<Record<string, unknown>>;
  };
  credentials: {
    status(): Promise<Record<string, unknown>>;
    forget(projectId: string): Promise<Record<string, unknown>>;
  };
  recovery: {
    status(projectId: string): Promise<RecoveryStatus>;
    resume(projectId: string, target: { runId?: string; stageId?: string; auth?: Record<string, unknown> }): Promise<RecoveryResumeResult>;
    dismiss(projectId: string, runId: string, reason?: string): Promise<Record<string, unknown>>;
    reconcile(projectId: string, options: { handoffId?: string | null; nodeUrl: string }): Promise<Record<string, unknown>>;
  };
  cleanup: {
    preview(projectId: string, options?: Record<string, unknown>): Promise<CleanupPreview>;
    start(projectId: string, options?: Record<string, unknown>): Promise<CleanupRecord>;
    list(projectId: string, limit?: number): Promise<CleanupRecord[]>;
    get(projectId: string, cleanupId: string): Promise<CleanupRecord>;
    restore(projectId: string, cleanupId: string): Promise<CleanupRecord>;
    purge(projectId: string, cleanupId: string, force?: boolean): Promise<CleanupRecord>;
    resume(projectId: string, cleanupId: string): Promise<CleanupRecord>;
  };
  history: {
    list(projectId: string, limit?: number): Promise<HistoryEntry[]>;
    export(projectId: string, reason?: string): Promise<{ relativePath: string; path: string; bytes: number; entries: number; createdAt: string }>;
  };
  diagnostics: {
    export(projectId: string): Promise<SupportBundleExport>;
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

