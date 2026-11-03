import { BrowserWindow, ipcMain, shell } from 'electron';
import { IPC } from '../shared/channels.js';
import { validateIpcPayload } from '../shared/validation.js';
import type { EngineHost } from './host.js';
import type { CredentialStore } from './credentials.js';
import { exportDiagnostics, sanitizeForDiagnostics } from './diagnostics.js';
import { trustedRendererUrl } from './window.js';
import path from 'node:path';

interface ApiResult<T = unknown> {
  ok: boolean;
  value?: T;
  error?: { code: string; message: string; details?: unknown };
}

const TIMEOUTS: Record<string, number> = {
  'source.validate': 120_000,
  'source.discover': 30 * 60_000,
  'plan.create': 20 * 60_000,
  'media.download': 60 * 60_000,
  'media.inspect': 60_000,
  'publication.prepare': 10 * 60_000,
  'publication.list': 30_000,
  'publication.get': 120_000,
  'publication.importReceipt': 120_000,
  'publication.verify': 15 * 60_000,
  'publication.history': 30_000,
  'publication.resources': 30_000,
  'publication.batches': 30_000,
  'project.open': 60_000,
  'project.inspect': 30_000,
  'diagnostics.export': 120_000,
  'run.cancel': 15_000
};

export interface IpcDependencies {
  host: EngineHost;
  credentials: CredentialStore;
  getWindow: () => BrowserWindow | null;
  getSettings: () => Record<string, unknown>;
  setDataRoot: (candidate: string) => Promise<Record<string, unknown>>;
  appInfo: () => Promise<Record<string, unknown>>;
  dataRoot: () => string;
}

function errorPayload(error: unknown) {
  const value = error as { code?: string; message?: string; details?: unknown };
  return {
    code: typeof value?.code === 'string' ? value.code : 'INTERNAL_ERROR',
    message: typeof value?.message === 'string' ? value.message : 'Unexpected error.',
    details: sanitizeForDiagnostics(value?.details ?? {})
  };
}

