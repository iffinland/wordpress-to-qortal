import { vi } from 'vitest';
import type { AdapterInfo, DesktopSettings, PlanDocument, ProjectDocument, QmsApi, SyncScanSummary } from '../../src/shared/types.js';

export const siteId = 'site_0123456789abcdef0123456789abcdef';
export const namespace = 'nsabcdefghijklmn';

export function adapter(overrides: Partial<AdapterInfo> = {}): AdapterInfo {
  return {
    id: 'wordpress',
    displayName: 'WordPress',
    version: '1.0.0',
    contract: 'qms-source-adapter@1',
    contractVersion: 1,
    capabilities: {
      contentTypes: ['post', 'page'],
      terms: ['category', 'tag'],
      assets: { images: true, audio: true, video: true, documents: true, embeds: true },
      states: ['publish', 'draft'],
      incremental: { new: true, modified: true },
      authentication: ['none', 'application_password'],
      limits: {},
      unsupported: { comments: 'reported-not-migrated' }
    },
    ...overrides
  };
}

export function project(overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    id: 'prj_abcdefgh',
    name: 'Demo publication',
    slug: 'demo-publication',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-03T10:00:00.000Z',
    archivedAt: null,
    profileId: null,
    resourcePrefix: 'qms',
    siteId,
    siteNamespace: namespace,
    sourceAdapter: 'wordpress',
    sourceBaseUrl: 'https://example.org',
    targetQdnName: 'DemoQortalName',
    siteName: 'Demo publication',
    storageRoot: '/home/user/.local/share/qortal-migration-studio/projects/prj_abcdefgh',
    schema: 'qms-project@1',
    version: 1,
    source: { adapter: 'wordpress', baseUrl: 'https://example.org' },
    target: { qdnName: 'DemoQortalName', siteName: 'Demo publication', siteDescription: 'A demo' },
    settings: {
      desktopWizard: {
        step: 5,
        completedSteps: [1, 2, 3, 4],
        adapterId: 'wordpress',
        sourceUrl: 'https://example.org',
        authMode: 'none',
        connection: { status: 'completed', report: { ok: true, auth: { mode: 'none', authenticated: true } } },
        targetQdnName: 'DemoQortalName',
        siteTitle: 'Demo publication',
        siteDescription: 'A demo',
        preferences: { batchSize: 15, contentTypes: ['post'], reserveGib: 0, maxRunGib: 0, maxFileMib: 256, maxFiles: 500, unknownPolicy: 'reject', allowExternalMedia: false, concurrency: 4 },
        planId: null,
        updatedAt: '2026-11-03T10:00:00.000Z'
      }
    },
    template: {},
    identity: { siteId, namespace, createdAt: '2026-11-01T10:00:00.000Z' },
    ...overrides
  };
}

export function settings(overrides: Partial<DesktopSettings> = {}): DesktopSettings {
  return {
    dataRoot: '/home/user/.local/share/qortal-migration-studio',
    configFile: '/home/user/.config/qortal-migration-studio/desktop-config.json',
    keyring: { available: false, backend: 'session-memory', persistentCredentials: false },
    appVersion: '0.5.0',
    platform: 'linux',
    arch: 'x64',
    packaged: false,
    ...overrides
  };
}

export function plan(): PlanDocument {
  return {
    schema: 'qms-plan@1',
    planId: 'plan_abcdefgh',
    projectId: 'prj_abcdefgh',
    siteId,
    namespace,
    target: { qdnName: 'DemoQortalName', resourcePrefix: 'qms' },
    status: 'ready',
    batchId: 'batch_test',
    runId: 'run_abcdefgh',
    filters: {},
    config: {},
    selection: { selected: 1, batchSize: 15 },
    stats: { selected: 1, new: 1, modified: 0, unchanged: 0, route_changed: 0, reserved: 1, conflict: 0, unsupported: 0 },
    entries: [{
      id: 'item_1',
      sourceKey: 'post:1',
      contentType: 'post',
      title: 'First post',
      slug: 'first-post',
      status: 'new',
      contentHash: 'sha256:abc',
      routeHash: 'sha256:def',
      mediaCount: 0,
      qdn: { service: 'DOCUMENT', name: 'DemoQortalName', identifier: 'qms-ns-conabc' },
      publicationStatus: 'reserved',
      localPreparation: 'reserved',
      pendingPublication: true
    }],
    media: [],
    mediaSummary: { count: 0, knownCount: 0, knownBytes: 0, unknownCount: 0, missingCount: 0 },
    pendingPublication: { count: 1, prepared: 0, reserved: 1, entries: [], note: 'Reserved locally; never counted as published.' },
    estimates: { contentResources: 1, mediaResources: 0, totalResources: 1, feePerResource: 0.01, estimatedFee: 0.01, feeCurrency: 'QORT', note: 'estimate only' },
    disk: { availableBytes: 1000000000, reserveBytes: 0, projectedBytes: 1000, fits: true },
    conflicts: [],
    warnings: [],
    errors: [],
    createdAt: '2026-11-03T10:00:00.000Z'
  };
}

