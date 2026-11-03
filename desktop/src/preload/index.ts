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
    openPath: (path: string) => invoke(IPC.openPath, { path })
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
  runs: {
    list: (projectId: string) => invoke(IPC.runList, { projectId }),
    get: (projectId: string, runId: string) => invoke(IPC.runGet, { projectId, runId }),
    events: (projectId: string, options: Record<string, unknown> = {}) => invoke(IPC.runEvents, { projectId, ...options }),
    cancel: (projectId: string, runId: string) => invoke(IPC.runCancel, { projectId, runId })
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

