import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { ProjectLock } from './lock.js';
import { JournalStore } from './storage/journal.js';
import { EventBus } from './events.js';
import { RunService } from './runs.js';
import { SourceService } from './source.js';
import { runProjectValidation } from './validate.js';
import {
  PROJECT_SCHEMA,
  PROJECT_VERSION,
  assertProjectDocument,
  createInitialState,
  validateSnapshot
} from './storage/schema.js';
import { assertProjectId, projectPaths } from './storage/paths.js';
import { atomicWriteJson, readJsonIfExists } from './storage/atomic.js';
import { newProjectId, slugify } from './ids.js';
import { QmsError, ERROR_CODES } from './errors.js';
import { systemClock } from './clock.js';
import {
  IdentityService,
  newSiteIdentity,
  projectTarget
} from './identity.js';
import { PlanningService } from './planner.js';
import { MediaService } from './media.js';
import { PublicationService } from './publication/index.js';
import { SyncService } from './sync.js';
import { HistoryService } from './history.js';
import { RecoveryService } from './recovery.js';
import { CleanupService } from './cleanup.js';
import { writeSupportBundle } from './diagnostics.js';

const MAX_SETTINGS_BYTES = 100 * 1024;

function assertPlainObject(value, label) {
  if (value === undefined) {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, `${label} must be an object.`);
  }
  return value;
}

function assertJsonSerializable(value, label) {
  try {
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded, 'utf8') > MAX_SETTINGS_BYTES) {
      throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, `${label} is too large.`);
    }
  } catch (error) {
    if (error instanceof QmsError) {
      throw error;
    }
    throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, `${label} must be JSON-serializable.`, {
      cause: error
    });
  }
}

function normalizeName(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'Project name is required.');
  }
  const trimmed = name.trim();
  if (trimmed.length > 120) {
    throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'Project name must be at most 120 characters.');
  }
  return trimmed;
}

function summarizeProject(project, paths) {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    archivedAt: project.archivedAt ?? null,
    profileId: project.compatibility?.profileId ?? null,
    resourcePrefix: project.compatibility?.resourcePrefix ?? null,
    siteId: project.identity?.siteId ?? null,
    siteNamespace: project.identity?.namespace ?? null,
    sourceAdapter: project.source?.adapter ?? null,
    sourceBaseUrl: project.source?.baseUrl ?? null,
    targetQdnName: project.target?.qdnName ?? null,
    siteName: project.target?.siteName ?? null,
    storageRoot: paths.root
  };
}

function projectDocument({ id, name, createdAt, source, target, template, compatibility, settings, identity }) {
  return {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    id,
    name,
    slug: slugify(name),
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    source,
    target,
    template,
    compatibility: compatibility ?? null,
    settings,
    identity
  };
}

export class ProjectService {
  constructor(options) {
    this.dataRoot = options.dataRoot;
    this.clock = options.clock ?? systemClock;
    this.repoRoot = options.repoRoot;
    this.profileResolver = options.profileResolver ?? null;
    this.lockOptions = options.lockOptions ?? {};
    this.storeOptions = options.storeOptions ?? {};
    this.sourceRegistry = options.sourceRegistry ?? null;
    this.diskProbe = options.diskProbe ?? null;
    this.fetchImpl = options.fetchImpl ?? null;
    this.onCheckpoint = options.onCheckpoint ?? null;
    this.onCleanupProgress = options.onCleanupProgress ?? null;
    this.logger = options.logger ?? null;
    this._handles = new Map();
  }

  paths(projectId) {
    return projectPaths(this.dataRoot, assertProjectId(projectId));
  }

