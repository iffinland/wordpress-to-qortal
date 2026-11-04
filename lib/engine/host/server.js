import readline from 'node:readline';
import { QmsError, ERROR_CODES, isQmsError } from '../errors.js';
import { validateTargetInput } from '../identity.js';
import { resolveRunConfig } from '../config.js';
import { diskPreflight } from '../disk.js';

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const APPLICATION_ERROR = -32000;

function rpcError(id, code, message, data = null) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data ? { data } : {}) }
  };
}

function requireProjectId(params) {
  if (!params || typeof params.projectId !== 'string' || !params.projectId) {
    throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'params.projectId is required.');
  }
  return params.projectId;
}

/**
 * JSON-RPC 2.0-style host over newline-delimited JSON (stdio or Electron IPC).
 * Presentation logic lives in the caller; this file only maps requests to the
 * engine and streams qms-event@1 notifications.
 */
export async function runHost({ engine, input = process.stdin, output = process.stdout, clock }) {
  const sessions = new Map();
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let closed = false;
  let resolveClosed;
  const closedPromise = new Promise((resolve) => {
    resolveClosed = resolve;
  });

  function send(message) {
    if (!closed) {
      output.write(`${JSON.stringify(message)}\n`);
    }
  }

  async function requireHandle(params, { autoOpen = true } = {}) {
    const projectId = requireProjectId(params);
    let session = sessions.get(projectId);
    if (session) {
      return session;
    }
    if (!autoOpen) {
      throw new QmsError(ERROR_CODES.STATE_NOT_OPEN, 'Project is not open in this host session.', {
        details: { projectId }
      });
    }
    const handle = await engine.openProject(projectId, {
      recoverStaleLock: params.recoverStaleLock === true
    });
    session = {
      handle,
      unsubscribe: handle.events.subscribe((event) => {
        send({ jsonrpc: '2.0', method: 'qms.event', params: event });
      })
    };
    sessions.set(projectId, session);
    return session;
  }

  const methods = {
    async 'engine.info'() {
      return {
        apiVersion: engine.apiVersion,
        version: engine.version,
        dataRoot: engine.dataRoot,
        repoRoot: engine.repoRoot,
        eventSchema: 'qms-event@1',
        eventTypes: [
          'operation_started',
          'progress_updated',
          'warning_emitted',
          'operation_completed',
          'operation_failed',
          'operation_cancelled',
          'state_snapshot'
        ],
        sourceContract: 'qms-source-adapter@1',
        contentSchema: 'qms-content@1',
        planSchema: 'qms-plan@1',
        identitySchema: 'qms-identity-state@1',
        syncSchema: 'qms-sync-state@1',
        syncScanSchema: 'qms-sync-scan@1',
        syncConflictSchema: 'qms-sync-conflict@1',
        withdrawalSchema: 'qms-withdrawal-record@1',
        handoffSchema: 'qms-publication-handoff@1',
        receiptSchema: 'qms-publication-receipt@1',
        publicationStateSchema: 'qms-publication-state@1',
        auditEntrySchema: 'qms-audit-entry@1',
        historySnapshotSchema: 'qms-history-snapshot@1',
        recoveryCheckpointSchema: 'qms-recovery-checkpoint@1',
        recoveryStageSchema: 'qms-recovery-stage@1',
        recoveryStatusSchema: 'qms-recovery-status@1',
        cleanupRecordSchema: 'qms-cleanup-record@1',
        cleanupPreviewSchema: 'qms-cleanup-preview@1',
        supportBundleSchema: 'qms-support-bundle@1',
        maxPublishBatchResources: 20,
        eventSchema: 'qms-event@1',
        adapters: engine.sourceRegistry.list()
      };
    },
    async 'source.list'() {
      return engine.sourceRegistry.list();
    },
    async 'source.capabilities'(params = {}) {
      return engine.sourceRegistry.capabilities(params.adapterId ?? 'wordpress');
    },
    async 'source.validate'(params) {
      const session = await requireHandle(params);
      return session.handle.source.validate({
        adapterId: params.adapterId ?? null,
        auth: params.auth ?? null,
        source: params.source ?? {},
        signal: null
      });
    },
    async 'source.discover'(params) {
      const session = await requireHandle(params);
      return session.handle.source.discover({
        adapterId: params.adapterId ?? null,
        auth: params.auth ?? null,
        source: params.source ?? {},
        query: params.query ?? {},
        contentTypes: params.contentTypes ?? null,
        perPage: params.perPage ?? 100,
        progressEvery: params.progressEvery ?? 25,
        maxItems: params.maxItems ?? null,
        includeTerms: params.includeTerms !== false,
        includeAssets: params.includeAssets !== false,
        signal: null
      });
    },
    async 'identity.get'(params) {
      const session = await requireHandle(params);
      return {
        identity: session.handle.identity.describe(),
        mappings: session.handle.identity.listMappings({ limit: params?.limit ?? 1000 }),
        conflicts: session.handle.identity.listConflicts({
          includeResolved: params?.includeResolved === true,
          limit: params?.limit ?? 1000
        })
      };
    },
    async 'identity.validateTarget'(params) {
      return validateTargetInput(params?.target ?? params ?? {});
    },
    async 'identity.migrationPreview'(params) {
      const session = await requireHandle(params);
      return session.handle.identity.migrationPreview({ target: params.target ?? {} });
    },
    async 'identity.applyMigration'(params) {
      const session = await requireHandle(params);
      return session.handle.identity.applyMigration({ token: params.token });
    },
    async 'identity.resolveConflict'(params) {
      const session = await requireHandle(params);
      return session.handle.identity.resolveConflict({
        conflictId: params.conflictId,
        resolution: params.resolution
      });
    },
    async 'sync.status'(params) {
      const session = await requireHandle(params);
      return session.handle.sync.status();
    },
    async 'sync.check'(params) {
      const session = await requireHandle(params);
      return session.handle.sync.check({
        mode: params.mode ?? 'auto',
        auth: params.auth ?? null,
        source: params.source ?? {},
        query: params.query ?? {},
        contentTypes: params.contentTypes ?? null,
        perPage: params.perPage ?? 100,
        maxItems: params.maxItems ?? null,
        overlapHours: params.overlapHours,
        fullReconcileDays: params.fullReconcileDays,
        autoApplyWithdrawals: params.autoApplyWithdrawals,
        withdrawalPolicy: params.withdrawalPolicy,
        classifyBatchSize: params.classifyBatchSize ?? null,
        signal: null
      });
    },
    async 'sync.resume'(params) {
      const session = await requireHandle(params);
      return session.handle.sync.resume({ scanId: params.scanId });
    },
    async 'sync.get'(params) {
      const session = await requireHandle(params);
      return session.handle.sync.get(params.scanId);
    },
    async 'sync.history'(params) {
      const session = await requireHandle(params);
      return session.handle.sync.history({ limit: params?.limit ?? 50 });
    },
    async 'sync.plan'(params) {
      const session = await requireHandle(params);
      return session.handle.sync.preparePlan({
        scanId: params.scanId,
        selection: params.selection ?? null,
        batchSize: params.batchSize ?? 1000,
        planning: params.planning ?? {},
        disk: params.disk ?? {},
        media: params.media ?? {},
        estimateMedia: params.estimateMedia !== false
      });
    },
    async 'sync.conflicts'(params) {
      const session = await requireHandle(params);
      return session.handle.sync.conflicts({
        includeResolved: params?.includeResolved === true,
        limit: params?.limit ?? 500
      });
    },
    async 'sync.resolveConflict'(params) {
      const session = await requireHandle(params);
      return session.handle.sync.resolveConflict({
        conflictId: params.conflictId,
        resolution: params.resolution,
        note: params.note ?? null
      });
    },
    async 'sync.withdraw'(params) {
      const session = await requireHandle(params);
      return session.handle.sync.withdraw({
        scanId: params.scanId,
        sourceKeys: params.sourceKeys ?? null,
        policy: params.policy ?? 'hide',
        note: params.note ?? null,
        automatic: params.automatic === true
      });
    },
    async 'sync.prepareTombstones'(params) {
      const session = await requireHandle(params);
      return session.handle.sync.prepareTombstones({
        scanId: params.scanId,
        sourceKeys: params.sourceKeys ?? null,
        note: params.note ?? null
      });
    },
    async 'sync.adopt'(params) {
      const session = await requireHandle(params);
      return session.handle.sync.adoptExisting({ note: params.note ?? null });
    },
    async 'sync.adoptions'(params) {
      const session = await requireHandle(params);
      return session.handle.sync.adoptionReports({ limit: params?.limit ?? 20 });
    },
    async 'sync.withdrawals'(params) {
      const session = await requireHandle(params);
      return session.handle.sync.withdrawalList({ limit: params?.limit ?? 500 });
    },
    async 'sync.catalog'(params) {
      const session = await requireHandle(params);
      return session.handle.sync.catalog({ includeWithdrawn: params?.includeWithdrawn === true });
    },
    async 'sync.writeCatalog'(params) {
      const session = await requireHandle(params);
      return session.handle.sync.writeCatalog({ scanId: params?.scanId ?? null });
    },
    async 'sync.recordQdnEvidence'(params) {
      const session = await requireHandle(params);
      return session.handle.sync.recordQdnEvidence({
        sourceKey: params.sourceKey,
        sha256: params.sha256 ?? null,
        bytes: params.bytes ?? null,
        service: params.service ?? null,
        name: params.name ?? null,
        identifier: params.identifier ?? null,
        observedAt: params.observedAt ?? null,
        source: params.source ?? 'operator'
      });
    },
    async 'plan.create'(params) {
      const session = await requireHandle(params);
      return session.handle.planning.create({
        batchSize: params.batchSize,
        filters: params.filters ?? {},
        planning: params.planning ?? {},
        disk: params.disk ?? {},
        media: params.media ?? {},
        estimateMedia: params.estimateMedia !== false,
        persist: params.persist !== false
      });
    },
    async 'plan.list'(params) {
      const session = await requireHandle(params);
      return session.handle.planning.list({ limit: params?.limit ?? 100 });
    },
    async 'plan.get'(params) {
      const session = await requireHandle(params);
      return session.handle.planning.get(params.planId);
    },
    async 'disk.check'(params) {
      const session = await requireHandle(params);
      const config = resolveRunConfig(session.handle.project, { disk: params.disk ?? {} });
      return diskPreflight({
        probe: session.handle.diskProbe,
        workspacePath: session.handle.paths.root,
        limits: config.disk,
        knownBytes: Number(params.knownBytes ?? 0),
        unknownCount: Number(params.unknownCount ?? 0),
        metadataBytes: Number(params.metadataBytes ?? 0)
      });
    },
    async 'media.download'(params) {
      const session = await requireHandle(params);
      return session.handle.media.download({
        planId: params.planId,
        disk: params.disk ?? {},
        media: params.media ?? {},
        concurrency: params.concurrency
      });
    },
    async 'media.inspect'(params) {
      const session = await requireHandle(params);
      return session.handle.media.inspect();
    },
    async 'publication.prepare'(params) {
      const session = await requireHandle(params);
      return session.handle.publication.prepare({
        planId: params.planId,
        selection: params.selection,
        feePerResource: params.feePerResource ?? null,
        feeCurrency: params.feeCurrency ?? 'QORT'
      });
    },
    async 'publication.list'(params) {
      const session = await requireHandle(params);
      return session.handle.publication.list({ limit: params?.limit ?? 100 });
    },
    async 'publication.get'(params) {
      const session = await requireHandle(params);
      return session.handle.publication.get(params.handoffId, { validate: params.validate !== false });
    },
    async 'publication.exportBundle'(params) {
      const session = await requireHandle(params);
      return session.handle.publication.exportBundle(params.handoffId);
    },
    async 'publication.importReceipt'(params) {
      const session = await requireHandle(params);
      return session.handle.publication.importReceipt({
        handoffId: params.handoffId,
        receipt: params.receipt
      });
    },
    async 'publication.verify'(params) {
      const session = await requireHandle(params);
      return session.handle.publication.verify({
        handoffId: params.handoffId,
        nodeUrl: params.nodeUrl,
        attempts: params.attempts ?? 6,
        intervalMs: params.intervalMs ?? 1500,
        timeoutMs: params.timeoutMs ?? 30000
      });
    },
    async 'publication.history'(params) {
      const session = await requireHandle(params);
      return session.handle.publication.history({ limit: params?.limit ?? 200 });
    },
    async 'publication.resources'(params) {
      const session = await requireHandle(params);
      return session.handle.publication.resourceStates({ handoffId: params?.handoffId ?? null });
    },
    async 'publication.verifyOwnership'(params) {
      const session = await requireHandle(params);
      return session.handle.publication.verifyOwnership({
        handoffId: params.handoffId ?? null,
        nodeUrl: params.nodeUrl,
        ownerAddress: params.ownerAddress
      });
    },
    async 'publication.batches'(params) {
      const session = await requireHandle(params);
      return session.handle.publication.batches(params.handoffId);
    },
    async 'media.reconcile'(params) {
      const session = await requireHandle(params);
      return session.handle.media.reconcileReferences();
    },
    async 'project.create'(params) {
      return engine.projects.create(params ?? {});
    },
    async 'project.list'(params = {}) {
      return engine.projects.list({ includeArchived: params.includeArchived === true });
    },
    async 'project.inspect'(params) {
      return engine.projects.inspect(requireProjectId(params));
    },
    async 'project.get'(params) {
      return engine.projects.get(requireProjectId(params));
    },
    async 'project.open'(params) {
      const session = await requireHandle(params);
      return {
        project: session.handle.project,
        snapshot: session.handle.snapshot()
      };
    },
    async 'project.close'(params) {
      const projectId = requireProjectId(params);
      const session = sessions.get(projectId);
      if (!session) {
        throw new QmsError(ERROR_CODES.STATE_NOT_OPEN, 'Project is not open in this host session.', {
          details: { projectId }
        });
      }
      session.unsubscribe();
      sessions.delete(projectId);
      return session.handle.close();
    },
    async 'project.update'(params) {
      const session = await requireHandle(params);
      return session.handle.update(params.patch ?? {});
    },
    async 'project.archive'(params) {
      const projectId = requireProjectId(params);
      const session = sessions.get(projectId);
      if (session) {
        session.unsubscribe();
        sessions.delete(projectId);
        await session.handle.close();
      }
      return engine.projects.archive(projectId, { deleteLocalData: params.deleteLocalData === true });
    },
    async 'project.snapshot'(params) {
      const session = await requireHandle(params);
      return session.handle.snapshot();
    },
    async 'project.validate'(params) {
      const session = await requireHandle(params);
      return session.handle.validate();
    },
    async 'state.compact'(params) {
      const session = await requireHandle(params);
      const result = await session.handle.store.compact({ reason: 'host' });
      await session.handle.events.emit({
        type: 'state_snapshot',
        phase: 'state',
        level: 'info',
        code: 'STATE_SNAPSHOT',
        message: 'Project state compacted.',
        retryable: false,
        details: result
      });
      return result;
    },
    async 'recovery.status'(params) {
      const session = await requireHandle(params);
      return session.handle.recovery.status();
    },
    async 'recovery.resume'(params) {
      const session = await requireHandle(params);
      const id = params.stageId ?? params.runId;
      if (typeof id !== 'string') {
        throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'params.runId or params.stageId is required.');
      }
      const overrides = params.auth || params.nodeUrl
        ? { ...(params.auth ? { auth: params.auth } : {}), ...(params.nodeUrl ? { nodeUrl: params.nodeUrl } : {}) }
        : {};
      return session.handle.recovery.resume(id, overrides);
    },
    async 'recovery.dismiss'(params) {
      const session = await requireHandle(params);
      return session.handle.recovery.dismiss(params.runId, { reason: params.reason });
    },
    async 'recovery.reconcile'(params) {
      const session = await requireHandle(params);
      return session.handle.recovery.reconcilePublication({
        handoffId: params.handoffId ?? null,
        nodeUrl: params.nodeUrl,
        attempts: params.attempts ?? 3,
        intervalMs: params.intervalMs ?? 0
      });
    },
    async 'cleanup.preview'(params) {
      const session = await requireHandle(params);
      return session.handle.cleanup.preview({
        handoffIds: params.handoffIds ?? null,
        planIds: params.planIds ?? null,
        includeHandoffPayloads: params.includeHandoffPayloads !== false,
        includeParts: params.includeParts !== false,
        includeUnreferenced: params.includeUnreferenced === true,
        explicitPaths: params.explicitPaths ?? null,
        retentionDays: params.retentionDays
      });
    },
    async 'cleanup.start'(params) {
      const session = await requireHandle(params);
      return session.handle.cleanup.start({
        handoffIds: params.handoffIds ?? null,
        planIds: params.planIds ?? null,
        includeHandoffPayloads: params.includeHandoffPayloads !== false,
        includeParts: params.includeParts !== false,
        includeUnreferenced: params.includeUnreferenced === true,
        explicitPaths: params.explicitPaths ?? null,
        retentionDays: params.retentionDays,
        dryRun: params.dryRun === true
      });
    },
    async 'cleanup.list'(params) {
      const session = await requireHandle(params);
      return session.handle.cleanup.list({ limit: params.limit ?? 100 });
    },
    async 'cleanup.get'(params) {
      const session = await requireHandle(params);
      return session.handle.cleanup.get(params.cleanupId);
    },
    async 'cleanup.restore'(params) {
      const session = await requireHandle(params);
      return session.handle.cleanup.restore(params.cleanupId);
    },
    async 'cleanup.purge'(params) {
      const session = await requireHandle(params);
      return session.handle.cleanup.purge(params.cleanupId, { force: params.force === true });
    },
    async 'cleanup.resume'(params) {
      const session = await requireHandle(params);
      return session.handle.cleanup.resume(params.cleanupId);
    },
    async 'history.list'(params) {
      const session = await requireHandle(params);
      return session.handle.history.timeline({
        limit: params.limit ?? 200,
        types: params.types ?? null
      });
    },
    async 'history.evidence'(params) {
      const session = await requireHandle(params);
      return session.handle.history.evidence({
        sourceKey: params.sourceKey ?? null,
        resourceId: params.resourceId ?? null,
        handoffId: params.handoffId ?? null
      });
    },
    async 'history.export'(params) {
      const session = await requireHandle(params);
      return session.handle.history.snapshot({ reason: params.reason ?? 'manual-export' });
    },
    async 'support.bundle'(params) {
      const session = await requireHandle(params);
      return session.handle.supportBundle({
        dataRoot: engine.dataRoot,
        appInfo: params.appInfo ?? {},
        settings: params.settings ?? {},
        keyring: params.keyring ?? {},
        logLines: params.logLines ?? [],
        canaries: params.canaries ?? []
      });
    },
    async 'run.list'(params) {
      const session = await requireHandle(params);
      return session.handle.runs.list();
    },
    async 'run.get'(params) {
      const session = await requireHandle(params);
      return session.handle.runs.get(params.runId);
    },
    async 'run.progress'(params) {
      const session = await requireHandle(params);
      return session.handle.progress(params.runId);
    },
    async 'run.events'(params) {
      const session = await requireHandle(params);
      return session.handle.events.list({
        runId: params.runId ?? null,
        afterSeq: params.afterSeq ?? 0,
        limit: params.limit ?? 500
      });
    },
    async 'run.pause'(params) {
      const session = await requireHandle(params, { autoOpen: false });
      return session.handle.runs.pause(params.runId, params.reason);
    },
    async 'run.cancel'(params) {
      const session = await requireHandle(params, { autoOpen: false });
      return session.handle.runs.cancel(params.runId, params.reason);
    },
    async 'events.list'(params) {
      const session = await requireHandle(params);
      return session.handle.events.list({
        runId: params.runId ?? null,
        afterSeq: params.afterSeq ?? 0,
        limit: params.limit ?? 500
      });
    }
  };

  async function handleMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      send(rpcError(null, INVALID_REQUEST, 'Invalid request'));
      return;
    }
    const { id, method, params } = message;
    if (typeof method !== 'string') {
      send(rpcError(id, INVALID_REQUEST, 'Request method is missing'));
      return;
    }
    const handler = methods[method];
    if (!handler) {
      send(rpcError(id, METHOD_NOT_FOUND, `Unknown method: ${method}`, { code: ERROR_CODES.UNKNOWN_METHOD }));
      return;
    }
    try {
      const result = await handler(params);
      if (id !== undefined && id !== null) {
        send({ jsonrpc: '2.0', id, result });
      }
    } catch (error) {
      if (isQmsError(error)) {
        send(rpcError(id, APPLICATION_ERROR, error.message, error.toJSON()));
      } else {
        send(rpcError(id, INTERNAL_ERROR, 'Internal engine error', { message: error.message }));
      }
    }
  }

  rl.on('line', (line) => {
    if (!line.trim()) {
      return;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send(rpcError(null, PARSE_ERROR, 'Invalid JSON'));
      return;
    }
    // Requests are handled concurrently so run.cancel can reach a running
    // operation; state writes are serialized inside the store.
    void handleMessage(message);
  });

  const shutdown = async () => {
    if (closed) {
      return;
    }
    closed = true;
    rl.close();
    for (const session of sessions.values()) {
      session.unsubscribe();
      await session.handle.close().catch(() => {});
    }
    sessions.clear();
    resolveClosed({ closed: true });
  };

  rl.on('close', () => {
    void shutdown();
  });

  void clock;

  return { closed: closedPromise, shutdown, sessions };
}
