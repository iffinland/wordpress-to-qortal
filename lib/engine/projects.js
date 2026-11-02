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
  createInitialState
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
      fetchImpl: options.fetchImpl ?? this.fetchImpl ?? null
    });
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
    fetchImpl = null
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
    this.closed = false;
    this.events = new EventBus({ projectId: project.id, store, clock });
    this.runs = new RunService({
      projectId: project.id,
      store,
      events: this.events,
      clock,
      heartbeat: () => lock.heartbeat()
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
        assetCount: Object.keys(this.store.state.media?.assets ?? {}).length
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
