import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/channels.js';

interface Envelope {
  ok: boolean;
  value?: unknown;
  error?: { code?: string; message?: string; details?: unknown };
}

async function invoke(channel: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  const result = (await ipcRenderer.invoke(channel, payload)) as Envelope;
  if (result?.ok) return result.value;
  const error = new Error(result?.error?.message ?? 'Request failed.');
  (error as Error & { code?: string; details?: unknown }).code = result?.error?.code ?? 'IPC_ERROR';
  (error as Error & { details?: unknown }).details = result?.error?.details;
  throw error;
}

const api = {
  app: {
    info: () => invoke(IPC.appInfo),
    settings: () => invoke(IPC.appSettings),
    setDataRoot: (path: string) => invoke(IPC.setDataRoot, { path }),
    openPath: (path: string) => invoke(IPC.openPath, { path }),
    openUrl: (url: string) => invoke(IPC.openUrl, { url })
  },
  projects: {
    list: (includeArchived = false) => invoke(IPC.projectList, { includeArchived }),
    inspect: (projectId: string) => invoke(IPC.projectInspect, { projectId }),
    create: (input: Record<string, unknown>) => invoke(IPC.projectCreate, input),
    open: (projectId: string, recoverStaleLock = false) => invoke(IPC.projectOpen, { projectId, recoverStaleLock }),
    snapshot: (projectId: string) => invoke(IPC.projectSnapshot, { projectId }),
    archive: (projectId: string, deleteLocalData = false) => invoke(IPC.projectArchive, { projectId, deleteLocalData }),
    update: (projectId: string, patch: Record<string, unknown>) => invoke(IPC.projectUpdate, { projectId, patch }),
    saveWizard: (projectId: string, wizard: Record<string, unknown>) => invoke(IPC.projectSaveWizard, { projectId, wizard })
  },
  sources: {
    list: () => invoke(IPC.sourceList),
    capabilities: (adapterId: string) => invoke(IPC.sourceCapabilities, { adapterId }),
    validate: (projectId: string, input: Record<string, unknown>) => invoke(IPC.sourceValidate, { projectId, ...input }),
    discover: (projectId: string, input: Record<string, unknown>) => invoke(IPC.sourceDiscover, { projectId, ...input })
  },
  identity: {
    get: (projectId: string) => invoke(IPC.identityGet, { projectId }),
    validateTarget: (target: Record<string, unknown>) => invoke(IPC.identityValidateTarget, { target }),
    migrationPreview: (projectId: string, target: Record<string, unknown>) => invoke(IPC.identityMigrationPreview, { projectId, target }),
    applyMigration: (projectId: string, token: string) => invoke(IPC.identityApplyMigration, { projectId, token }),
    resolveConflict: (projectId: string, conflictId: string, resolution: string) => invoke(IPC.identityResolveConflict, { projectId, conflictId, resolution })
  },
  plans: {
    list: (projectId: string, limit = 100) => invoke(IPC.planList, { projectId, limit }),
    create: (projectId: string, options: Record<string, unknown>) => invoke(IPC.planCreate, { projectId, ...options }),
    get: (projectId: string, planId: string) => invoke(IPC.planGet, { projectId, planId })
  },
  media: {
    download: (projectId: string, planId: string, options: Record<string, unknown> = {}) => invoke(IPC.mediaDownload, { projectId, planId, ...options }),
    inspect: (projectId: string) => invoke(IPC.mediaInspect, { projectId })
  },
  disk: {
    check: (projectId: string, options: Record<string, unknown> = {}) => invoke(IPC.diskCheck, { projectId, ...options })
  },
  publication: {
    list: (projectId: string) => invoke(IPC.publicationList, { projectId }),
    prepare: (projectId: string, planId: string, selection: string[], options: Record<string, unknown> = {}) =>
      invoke(IPC.publicationPrepare, { projectId, planId, selection, ...options }),
    exportBundle: (projectId: string, handoffId: string) =>
      invoke(IPC.publicationExportBundle, { projectId, handoffId }),
    get: (projectId: string, handoffId: string, validate = true) =>
      invoke(IPC.publicationGet, { projectId, handoffId, validate }),
    importReceipt: (projectId: string, handoffId: string, receipt: Record<string, unknown>) =>
      invoke(IPC.publicationImportReceipt, { projectId, handoffId, receipt }),
    verify: (projectId: string, handoffId: string, nodeUrl: string, options: Record<string, unknown> = {}) =>
      invoke(IPC.publicationVerify, { projectId, handoffId, nodeUrl, ...options }),
    history: (projectId: string) => invoke(IPC.publicationHistory, { projectId }),
    resources: (projectId: string, handoffId?: string | null) =>
      invoke(IPC.publicationResources, { projectId, handoffId: handoffId ?? null }),
    batches: (projectId: string, handoffId: string) => invoke(IPC.publicationBatches, { projectId, handoffId })
  },
  sync: {
    status: (projectId: string) => invoke(IPC.syncStatus, { projectId }),
    check: (projectId: string, options: Record<string, unknown> = {}) => invoke(IPC.syncCheck, { projectId, ...options }),
    resume: (projectId: string, scanId: string) => invoke(IPC.syncResume, { projectId, scanId }),
    get: (projectId: string, scanId: string) => invoke(IPC.syncGet, { projectId, scanId }),
    history: (projectId: string, limit = 50) => invoke(IPC.syncHistory, { projectId, limit }),
    plan: (projectId: string, scanId: string, options: Record<string, unknown> = {}) => invoke(IPC.syncPlan, { projectId, scanId, ...options }),
    conflicts: (projectId: string, includeResolved = false) => invoke(IPC.syncConflicts, { projectId, includeResolved }),
    resolveConflict: (projectId: string, conflictId: string, resolution: string, note: string | null = null) =>
      invoke(IPC.syncResolveConflict, { projectId, conflictId, resolution, note }),
    withdraw: (projectId: string, scanId: string, options: Record<string, unknown> = {}) => invoke(IPC.syncWithdraw, { projectId, scanId, ...options }),
    prepareTombstones: (projectId: string, scanId: string, options: Record<string, unknown> = {}) =>
      invoke(IPC.syncPrepareTombstones, { projectId, scanId, ...options }),
    adopt: (projectId: string, note: string | null = null) => invoke(IPC.syncAdopt, { projectId, note }),
    adoptions: (projectId: string) => invoke(IPC.syncAdoptions, { projectId }),
    withdrawals: (projectId: string) => invoke(IPC.syncWithdrawals, { projectId }),
    catalog: (projectId: string, includeWithdrawn = false) => invoke(IPC.syncCatalog, { projectId, includeWithdrawn }),
    writeCatalog: (projectId: string, scanId: string | null = null) => invoke(IPC.syncWriteCatalog, { projectId, scanId }),
    recordEvidence: (projectId: string, evidence: Record<string, unknown>) => invoke(IPC.syncRecordEvidence, { projectId, evidence })
  },
  recovery: {
    status: (projectId: string) => invoke(IPC.recoveryStatus, { projectId }),
    resume: (projectId: string, target: { runId?: string; stageId?: string; auth?: Record<string, unknown> }) =>
      invoke(IPC.recoveryResume, { projectId, runId: target.runId, stageId: target.stageId, auth: target.auth }),
    dismiss: (projectId: string, runId: string, reason?: string) =>
      invoke(IPC.recoveryDismiss, { projectId, runId, reason }),
    reconcile: (projectId: string, options: { handoffId?: string | null; nodeUrl: string }) =>
      invoke(IPC.recoveryReconcile, { projectId, handoffId: options.handoffId ?? null, nodeUrl: options.nodeUrl })
  },
  cleanup: {
    preview: (projectId: string, options: Record<string, unknown> = {}) => invoke(IPC.cleanupPreview, { projectId, ...options }),
    start: (projectId: string, options: Record<string, unknown> = {}) => invoke(IPC.cleanupStart, { projectId, ...options }),
    list: (projectId: string, limit = 100) => invoke(IPC.cleanupList, { projectId, limit }),
    get: (projectId: string, cleanupId: string) => invoke(IPC.cleanupGet, { projectId, cleanupId }),
    restore: (projectId: string, cleanupId: string) => invoke(IPC.cleanupRestore, { projectId, cleanupId }),
    purge: (projectId: string, cleanupId: string, force = false) => invoke(IPC.cleanupPurge, { projectId, cleanupId, force }),
    resume: (projectId: string, cleanupId: string) => invoke(IPC.cleanupResume, { projectId, cleanupId })
  },
  history: {
    list: (projectId: string, limit = 300) => invoke(IPC.historyList, { projectId, limit }),
    export: (projectId: string, reason = 'manual-export') => invoke(IPC.historyExport, { projectId, reason })
  },
  runs: {
    list: (projectId: string) => invoke(IPC.runList, { projectId }),
    get: (projectId: string, runId: string) => invoke(IPC.runGet, { projectId, runId }),
    events: (projectId: string, options: Record<string, unknown> = {}) => invoke(IPC.runEvents, { projectId, ...options }),
    cancel: (projectId: string, runId: string) => invoke(IPC.runCancel, { projectId, runId }),
    pause: (projectId: string, runId: string) => invoke(IPC.runPause, { projectId, runId })
  },
  credentials: {
    status: () => invoke(IPC.credentialStatus),
    forget: (projectId: string) => invoke(IPC.credentialForget, { projectId })
  },
  diagnostics: {
    export: (projectId: string) => invoke(IPC.diagnosticsExport, { projectId })
  },
  events: {
    on: (listener: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
      ipcRenderer.on(IPC.event, handler);
      return () => ipcRenderer.removeListener(IPC.event, handler);
    }
  }
};

contextBridge.exposeInMainWorld('qms', api);