  async _buildCompatibility(input) {
    const profileId = input.compatibility?.profileId ?? input.profileId ?? null;
    if (!profileId) {
      return null;
    }
    if (!this.profileResolver) {
      throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'This engine was created without a profile resolver.');
    }
    const record = await this.profileResolver(profileId);
    return {
      ...record,
      ...(input.compatibility ?? {}),
      profileId,
      qdnIdentifiers: {
        ...record.qdnIdentifiers,
        ...(input.compatibility?.qdnIdentifiers ?? {})
      }
    };
  }

  async create(input = {}) {
    const name = normalizeName(input.name);
    const id = input.id ? assertProjectId(input.id) : newProjectId();
    const paths = projectPaths(this.dataRoot, id);
    const now = this.clock.nowIso();

    const source = { adapter: 'wordpress', baseUrl: null, ...assertPlainObject(input.source, 'source') };
    const target = {
      qdnName: null,
      siteName: null,
      contentName: null,
      mediaName: null,
      ...assertPlainObject(input.target, 'target')
    };
    const template = { id: null, ...assertPlainObject(input.template, 'template') };
    const settings = assertPlainObject(input.settings, 'settings');
    assertJsonSerializable({ source, target, template, settings }, 'Project configuration');
    // Validate target name and resource prefix before anything is written.
    const effectiveTarget = projectTarget({ target, settings });
    target.qdnName = effectiveTarget.qdnName;
    const compatibility = await this._buildCompatibility(input);
    const identity = newSiteIdentity({ clock: this.clock });

    const document = projectDocument({ id, name, createdAt: now, source, target, template, compatibility, settings, identity });

    await mkdir(paths.projectsDir, { recursive: true });
    try {
      await mkdir(paths.root, { recursive: false });
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new QmsError(ERROR_CODES.PROJECT_EXISTS, `Project already exists: ${id}`, {
          details: { projectId: id, root: paths.root }
        });
      }
      throw error;
    }

    try {
      await atomicWriteJson(paths.projectFile, document);
      await mkdir(paths.runsDir, { recursive: true });
      await mkdir(paths.artifactsDir, { recursive: true });
      const store = await JournalStore.open({
        root: paths.stateDir,
        clock: this.clock,
        projectId: id,
        initialState: createInitialState({ projectId: id, createdAt: now, siteIdentity: identity, target: effectiveTarget }),
        logger: this.logger,
        ...this.storeOptions
      });
      await store.close();
    } catch (error) {
      await rm(paths.root, { recursive: true, force: true }).catch(() => {});
      throw error;
    }

    return summarizeProject(document, paths);
  }

  async list({ includeArchived = false, limit = 500 } = {}) {
    let entries;
    try {
      entries = await readdir(path.join(this.dataRoot, 'projects'), { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const paths = projectPaths(this.dataRoot, entry.name);
      const document = await readJsonIfExists(paths.projectFile);
      if (!document) {
        continue;
      }
      try {
        assertProjectDocument(document, { file: paths.projectFile });
      } catch {
        continue;
      }
      if (!includeArchived && document.archivedAt) {
        continue;
      }
      projects.push(summarizeProject(document, paths));
    }
    return projects
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, limit);
  }

  /**
   * Read-only dashboard projection from the last atomic state snapshot. It
   * never takes the project lock and never writes, so the dashboard can show
   * status while another process owns the project.
   */
  async inspect(projectId) {
    const { project, paths } = await this.get(projectId);
    let state = null;
    try {
      const snapshot = await readJsonIfExists(paths.snapshotFile);
      if (snapshot) {
        validateSnapshot(snapshot, { file: paths.snapshotFile });
        state = snapshot.state;
      }
    } catch {
      state = null;
    }
    const runs = Object.values(state?.runs ?? {})
      .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)))
      .slice(0, 20)
      .map((run) => ({
        id: run.id,
        kind: run.kind,
        state: run.state,
        phase: run.phase,
        startedAt: run.startedAt,
        endedAt: run.endedAt ?? null,
        progress: run.progress ?? null,
        error: run.error ?? null,
        result: run.result ?? null
      }));
    const plans = Object.values(state?.plans ?? {})
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, 20)
      .map((plan) => ({
        planId: plan.planId,
        status: plan.status,
        batchId: plan.batchId,
        selectedCount: plan.selectedCount ?? 0,
        pendingPublicationCount: plan.pendingPublicationCount ?? 0,
        conflictCount: plan.conflictCount ?? 0,
        createdAt: plan.createdAt,
        download: plan.download ?? null
      }));
    const mappings = Object.values(state?.identity?.mappings ?? {});
    const identity = state?.identity
      ? {
          siteId: state.identity.siteId,
          namespace: state.identity.namespace,
          target: state.identity.target,
          mappingCount: mappings.length,
          pendingPublicationCount: mappings.filter((mapping) =>
            mapping.status !== 'published' &&
            (mapping.publicationStatus === 'reserved' || mapping.publicationStatus === 'prepared' ||
              (!mapping.publicationStatus && mapping.status !== 'published'))
          ).length,
          preparedCount: mappings.filter((mapping) => mapping.localPreparation === 'prepared').length,
          publishedCount: mappings.filter((mapping) =>
            mapping.publicationStatus === 'published' || mapping.publicationStatus === 'remote_verified' || mapping.status === 'published'
          ).length,
          unresolvedConflicts: Object.values(state.identity.conflicts ?? {}).filter((conflict) => !conflict.resolvedAt).length
        }
      : null;
    const lastActivity = [project.updatedAt, ...runs.map((run) => run.startedAt), ...plans.map((plan) => plan.createdAt)]
      .filter(Boolean)
      .sort()
      .at(-1) ?? project.updatedAt;
    const syncScans = Object.values(state?.sync?.scans ?? {});
    const latestScan = syncScans.sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)))[0] ?? null;
    const sync = state?.sync
      ? {
          revision: state.sync.revision,
          scanCount: syncScans.length,
          conflictCount: Object.values(state.sync.conflicts ?? {}).filter((conflict) => conflict.status !== 'resolved').length,
          withdrawalCount: Object.keys(state.sync.withdrawals ?? {}).length,
          adoptionCount: Array.isArray(state.sync.adoptions) ? state.sync.adoptions.length : 0,
          latestScan: latestScan
            ? {
                scanId: latestScan.id,
                status: latestScan.status,
                mode: latestScan.mode,
                startedAt: latestScan.startedAt,
                completedAt: latestScan.completedAt ?? null,
                counts: latestScan.counts ?? null
              }
            : null
        }
      : null;
    return {
      project: summarizeProject(project, paths),
      identity,
      sync,
      runs,
      plans,
      lastActivity,
      activeRuns: runs.filter((run) => run.state === 'running').length,
      interruptedRuns: runs.filter((run) => run.state !== 'running' && run.state !== 'completed' && run.state !== 'failed').length
    };
  }

  async get(projectId) {
    const paths = this.paths(projectId);
    const document = await readJsonIfExists(paths.projectFile);
    if (!document) {
      throw new QmsError(ERROR_CODES.PROJECT_NOT_FOUND, `Project not found: ${projectId}`, {
        details: { projectId }
      });
    }
    assertProjectDocument(document, { file: paths.projectFile });
    return { project: document, paths };
  }

  async ensureSiteIdentity(project, paths) {
    if (project.identity?.siteId) {
      return project;
    }
    // Legacy Phase 1/2 projects get a cryptographically random, persistent
    // identity while the exclusive lock is held. It is never derived from the
    // mutable project name, source URL or target Qortal name.
    const identity = newSiteIdentity({ clock: this.clock });
    const document = { ...project, identity, updatedAt: this.clock.nowIso() };
    await atomicWriteJson(paths.projectFile, document);
    return document;
  }

  async open(projectId, options = {}) {
    let { project, paths } = await this.get(projectId);
    if (project.archivedAt && !options.allowArchived) {
      throw new QmsError(ERROR_CODES.PROJECT_ARCHIVED, `Project is archived: ${projectId}`, {
        details: { projectId, archivedAt: project.archivedAt }
      });
    }
    const lock = await ProjectLock.acquire({
      file: paths.lockFile,
      projectId,
      clock: this.clock,
      recoverStale: options.recoverStaleLock === true,
      engineVersion: options.engineVersion ?? null,
      ...this.lockOptions
    });

    let store;
    let identityInitialized = false;
    try {
      project = await this.ensureSiteIdentity(project, paths);
      store = await JournalStore.open({
        root: paths.stateDir,
        clock: this.clock,
        projectId,
        initialState: createInitialState({
          projectId,
          createdAt: project.createdAt,
          siteIdentity: project.identity,
          target: projectTarget(project)
        }),
        guard: () => lock.assertHeld(),
        logger: this.logger,
        ...this.storeOptions
      });
    } catch (error) {
      await lock.release().catch(() => {});
      throw error;
    }

    const handle = new ProjectHandle({
      service: this,
      project,
      paths,
      lock,
      store,
      clock: this.clock,
      repoRoot: this.repoRoot,
      sourceRegistry: this.sourceRegistry,
      diskProbe: options.diskProbe ?? this.diskProbe ?? null,
      fetchImpl: options.fetchImpl ?? this.fetchImpl ?? null,
      onCheckpoint: options.onCheckpoint ?? this.onCheckpoint ?? null,
      onCleanupProgress: options.onCleanupProgress ?? this.onCleanupProgress ?? null
    });
    if (options.recoverOnOpen !== false) {
      const recovery = await handle.recovery.recoverOnOpen().catch((error) => {
        this.logger?.warn?.('Project recovery inspection failed; the project remains usable.', {
          projectId: handle.id,
          error: error?.message ?? String(error)
        });
        return null;
      });
      if (recovery) handle.recoveryReport = recovery;
    }
    this._handles.set(projectId, handle);
    let identityResult;
    try {
      identityResult = await handle.identity.ensureInitialized();
    } catch (error) {
      await handle.close().catch(() => {});
      this._handles.delete(projectId);
      throw error;
    }
    identityInitialized = identityResult.initialized;
    const syncRecovery = await handle.sync.recover();
    await handle.events.emit({
      type: 'state_snapshot',
      phase: 'open',
      level: 'info',
      code: 'STATE_SNAPSHOT',
      message: 'Project opened; persisted state loaded.',
      retryable: false,
      details: {
        storeVersion: store.storeVersion,
        lastTxnSeq: store.lastTxnSeq,
        lastEventSeq: store.state.lastEventSeq,
        recovered: store.recovery.recovered,
        truncatedBytes: store.recovery.truncatedBytes,
        migratedFrom: store.recovery.migratedFrom,
        interruptedSyncScans: syncRecovery.interrupted,
        runCount: Object.keys(store.state.runs).length,
        siteId: handle.project.identity?.siteId ?? null
      }
    });
    if (identityInitialized) {
      await handle.events.emit({
        type: 'warning_emitted',
        phase: 'identity',
        level: 'warning',
        code: 'SITE_IDENTITY_INITIALIZED',
        message: 'A persistent site identity was generated for this project.',
        retryable: false,
        details: {
          siteId: handle.project.identity?.siteId ?? null,
          namespace: handle.project.identity?.namespace ?? null
        }
      });
    }
    return handle;
  }

  async archive(projectId, options = {}) {
    const { project, paths } = await this.get(projectId);
    const lock = await ProjectLock.acquire({
      file: paths.lockFile,
      projectId,
      clock: this.clock,
      recoverStale: options.recoverStaleLock === true,
      ...this.lockOptions
    });
    let document = project;
    try {
      if (!project.archivedAt) {
        document = { ...project, archivedAt: this.clock.nowIso(), updatedAt: this.clock.nowIso() };
        await atomicWriteJson(paths.projectFile, document);
      }
    } finally {
      await lock.release().catch(() => {});
    }

    let movedTo = null;
    if (options.deleteLocalData) {
      await mkdir(paths.trashDir, { recursive: true });
      movedTo = path.join(paths.trashDir, `${projectId}-${Date.now()}`);
      await rename(paths.root, movedTo);
    }
    const handle = this._handles.get(projectId);
    if (handle) {
      await handle.close();
      this._handles.delete(projectId);
    }
    return {
      archived: true,
      projectId,
      archivedAt: document.archivedAt,
      deletedLocalData: Boolean(options.deleteLocalData),
      recoverablePath: movedTo
    };
  }

  async update(projectId, patch = {}) {
    const handle = await this.open(projectId, { recoverStaleLock: false });
    try {
      return await handle.update(patch);
    } finally {
      await handle.close();
    }
  }

  async closeAll() {
    for (const handle of [...this._handles.values()]) {
      await handle.close();
    }
    this._handles.clear();
  }
}