type SyncScanOverrides = Omit<Partial<SyncScanSummary>, 'counts'> & { counts?: Partial<SyncScanSummary['counts']> };

export function syncScan(overrides: SyncScanOverrides = {}): SyncScanSummary {
  const counts = {
    scanned: 0,
    new: 0,
    modified: 0,
    unchanged: 0,
    unpublished: 0,
    withdrawn: 0,
    conflicts: 0,
    notScanned: 0,
    ignored: 0,
    unsupported: 0,
    failed: 0,
    ...(overrides.counts ?? {})
  };
  return {
    schema: 'qms-sync-scan@1',
    scanId: 'scn_test',
    runId: 'run_sync',
    adapterId: 'wordpress',
    mode: 'incremental',
    status: 'completed',
    complete: true,
    planningAllowed: true,
    recoverable: false,
    truncated: false,
    startedAt: '2026-11-03T10:00:00.000Z',
    completedAt: '2026-11-03T10:01:00.000Z',
    updatedAt: '2026-11-03T10:01:00.000Z',
    batchId: 'batch_test',
    deltaCounts: { new: 0, modified: 0, unchanged: 0, unpublished: 0, withdrawn: 0, conflicts: 0, notScanned: 0 },
    delta: { new: [], modified: [], withdrawn: [], conflicts: [], unpublished: [] },
    failure: null,
    warnings: [],
    reportPath: 'artifacts/sync/scn_test/report.json',
    catalogPath: 'artifacts/sync/scn_test/catalog.json',
    planId: null,
    query: {},
    checkpoint: null,
    ...overrides,
    counts
  };
}

export function syncStatusFixture(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'qms-sync-state@1',
    revision: 1,
    adapterId: 'wordpress',
    watermarks: {},
    latestScan: syncScan(),
    counts: { mappings: 3, active: 3, withdrawn: 0, conflicts: 0, identityConflicts: 0, withdrawals: 0 },
    adoptionRequired: false,
    adoptionCount: 0,
    scans: [syncScan()],
    hasCompletedFullScan: true,
    preferences: { autoApplyWithdrawals: true, withdrawalPolicy: 'hide', overlapHours: 48, fullReconcileDays: 7 },
    ...overrides
  };
}

