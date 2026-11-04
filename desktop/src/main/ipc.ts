import { BrowserWindow, ipcMain, shell } from 'electron';
import { IPC } from '../shared/channels.js';
import { validateIpcPayload } from '../shared/validation.js';
import type { EngineHost } from './host.js';
import type { CredentialStore } from './credentials.js';
import { sanitizeForDiagnostics } from './diagnostics.js';
import { realpath } from 'node:fs/promises';
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
  'sync.status': 60_000,
  'sync.check': 30 * 60_000,
  'sync.resume': 30 * 60_000,
  'sync.get': 60_000,
  'sync.history': 60_000,
  'sync.plan': 20 * 60_000,
  'sync.conflicts': 60_000,
  'sync.resolveConflict': 60_000,
  'sync.withdraw': 120_000,
  'sync.prepareTombstones': 120_000,
  'sync.adopt': 120_000,
  'sync.adoptions': 60_000,
  'sync.withdrawals': 60_000,
  'sync.catalog': 60_000,
  'sync.writeCatalog': 60_000,
  'sync.recordQdnEvidence': 60_000,
  'project.open': 60_000,
  'project.inspect': 30_000,
  'diagnostics.export': 120_000,
  'recovery.status': 60_000,
  'recovery.resume': 30 * 60_000,
  'recovery.dismiss': 30_000,
  'recovery.reconcile': 15 * 60_000,
  'cleanup.preview': 10 * 60_000,
  'cleanup.start': 30 * 60_000,
  'cleanup.list': 30_000,
  'cleanup.get': 30_000,
  'cleanup.restore': 30 * 60_000,
  'cleanup.purge': 30 * 60_000,
  'cleanup.resume': 30 * 60_000,
  'history.list': 60_000,
  'history.export': 120_000,
  'support.bundle': 120_000,
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
      const dataRoot = await realpath(path.resolve(deps.dataRoot()));
      let resolved: string;
      try {
        resolved = await realpath(candidate);
      } catch {
        throw Object.assign(new Error('Only existing workspace paths may be opened.'), { code: 'PATH_NOT_ALLOWED' });
      }
      const relative = path.relative(dataRoot, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw Object.assign(new Error('Only workspace paths may be opened.'), { code: 'PATH_NOT_ALLOWED' });
      }
      const result = await shell.openPath(resolved);
      if (result) throw Object.assign(new Error(result), { code: 'OPEN_PATH_FAILED' });
      return { opened: true, path: resolved };
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

    [IPC.syncStatus]: async (params) => invoke('sync.status', { projectId: params.projectId }),
    [IPC.syncCheck]: async (params) => {
      const auth = await ensureAuth(String(params.projectId), params.auth);
      return invoke('sync.check', {
        projectId: params.projectId,
        mode: params.mode ?? 'auto',
        auth,
        source: params.source ?? {},
        query: params.query ?? {},
        contentTypes: params.contentTypes,
        perPage: params.perPage,
        maxItems: params.maxItems,
        overlapHours: params.overlapHours,
        fullReconcileDays: params.fullReconcileDays,
        autoApplyWithdrawals: params.autoApplyWithdrawals,
        withdrawalPolicy: params.withdrawalPolicy,
        classifyBatchSize: params.classifyBatchSize
      });
    },
    [IPC.syncResume]: async (params) => invoke('sync.resume', { projectId: params.projectId, scanId: params.scanId }),
    [IPC.syncGet]: async (params) => invoke('sync.get', { projectId: params.projectId, scanId: params.scanId }),
    [IPC.syncHistory]: async (params) => invoke('sync.history', { projectId: params.projectId, limit: params.limit ?? 50 }),
    [IPC.syncPlan]: async (params) => invoke('sync.plan', {
      projectId: params.projectId,
      scanId: params.scanId,
      selection: params.selection ?? null,
      batchSize: params.batchSize ?? 1000,
      planning: params.planning ?? {},
      disk: params.disk ?? {},
      media: params.media ?? {},
      estimateMedia: params.estimateMedia !== false
    }),
    [IPC.syncConflicts]: async (params) => invoke('sync.conflicts', {
      projectId: params.projectId,
      includeResolved: params.includeResolved === true,
      limit: params.limit ?? 500
    }),
    [IPC.syncResolveConflict]: async (params) => invoke('sync.resolveConflict', {
      projectId: params.projectId,
      conflictId: params.conflictId,
      resolution: params.resolution,
      note: params.note ?? null
    }),
    [IPC.syncWithdraw]: async (params) => invoke('sync.withdraw', {
      projectId: params.projectId,
      scanId: params.scanId,
      sourceKeys: params.sourceKeys ?? null,
      policy: params.policy ?? 'hide',
      note: params.note ?? null,
      automatic: params.automatic === true
    }),
    [IPC.syncPrepareTombstones]: async (params) => invoke('sync.prepareTombstones', {
      projectId: params.projectId,
      scanId: params.scanId,
      sourceKeys: params.sourceKeys ?? null,
      note: params.note ?? null
    }),
    [IPC.syncAdopt]: async (params) => invoke('sync.adopt', { projectId: params.projectId, note: params.note ?? null }),
    [IPC.syncAdoptions]: async (params) => invoke('sync.adoptions', { projectId: params.projectId, limit: params.limit ?? 20 }),
    [IPC.syncWithdrawals]: async (params) => invoke('sync.withdrawals', { projectId: params.projectId, limit: params.limit ?? 500 }),
    [IPC.syncCatalog]: async (params) => invoke('sync.catalog', { projectId: params.projectId, includeWithdrawn: params.includeWithdrawn === true }),
    [IPC.syncWriteCatalog]: async (params) => invoke('sync.writeCatalog', { projectId: params.projectId, scanId: params.scanId ?? null }),
    [IPC.syncRecordEvidence]: async (params) => invoke('sync.recordQdnEvidence', { projectId: params.projectId, ...(params.evidence ?? {}) }),

    [IPC.diskCheck]: async (params) => invoke('disk.check', params),

    [IPC.runList]: async (params) => invoke('run.list', { projectId: params.projectId }),
    [IPC.runGet]: async (params) => invoke('run.get', { projectId: params.projectId, runId: params.runId }),
    [IPC.runEvents]: async (params) => invoke('run.events', params),
    [IPC.runCancel]: async (params) => invoke('run.cancel', params),
    [IPC.runPause]: async (params) => invoke('run.pause', params),

    [IPC.credentialStatus]: async () => deps.credentials.status(),
    [IPC.credentialForget]: async (params) => {
      await deps.credentials.forget(String(params.projectId));
      return { forgotten: true };
    },
    [IPC.recoveryStatus]: async (params) => invoke('recovery.status', { projectId: params.projectId }),
    [IPC.recoveryResume]: async (params) => invoke('recovery.resume', {
      projectId: params.projectId,
      runId: params.runId ?? undefined,
      stageId: params.stageId ?? undefined,
      auth: params.auth ?? undefined
    }, 30 * 60_000),
    [IPC.recoveryDismiss]: async (params) => invoke('recovery.dismiss', {
      projectId: params.projectId,
      runId: params.runId,
      reason: params.reason ?? null
    }),
    [IPC.recoveryReconcile]: async (params) => invoke('recovery.reconcile', {
      projectId: params.projectId,
      handoffId: params.handoffId ?? null,
      nodeUrl: params.nodeUrl
    }, 15 * 60_000),

    [IPC.cleanupPreview]: async (params) => invoke('cleanup.preview', {
      projectId: params.projectId,
      handoffIds: params.handoffIds ?? null,
      includeHandoffPayloads: params.includeHandoffPayloads !== false,
      includeParts: params.includeParts !== false,
      retentionDays: params.retentionDays
    }, 10 * 60_000),
    [IPC.cleanupStart]: async (params) => invoke('cleanup.start', {
      projectId: params.projectId,
      handoffIds: params.handoffIds ?? null,
      includeHandoffPayloads: params.includeHandoffPayloads !== false,
      includeParts: params.includeParts !== false,
      retentionDays: params.retentionDays,
      dryRun: params.dryRun === true
    }, 30 * 60_000),
    [IPC.cleanupList]: async (params) => invoke('cleanup.list', { projectId: params.projectId, limit: params.limit ?? 100 }),
    [IPC.cleanupGet]: async (params) => invoke('cleanup.get', { projectId: params.projectId, cleanupId: params.cleanupId }),
    [IPC.cleanupRestore]: async (params) => invoke('cleanup.restore', { projectId: params.projectId, cleanupId: params.cleanupId }, 30 * 60_000),
    [IPC.cleanupPurge]: async (params) => invoke('cleanup.purge', {
      projectId: params.projectId,
      cleanupId: params.cleanupId,
      force: params.force === true
    }, 30 * 60_000),
    [IPC.cleanupResume]: async (params) => invoke('cleanup.resume', { projectId: params.projectId, cleanupId: params.cleanupId }, 30 * 60_000),

    [IPC.historyList]: async (params) => invoke('history.list', { projectId: params.projectId, limit: params.limit ?? 300 }),
    [IPC.historyExport]: async (params) => invoke('history.export', {
      projectId: params.projectId,
      reason: params.reason ?? 'manual-export'
    }),

    [IPC.diagnosticsExport]: async (params) => invoke('support.bundle', {
      projectId: params.projectId,
      appInfo: await deps.appInfo(),
      settings: deps.getSettings(),
      keyring: deps.credentials.status()
    }, 120_000)
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