export class ProjectHandle {
  constructor({
    service,
    project,
    paths,
    lock,
    store,
    clock,
    repoRoot,
    sourceRegistry = null,
    diskProbe = null,
    fetchImpl = null,
    onCheckpoint = null,
    onCleanupProgress = null
  }) {
    this._service = service;
    this.project = project;
    this.paths = paths;
    this.lock = lock;
    this.store = store;
    this.clock = clock;
    this.repoRoot = repoRoot;
    this.diskProbe = diskProbe;
    this.fetchImpl = fetchImpl;
    this.onCheckpoint = onCheckpoint;
    this.onCleanupProgress = onCleanupProgress;
    this.closed = false;
    this.events = new EventBus({ projectId: project.id, store, clock });
    this.history = new HistoryService({
      projectId: project.id,
      paths,
      store,
      clock,
      events: this.events
    });
    this.recovery = new RecoveryService({
      projectId: project.id,
      paths,
      store,
      clock,
      events: this.events,
      history: this.history,
      getHandlers: () => ({
        source: this.source,
        planning: this.planning,
        media: this.media,
        publication: this.publication,
        sync: this.sync,
        fetchImpl: this.fetchImpl
      }),
      onCheckpoint
    });
    this.runs = new RunService({
      projectId: project.id,
      store,
      events: this.events,
      clock,
      heartbeat: () => lock.heartbeat(),
      journal: this.recovery
    });
    this.source = sourceRegistry
      ? new SourceService({
          registry: sourceRegistry,
          project: () => this.project,
          paths: this.paths,
          clock,
          runs: this.runs,
          events: this.events
        })
      : null;
    this.identity = new IdentityService({
      store,
      project: () => this.project,
      clock,
      persistProjectTarget: (target) => this.persistTarget(target)
    });
    this.planning = new PlanningService({
      project: () => this.project,
      paths: this.paths,
      store,
      clock,
      runs: this.runs,
      events: this.events,
      identity: this.identity,
      diskProbe: this.diskProbe,
      fetchImpl: this.fetchImpl
    });
    this.sync = new SyncService({
      project: () => this.project,
      paths: this.paths,
      store,
      clock,
      runs: this.runs,
      events: this.events,
      identity: this.identity,
      planning: this.planning,
      source: this.source
    });
    this.media = new MediaService({
      project: () => this.project,
      paths: this.paths,
      store,
      clock,
      runs: this.runs,
      events: this.events,
      identity: this.identity,
      planning: this.planning,
      diskProbe: this.diskProbe,
      fetchImpl: this.fetchImpl
    });
    this.publication = new PublicationService({
      project: () => this.project,
      paths: this.paths,
      store,
      clock,
      identity: this.identity,
      planning: this.planning,
      runs: this.runs,
      events: this.events,
      fetchImpl: this.fetchImpl,
      guard: (input) => this.sync.assertPublicationSafe(input),
      recovery: this.recovery,
      history: this.history
    });
    this.cleanup = new CleanupService({
      projectId: project.id,
      project: () => this.project,
      paths,
      store,
      clock,
      events: this.events,
      history: this.history,
      runs: this.runs,
      diskProbe: this.diskProbe,
      onProgress: this.onCleanupProgress
    });
  }