export function mockApi(overrides: Partial<QmsApi> = {}): QmsApi {
  const base: QmsApi = {
    app: {
      info: vi.fn(async () => ({ apiVersion: 'qms-engine@1', version: '0.1.9-phase8', dataRoot: '/data', repoRoot: '/repo', sourceContract: 'qms-source-adapter@1', contentSchema: 'qms-content@1', planSchema: 'qms-plan@1', identitySchema: 'qms-identity-state@1', syncSchema: 'qms-sync-state@1', syncScanSchema: 'qms-sync-scan@1', syncConflictSchema: 'qms-sync-conflict@1', withdrawalSchema: 'qms-withdrawal-record@1', eventSchema: 'qms-event@1', adapters: [adapter()] })),
      settings: vi.fn(async () => settings()),
      setDataRoot: vi.fn(async () => settings()),
      openPath: vi.fn(async () => ({ opened: true, path: '/tmp' }))
    },
    projects: {
      list: vi.fn(async () => [project()]),
      inspect: vi.fn(async () => ({
        project: project() as never,
        identity: { siteId, namespace, target: { qdnName: 'DemoQortalName' }, mappingCount: 1, pendingPublicationCount: 1, preparedCount: 0, publishedCount: 0, unresolvedConflicts: 0 },
        runs: [],
        plans: [],
        lastActivity: '2026-11-03T10:00:00.000Z',
        activeRuns: 0,
        interruptedRuns: 0
      })),
      create: vi.fn(async () => project() as never),
      open: vi.fn(async () => ({ project: project(), snapshot: {} })),
      snapshot: vi.fn(async () => ({})),
      archive: vi.fn(async () => ({ archived: true })),
      update: vi.fn(async () => ({ project: project() })),
      saveWizard: vi.fn(async () => ({ project: project() }))
    },
    sources: {
      list: vi.fn(async () => [adapter()]),
      capabilities: vi.fn(async () => adapter()),
      validate: vi.fn(async () => ({ runId: 'run_test', status: 'completed', report: { ok: true, adapter: 'wordpress', adapterVersion: '1.0.0', auth: { mode: 'none', authenticated: true }, site: { name: 'Demo' }, counts: {}, contentTypes: ['post', 'page'], unsupported: {}, warnings: [] } })),
      discover: vi.fn(async () => ({}))
    },
    identity: {
      get: vi.fn(async () => ({ identity: {}, mappings: [], conflicts: [] })),
      validateTarget: vi.fn(async () => ({ qdnName: 'DemoQortalName', resourcePrefix: 'qms' })),
      migrationPreview: vi.fn(async () => ({})),
      applyMigration: vi.fn(async () => ({})),
      resolveConflict: vi.fn(async () => ({}))
    },
    plans: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({ runId: 'run_test', status: 'completed', planId: 'plan_abcdefgh', plan: plan(), stats: plan().stats, media: plan().mediaSummary, disk: plan().disk })),
      get: vi.fn(async () => ({ plan: plan(), record: { planId: 'plan_abcdefgh', status: 'ready', batchId: 'batch_test', selectedCount: 1, conflictCount: 0, createdAt: '2026-11-03T10:00:00.000Z' }, planFile: '/tmp/plan.json' }))
    },
    media: {
      download: vi.fn(async () => ({ runId: 'run_test', status: 'completed', planId: 'plan_abcdefgh', counts: { verified: 0 } })),
      inspect: vi.fn(async () => ({ assets: [], totals: { assets: 0, bytes: 0, itemRefs: 0, referencedAssets: 0 }, downloads: {}, receipts: [], parts: { count: 0, bytes: 0 } }))
    },
    disk: { check: vi.fn(async () => ({ availableBytes: 1000000000, reserveBytes: 0, fits: true })) },
    publication: {
      list: vi.fn(async () => []),
      prepare: vi.fn(async () => ({
        handoffId: 'hof_abcdefgh12345678',
        publicationBatchId: 'pub_abcdefgh12345678',
        planId: 'plan_abcdefgh',
        status: 'handoff_ready',
        handoffPath: 'publication/handoffs/hof_abcdefgh12345678',
        absolutePath: '/data/projects/prj_demo/publication/handoffs/hof_abcdefgh12345678',
        resources: [],
        counts: {},
        estimate: {},
        packageValidated: true,
        message: 'ready'
      })),
      get: vi.fn(async () => ({
        handoff: {
          handoffId: 'hof_abcdefgh12345678', publicationBatchId: 'pub_abcdefgh12345678', planId: 'plan_abcdefgh',
          projectId: 'prj_demo', siteId, status: 'handoff_ready', createdAt: '2026-11-03T10:00:00.000Z',
          updatedAt: '2026-11-03T10:00:00.000Z', target: { qdnName: 'DemoQortalName', resourcePrefix: 'qms' },
          estimate: { resourceCount: 0, feePerResource: 0, estimatedFee: 0, currency: 'QORT', label: 'estimate', batches: 0 },
          counts: {}, resourceCount: 0, handoffPath: 'publication/handoffs/hof_abcdefgh12345678', resources: []
        },
        resources: [],
        absolutePath: '/data/projects/prj_demo/publication/handoffs/hof_abcdefgh12345678',
        packageValid: true,
        validation: { filesVerified: 0, summary: {} }
      })),
      importReceipt: vi.fn(async () => ({ imported: true })),
      verify: vi.fn(async () => ({ handoffId: 'hof_abcdefgh12345678', status: 'pending_confirmation', counts: {}, results: [], resources: [], evidencePath: '', pendingOrUnverified: 0 })),
      history: vi.fn(async () => []),
      resources: vi.fn(async () => []),
      batches: vi.fn(async () => [])
    },
    sync: {
      status: vi.fn(async () => ({
        schema: 'qms-sync-state@1',
        revision: 1,
        adapterId: 'wordpress',
        watermarks: {},
        latestScan: null,
        counts: { mappings: 0, active: 0, withdrawn: 0, conflicts: 0, identityConflicts: 0, withdrawals: 0 },
        adoptionRequired: false,
        adoptionCount: 0,
        scans: [],
        hasCompletedFullScan: false,
        preferences: { autoApplyWithdrawals: true, withdrawalPolicy: 'hide', overlapHours: 48, fullReconcileDays: 7 }
      })),
      check: vi.fn(async () => ({
        runId: 'run_sync',
        scanId: 'scn_test',
        status: 'completed',
        complete: true,
        planningAllowed: true,
        noChanges: false,
        counts: { scanned: 0, new: 0, modified: 0, unchanged: 0, unpublished: 0, withdrawn: 0, conflicts: 0, notScanned: 0, ignored: 0, unsupported: 0, failed: 0 },
        delta: { new: [], modified: [], withdrawn: [], conflicts: [], unpublished: [] },
        withdrawals: { applied: [], appliedCount: 0, pending: 0, networkDeleted: false, qdnDataPreserved: true },
        warnings: [],
        query: {}
      })),
      resume: vi.fn(async () => ({ runId: 'run_sync', scanId: 'scn_test', status: 'completed', complete: true, planningAllowed: true, noChanges: false, counts: { scanned: 0, new: 0, modified: 0, unchanged: 0, unpublished: 0, withdrawn: 0, conflicts: 0, notScanned: 0, ignored: 0, unsupported: 0, failed: 0 } })),
      get: vi.fn(async () => syncScan()),
      history: vi.fn(async () => []),
      plan: vi.fn(async () => ({ scanId: 'scn_test', status: 'completed', planId: 'plan_abcdefgh', plan: plan(), record: { planId: 'plan_abcdefgh', status: 'ready', batchId: 'batch_test', selectedCount: 1, conflictCount: 0, createdAt: '2026-11-03T10:00:00.000Z' }, stats: plan().stats, media: plan().mediaSummary, disk: plan().disk })),
      conflicts: vi.fn(async () => []),
      resolveConflict: vi.fn(async () => ({ id: 'scf_test', kind: 'QDN_EXTERNAL_CHANGE', sourceKey: 'post:1', scanId: null, status: 'resolved' as const, severity: 'blocking', createdAt: '2026-11-03T10:00:00.000Z', resolvedAt: '2026-11-03T10:00:00.000Z', resolution: 'take_source' as const, resolutionNote: null, automatic: false, evidence: {}, history: [] as Array<Record<string, unknown>> })),
      withdraw: vi.fn(async () => ({ applied: [], appliedCount: 0, pending: 0, networkDeleted: false, qdnDataPreserved: true })),
      prepareTombstones: vi.fn(async () => ({ scanId: 'scn_test', prepared: [], preparedCount: 0, published: false, networkDeleted: false, message: 'prepared only' })),
      adopt: vi.fn(async () => ({ schema: 'qms-sync-adoption-report@1', projectId: 'prj_abcdefgh', siteId, adoptedAt: '2026-11-03T10:00:00.000Z', note: null, mappingCount: 1, activeMappingCount: 1, withdrawnMappingCount: 0, verifiedResourceCount: 0, handoffCount: 0, issues: [], changedIdentities: false, message: 'Existing migration adopted without changing verified QDN identities.' })),
      adoptions: vi.fn(async () => []),
      withdrawals: vi.fn(async () => []),
      catalog: vi.fn(async () => []),
      writeCatalog: vi.fn(async () => ({ written: true })),
      recordEvidence: vi.fn(async () => ({ changed: false }))
    },
    runs: {
      list: vi.fn(async () => []),
      get: vi.fn(async () => ({})),
      events: vi.fn(async () => []),
      cancel: vi.fn(async () => ({ cancelRequested: true })),
      pause: vi.fn(async () => ({ pauseRequested: true }))
    },
    credentials: {
      status: vi.fn(async () => ({ available: false, backend: 'session-memory' })),
      forget: vi.fn(async () => ({}))
    },
    recovery: {
      status: vi.fn(async () => ({
        schema: 'qms-recovery-status@1',
        projectId: 'prj_demo',
        checkedAt: '2026-11-04T10:00:00.000Z',
        recovery: { interruptedRuns: 1, resumableRuns: 1, interruptedStages: 0, ambiguousResources: 0, corruptCheckpoints: 0 },
        candidates: [{
          runId: 'run_abcdefgh12345678',
          kind: 'media.download',
          state: 'interrupted',
          phase: 'download',
          step: 'download_record',
          cursor: 1,
          total: 2,
          resumable: true,
          action: { service: 'media', method: 'download', params: { planId: 'plan_abcdefgh' } },
          resumeHint: 'Resume re-runs the operation idempotently from the last durable checkpoint.',
          startedAt: '2026-11-04T09:00:00.000Z',
          endedAt: '2026-11-04T09:01:00.000Z',
          error: null
        }],
        ambiguousResources: [],
        corruptCheckpoints: [],
        cleanups: []
      })),
      resume: vi.fn(async () => ({ runId: 'run_abcdefgh12345678', state: 'resumed', resumedFrom: { step: 'download_record' }, result: { runId: 'run_new' } })),
      dismiss: vi.fn(async () => ({ runId: 'run_abcdefgh12345678', state: 'abandoned' })),
      reconcile: vi.fn(async () => ({ reconciled: 1, verified: 1, stillAmbiguous: 0, resubmitted: false }))
    },
    cleanup: {
      preview: vi.fn(async () => ({
        schema: 'qms-cleanup-preview@1',
        previewId: 'cln_abcdefgh12345678',
        projectId: 'prj_demo',
        createdAt: '2026-11-04T10:00:00.000Z',
        scope: { retentionDays: 14 },
        eligibleHandoffs: [{ handoffId: 'hof_abcdefgh12345678', status: 'remote_verified', resources: 2 }],
        refusedHandoffs: [],
        items: [{ relativePath: 'media/assets/aa/hash', category: 'media_asset', bytes: 1024, hash: 'sha256:abc', eligible: true, reason: null }],
        totals: { files: 1, bytes: 1024, eligibleFiles: 1, eligibleBytes: 1024, protectedFiles: 0, protectedBytes: 0, unsafeFiles: 0 },
        disk: { freeBytesBefore: 1000000 },
        protected: ['state', 'history'],
        warnings: [],
        eligible: true
      })),
      start: vi.fn(async () => ({
        schema: 'qms-cleanup-record@1',
        cleanupId: 'cln_abcdefgh12345678',
        status: 'quarantined',
        createdAt: '2026-11-04T10:00:00.000Z',
        updatedAt: '2026-11-04T10:01:00.000Z',
        retentionDays: 14,
        restoreBy: '2026-11-18T10:00:00.000Z',
        scope: {},
        receiptPath: 'cleanup/receipts/cln_abcdefgh12345678.json',
        historySnapshotPath: 'history/snapshots/snapshot.json',
        fileCount: 1,
        movedCount: 1,
        bytesQuarantined: 1024,
        bytesReclaimed: 0,
        failedItems: [],
        disk: { freeBytesBefore: 1000000, freeBytesAfter: 1000000 },
        freed: { bytesQuarantined: 1024, bytesReclaimed: 0 },
        items: []
      })),
      list: vi.fn(async () => []),
      get: vi.fn(async () => ({}) as never),
      restore: vi.fn(async () => ({ status: 'restored', movedCount: 1 }) as never),
      purge: vi.fn(async () => ({ status: 'purged', bytesReclaimed: 1024 }) as never),
      resume: vi.fn(async () => ({ status: 'quarantined' }) as never)
    },
    history: {
      list: vi.fn(async () => [{
        schema: 'qms-audit-entry@1',
        id: 'aud_00000001',
        seq: 1,
        at: '2026-11-04T10:00:00.000Z',
        type: 'publication_verified',
        runId: null,
        handoffId: 'hof_abcdefgh12345678',
        resourceId: 'res_abcdefgh',
        sourceKey: 'post:1000',
        status: 'remote_verified',
        txSignature: 'sig_abcdefghijklmnop',
        contentHash: 'sha256:abcdef',
        bytes: 1024,
        details: {}
      }]),
      export: vi.fn(async () => ({ relativePath: 'history/snapshots/audit.json', path: '/data/history/snapshots/audit.json', bytes: 2048, entries: 10, createdAt: '2026-11-04T10:00:00.000Z' }))
    },
    diagnostics: { export: vi.fn(async () => ({
      schema: 'qms-support-bundle@1',
      path: '/data/exports/support.json',
      relativePath: 'exports/support.json',
      bytes: 123,
      createdAt: '2026-11-03T10:00:00.000Z',
      sections: ['app', 'project']
    })) },
    events: { on: vi.fn(() => () => {}) }
  };
  return { ...base, ...overrides };
}