export function registerIpc(deps: IpcDependencies): void {
  const invoke = <T = unknown>(method: string, params: Record<string, unknown>, fallbackTimeout = 60_000): Promise<T> =>
    deps.host.request<T>(method, params, TIMEOUTS[method] ?? fallbackTimeout);

  const ensureAuth = async (projectId: string, supplied: unknown): Promise<Record<string, unknown>> => {
    if (supplied && typeof supplied === 'object' && (supplied as Record<string, unknown>).mode !== 'none') {
      return supplied as Record<string, unknown>;
    }
    return (await deps.credentials.get(projectId)) ?? (supplied as Record<string, unknown>) ?? { mode: 'none' };
  };

  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
    [IPC.appInfo]: async () => deps.appInfo(),
    [IPC.appSettings]: async () => deps.getSettings(),
    [IPC.setDataRoot]: async (params) => deps.setDataRoot(String(params.path)),

    [IPC.openPath]: async (params) => {
      const candidate = path.resolve(String(params.path));
      const dataRoot = path.resolve(deps.dataRoot());
      if (candidate !== dataRoot && !candidate.startsWith(dataRoot + path.sep)) {
        throw Object.assign(new Error('Only workspace paths may be opened.'), { code: 'PATH_NOT_ALLOWED' });
      }
      const result = await shell.openPath(candidate);
      if (result) throw Object.assign(new Error(result), { code: 'OPEN_PATH_FAILED' });
      return { opened: true, path: candidate };
    },

    [IPC.projectList]: async (params) => invoke('project.list', { includeArchived: params.includeArchived === true }),
    [IPC.projectInspect]: async (params) => invoke('project.inspect', { projectId: params.projectId }),
    [IPC.projectCreate]: async (params) => invoke('project.create', params),
    [IPC.projectOpen]: async (params) => invoke('project.open', { projectId: params.projectId, recoverStaleLock: params.recoverStaleLock === true }),
    [IPC.projectSnapshot]: async (params) => invoke('project.snapshot', { projectId: params.projectId }),
    [IPC.projectArchive]: async (params) => invoke('project.archive', { projectId: params.projectId, deleteLocalData: params.deleteLocalData === true }),
    [IPC.projectUpdate]: async (params) => invoke('project.update', { projectId: params.projectId, patch: params.patch ?? {} }),
    [IPC.projectSaveWizard]: async (params) => invoke('project.update', {
      projectId: params.projectId,
      patch: { settings: { desktopWizard: params.wizard } }
    }),

    [IPC.sourceList]: async () => invoke('source.list', {}),
    [IPC.sourceCapabilities]: async (params) => invoke('source.capabilities', { adapterId: params.adapterId }),
    [IPC.sourceValidate]: async (params) => {
      const auth = await ensureAuth(String(params.projectId), params.auth);
      if (params.remember === true) await deps.credentials.store(String(params.projectId), auth, true);
      else await deps.credentials.store(String(params.projectId), auth, false);
      return invoke('source.validate', {
        projectId: params.projectId,
        adapterId: params.adapterId,
        auth,
        source: params.source ?? {}
      });
    },
    [IPC.sourceDiscover]: async (params) => {
      const auth = await ensureAuth(String(params.projectId), params.auth);
      return invoke('source.discover', {
        projectId: params.projectId,
        adapterId: params.adapterId,
        auth,
        source: params.source ?? {},
        contentTypes: params.contentTypes,
        query: params.query ?? {},
        perPage: params.perPage,
        maxItems: params.maxItems
      });
    },

    [IPC.identityGet]: async (params) => invoke('identity.get', { projectId: params.projectId }),
    [IPC.identityValidateTarget]: async (params) => invoke('identity.validateTarget', { target: params.target }),
    [IPC.identityMigrationPreview]: async (params) => invoke('identity.migrationPreview', { projectId: params.projectId, target: params.target }),
    [IPC.identityApplyMigration]: async (params) => invoke('identity.applyMigration', { projectId: params.projectId, token: params.token }),
    [IPC.identityResolveConflict]: async (params) => invoke('identity.resolveConflict', params),

    [IPC.planList]: async (params) => invoke('plan.list', { projectId: params.projectId, limit: params.limit }),
    [IPC.planCreate]: async (params) => invoke('plan.create', params),
    [IPC.planGet]: async (params) => invoke('plan.get', { projectId: params.projectId, planId: params.planId }),

    [IPC.mediaDownload]: async (params) => invoke('media.download', params),
    [IPC.mediaInspect]: async (params) => invoke('media.inspect', { projectId: params.projectId }),

    [IPC.publicationList]: async (params) => invoke('publication.list', { projectId: params.projectId }),
    [IPC.publicationPrepare]: async (params) => invoke('publication.prepare', {
      projectId: params.projectId,
      planId: params.planId,
      selection: params.selection,
      feePerResource: params.feePerResource,
      feeCurrency: params.feeCurrency
    }),
    [IPC.publicationGet]: async (params) => invoke('publication.get', {
      projectId: params.projectId,
      handoffId: params.handoffId,
      validate: params.validate !== false
    }),
    [IPC.publicationImportReceipt]: async (params) => invoke('publication.importReceipt', {
      projectId: params.projectId,
      handoffId: params.handoffId,
      receipt: params.receipt
    }),
    [IPC.publicationVerify]: async (params) => invoke('publication.verify', {
      projectId: params.projectId,
      handoffId: params.handoffId,
      nodeUrl: params.nodeUrl,
      attempts: params.attempts ?? 6,
      intervalMs: params.intervalMs ?? 1500
    }),
    [IPC.publicationHistory]: async (params) => invoke('publication.history', { projectId: params.projectId }),
    [IPC.publicationResources]: async (params) => invoke('publication.resources', {
      projectId: params.projectId,
      handoffId: params.handoffId ?? null
    }),
    [IPC.publicationBatches]: async (params) => invoke('publication.batches', {
      projectId: params.projectId,
      handoffId: params.handoffId
    }),

    [IPC.diskCheck]: async (params) => invoke('disk.check', params),

    [IPC.runList]: async (params) => invoke('run.list', { projectId: params.projectId }),
    [IPC.runGet]: async (params) => invoke('run.get', { projectId: params.projectId, runId: params.runId }),
    [IPC.runEvents]: async (params) => invoke('run.events', params),
    [IPC.runCancel]: async (params) => invoke('run.cancel', params),

    [IPC.credentialStatus]: async () => deps.credentials.status(),
    [IPC.credentialForget]: async (params) => {
      await deps.credentials.forget(String(params.projectId));
      return { forgotten: true };
    },
    [IPC.diagnosticsExport]: async (params) => exportDiagnostics({
      host: deps.host,
      dataRoot: deps.dataRoot(),
      projectId: String(params.projectId),
      appInfo: await deps.appInfo(),
      settings: deps.getSettings(),
      keyring: deps.credentials.status()
    })
  };

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, raw): Promise<ApiResult> => {
      const frameUrl = event.senderFrame?.url ?? '';
      if (!trustedRendererUrl(frameUrl)) {
        return { ok: false, error: { code: 'UNTRUSTED_SENDER', message: 'IPC request rejected from an untrusted renderer.' } };
      }
      const window = deps.getWindow();
      if (!window || event.sender.id !== window.webContents.id) {
        return { ok: false, error: { code: 'UNTRUSTED_SENDER', message: 'IPC request rejected from an unknown window.' } };
      }
      try {
        const params = validateIpcPayload(channel, raw);
        const value = await handler(params);
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: errorPayload(error) };
      }
    });
  }
}

export function forwardEngineEvent(window: BrowserWindow | null, event: Record<string, unknown>): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(IPC.event, sanitizeForDiagnostics(event));
}