  /** Build the metadata-only support bundle for this project. */
  async supportBundle(options = {}) {
    return writeSupportBundle({
      handle: this,
      projectId: this.id,
      dataRoot: options.dataRoot,
      appInfo: options.appInfo,
      settings: options.settings,
      keyring: options.keyring,
      logLines: options.logLines,
      canaries: options.canaries,
      limits: options.limits
    });
  }

  /** Write the canonical identity target back to project.json (mirror only). */
  async persistTarget(target) {
    const document = {
      ...this.project,
      target: { ...this.project.target, qdnName: target.qdnName },
      settings: {
        ...this.project.settings,
        identity: { ...(this.project.settings?.identity ?? {}), resourcePrefix: target.resourcePrefix }
      },
      updatedAt: this.clock.nowIso()
    };
    assertJsonSerializable(document, 'Project document');
    await atomicWriteJson(this.paths.projectFile, document);
    this.project = document;
    return document;
  }

  get id() {
    return this.project.id;
  }

  async update(patch = {}) {
    const document = { ...this.project };
    if (patch.name !== undefined) {
      document.name = normalizeName(patch.name);
      document.slug = slugify(document.name);
    }
    for (const field of ['source', 'target', 'template', 'settings']) {
      if (patch[field] !== undefined) {
        document[field] = {
          ...document[field],
          ...assertPlainObject(patch[field], field)
        };
      }
    }
    if (patch.compatibility !== undefined) {
      assertJsonSerializable(patch.compatibility, 'compatibility');
      document.compatibility = patch.compatibility;
    }

    const targetChanged = patch.target !== undefined || patch.settings?.identity !== undefined;
    let nextTarget = projectTarget(document);
    if (targetChanged) {
      const currentTarget = this.identity.target();
      const mappingCount = Object.keys(this.store.state.identity?.mappings ?? {}).length;
      const changed = nextTarget.qdnName !== currentTarget.qdnName ||
        nextTarget.resourcePrefix !== currentTarget.resourcePrefix;
      if (changed && mappingCount > 0) {
        throw new QmsError(
          ERROR_CODES.IDENTITY_MIGRATION_REQUIRED,
          'Changing the target name or resource prefix requires an explicit identity migration.',
          { details: { currentTarget, requestedTarget: nextTarget, mappingCount } }
        );
      }
    }

    assertJsonSerializable(document, 'Project document');
    document.updatedAt = this.clock.nowIso();
    await atomicWriteJson(this.paths.projectFile, document);
    this.project = document;
    if (targetChanged) {
      const currentTarget = this.identity.target();
      if (nextTarget.qdnName !== currentTarget.qdnName || nextTarget.resourcePrefix !== currentTarget.resourcePrefix) {
        await this.identity.adoptProjectTarget(nextTarget);
      }
    }
    return { project: document, paths: this.paths };
  }

  async validate({ signal = null } = {}) {
    return runProjectValidation(this, { signal });
  }

  snapshot() {
    return {
      project: this.project,
      identity: this.identity.describe(),
      storage: {
        storeVersion: this.store.storeVersion,
        lastTxnSeq: this.store.lastTxnSeq,
        lastEventSeq: this.store.state.lastEventSeq,
        eventCount: this.store.state.events.length,
        recovered: this.store.recovery.recovered,
        truncatedBytes: this.store.recovery.truncatedBytes,
        planCount: Object.keys(this.store.state.plans ?? {}).length,
        assetCount: Object.keys(this.store.state.media?.assets ?? {}).length,
        handoffCount: Object.keys(this.store.state.publication?.handoffs ?? {}).length,
        publishedResourceCount: Object.values(this.store.state.publication?.resources ?? {}).filter((resource) => resource.status === 'remote_verified').length,
        scanCount: Object.keys(this.store.state.sync?.scans ?? {}).length,
        syncConflictCount: Object.values(this.store.state.sync?.conflicts ?? {}).filter((conflict) => conflict.status !== 'resolved').length,
        withdrawalCount: Object.keys(this.store.state.sync?.withdrawals ?? {}).length
      },
      runs: this.runs.list()
    };
  }

  progress(runId) {
    return this.runs.get(runId);
  }

  async heartbeat() {
    return this.lock.heartbeat({ force: true });
  }

  async close() {
    if (this.closed) {
      return { closed: true, alreadyClosed: true };
    }
    this.closed = true;
    await this.store.close();
    await this.lock.release();
    this._service._handles.delete(this.id);
    return { closed: true };
  }

  async archive(options = {}) {
    await this.close();
    return this._service.archive(this.project.id, options);
  }
}
